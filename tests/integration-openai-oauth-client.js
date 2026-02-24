'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const net    = require('node:net');
const { OAuthClient } = require('../src/llm/openai-oauth-client');

const TMP_DIR = path.join(__dirname, '_tmp_oauth');

// in-memory mock storage factory
function createMockStorage(initial = null) {
  let stored = initial ? { ...initial } : null;
  return {
    load:   () => stored ? { ...stored } : null,
    save:   (t) => { stored = { ...t }; },
    delete: () => { stored = null; },
    _get:   () => stored,
  };
}

// Build a fake JWT with given payload claims
function makeFakeJwt(payloadClaims = {}) {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'test-account-id' },
    ...payloadClaims,
  })).toString('base64url');
  return `${header}.${payload}.fakesignature`;
}

// Build a mock tokens object
function makeTokens(overrides = {}) {
  return {
    access:    makeFakeJwt(),
    refresh:   'test-refresh-token',
    expires:   Date.now() + 60 * 60 * 1000, // 1 hour from now
    accountId: 'test-account-id',
    ...overrides,
  };
}

// Build a ReadableStream from SSE event objects
function makeSseStream(events) {
  const lines = events
    .map(e => `data: ${JSON.stringify(e)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines));
      controller.close();
    },
  });
}

// ─── PKCE generation ──────────────────────────────────────────────────────────

describe('PKCE generation', () => {
  it('_generatePKCE() 應回傳 base64url 格式的 verifier 與 challenge', async () => {
    const client = new OAuthClient({ storage: createMockStorage() });
    const { verifier, challenge } = await client._generatePKCE();

    // base64url 只含 A-Z a-z 0-9 - _（無 + / =）
    assert.match(verifier,  /^[A-Za-z0-9\-_]+$/);
    assert.match(challenge, /^[A-Za-z0-9\-_]+$/);
  });

  it('_generatePKCE() verifier 應 >= 40 字元', async () => {
    const client = new OAuthClient({ storage: createMockStorage() });
    const { verifier } = await client._generatePKCE();
    assert.ok(verifier.length >= 40, `verifier length ${verifier.length} < 40`);
  });

  it('_generatePKCE() challenge 應為 43 字元（SHA-256 base64url）', async () => {
    const client = new OAuthClient({ storage: createMockStorage() });
    const { challenge } = await client._generatePKCE();
    // SHA-256 = 32 bytes → base64url = 43 chars (no padding)
    assert.equal(challenge.length, 43, `challenge length ${challenge.length} !== 43`);
  });

  it('_generatePKCE() 多次呼叫應回傳不同的 verifier', async () => {
    const client = new OAuthClient({ storage: createMockStorage() });
    const { verifier: v1 } = await client._generatePKCE();
    const { verifier: v2 } = await client._generatePKCE();
    assert.notEqual(v1, v2);
  });
});

// ─── getStatus() ──────────────────────────────────────────────────────────────

describe('getStatus()', () => {
  it('無 token 時應回傳 {loggedIn: false}', () => {
    const client = new OAuthClient({ storage: createMockStorage(null) });
    const status = client.getStatus();
    assert.deepEqual(status, { loggedIn: false });
  });

  it('有 token 時應回傳 {loggedIn: true, accountId, expires}', () => {
    const tokens = makeTokens();
    const client = new OAuthClient({ storage: createMockStorage(tokens) });
    const status = client.getStatus();
    assert.equal(status.loggedIn, true);
    assert.equal(status.accountId, tokens.accountId);
    assert.equal(status.expires, tokens.expires);
  });
});

// ─── logout() ─────────────────────────────────────────────────────────────────

describe('logout()', () => {
  it('logout() 後 storage.load() 應回傳 null', async () => {
    const storage = createMockStorage(makeTokens());
    const client  = new OAuthClient({ storage });

    assert.ok(storage._get() !== null, '前置條件：token 應存在');
    await client.logout();
    assert.equal(storage._get(), null);
  });
});

// ─── getValidToken() ──────────────────────────────────────────────────────────

describe('getValidToken()', () => {
  it('未登入時應拋出 "Not logged in"', async () => {
    const client = new OAuthClient({ storage: createMockStorage(null) });
    await assert.rejects(
      () => client.getValidToken(),
      /Not logged in/
    );
  });

  it('token 有效時應直接回傳 access token，不呼叫 fetch', async () => {
    const tokens  = makeTokens({ expires: Date.now() + 60 * 60 * 1000 });
    const client  = new OAuthClient({ storage: createMockStorage(tokens) });

    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return {}; };

    try {
      const result = await client.getValidToken();
      assert.equal(result, tokens.access);
      assert.equal(fetchCalled, false, 'fetch 不應被呼叫');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('token 過期時應呼叫 refresh endpoint 並更新 storage', async () => {
    const expiredTokens = makeTokens({
      expires: Date.now() - 1000,  // already expired
      refresh: 'old-refresh-token',
    });
    const storage = createMockStorage(expiredTokens);
    const client  = new OAuthClient({ storage });

    const newAccessToken = makeFakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'new-acc' } });
    const originalFetch  = global.fetch;

    global.fetch = async (url, opts) => {
      assert.ok(url.includes('oauth/token'), `expected oauth/token URL, got ${url}`);
      return {
        ok:   true,
        json: async () => ({
          access_token:  newAccessToken,
          refresh_token: 'new-refresh-token',
          expires_in:    3600,
        }),
      };
    };

    try {
      const result = await client.getValidToken();
      assert.equal(result, newAccessToken);
      // storage should be updated
      const saved = storage._get();
      assert.equal(saved.access, newAccessToken);
      assert.equal(saved.refresh, 'new-refresh-token');
      assert.ok(saved.expires > Date.now());
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ─── chatCompletion() ─────────────────────────────────────────────────────────

describe('chatCompletion()', () => {
  it('應正確組合 SSE delta 回傳完整 text', async () => {
    const tokens = makeTokens();
    const client = new OAuthClient({ storage: createMockStorage(tokens) });

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok:   true,
      body: makeSseStream([
        { type: 'response.output_text.delta', delta: 'Hello' },
        { type: 'response.output_text.delta', delta: ' world' },
        { type: 'response.done' },
      ]),
    });

    try {
      const result = await client.chatCompletion([{ role: 'user', content: 'hi' }]);
      assert.equal(result.text, 'Hello world');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('usage 應為 null', async () => {
    const tokens = makeTokens();
    const client = new OAuthClient({ storage: createMockStorage(tokens) });

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok:   true,
      body: makeSseStream([
        { type: 'response.output_text.delta', delta: 'ok' },
        { type: 'response.done' },
      ]),
    });

    try {
      const result = await client.chatCompletion([{ role: 'user', content: 'hi' }]);
      assert.equal(result.usage, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('onChunk callback 應對每個 delta 觸發一次', async () => {
    const tokens = makeTokens();
    const client = new OAuthClient({ storage: createMockStorage(tokens) });

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok:   true,
      body: makeSseStream([
        { type: 'response.output_text.delta', delta: 'A' },
        { type: 'response.output_text.delta', delta: 'B' },
        { type: 'response.output_text.delta', delta: 'C' },
        { type: 'response.done' },
      ]),
    });

    try {
      const chunks = [];
      await client.chatCompletion(
        [{ role: 'user', content: 'hi' }],
        { onChunk: (d) => chunks.push(d) }
      );
      assert.deepEqual(chunks, ['A', 'B', 'C']);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('system messages 應轉換為 instructions 欄位', async () => {
    const tokens = makeTokens();
    const client = new OAuthClient({ storage: createMockStorage(tokens) });

    const originalFetch = global.fetch;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok:   true,
        body: makeSseStream([{ type: 'response.done' }]),
      };
    };

    try {
      await client.chatCompletion([
        { role: 'system', content: 'You are a helper.' },
        { role: 'user',   content: 'Hello' },
      ]);
      assert.equal(capturedBody.instructions, 'You are a helper.');
      assert.equal(capturedBody.input.length, 1);
      assert.equal(capturedBody.input[0].role, 'user');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ─── file storage ─────────────────────────────────────────────────────────────

describe('file storage', () => {
  before(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  after(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('tokensPath: save 後 getStatus() 應回傳正確資料', () => {
    const tokensPath = path.join(TMP_DIR, 'tokens.json');
    const client = new OAuthClient({ tokensPath });

    // Manually write tokens to simulate a saved state
    const tokens = makeTokens();
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));

    const status = client.getStatus();
    assert.equal(status.loggedIn, true);
    assert.equal(status.accountId, tokens.accountId);
    assert.equal(status.expires, tokens.expires);
  });

  it('tokensPath: logout() 後檔案應不存在', async () => {
    const tokensPath = path.join(TMP_DIR, 'tokens2.json');
    const tokens = makeTokens();
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));

    const client = new OAuthClient({ tokensPath });
    await client.logout();

    assert.equal(fs.existsSync(tokensPath), false);
  });
});

// ─── login() port 衝突測試 ─────────────────────────────────────────────────────

describe('login() port 衝突', () => {
  it('port 1455 被佔用時應拋出 "Port 1455 is already in use"', async () => {
    // 先佔用 1455
    const blocker = net.createServer();
    await new Promise((resolve, reject) => {
      blocker.listen(1455, '127.0.0.1', resolve);
      blocker.on('error', reject);
    });

    try {
      const client = new OAuthClient({
        storage:     createMockStorage(),
        openBrowser: () => {},  // 不開瀏覽器
      });

      await assert.rejects(
        () => client.login(),
        /Port 1455 is already in use/
      );
    } finally {
      await new Promise(resolve => blocker.close(resolve));
    }
  });
});
