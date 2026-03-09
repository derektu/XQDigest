const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AppEngine = require('../src/app-engine');

const TMP_DIR = path.join(__dirname, '_tmp_appengine');
const CONFIG_PATH = path.join(TMP_DIR, 'settings.json');
const DATA_DIR = path.join(TMP_DIR, 'data');

function makeConfig(overrides = {}) {
  return {
    app: { logLevel: 'error', dataPath: DATA_DIR, apiPort: null },
    download: { concurrentLimit: 2, retryAttempts: 1, retryDelay: 100, timeoutMs: 5000 },
    ...overrides,
  };
}

function writeConfig(overrides = {}) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(makeConfig(overrides), null, 2));
}

describe('AppEngine', () => {
  before(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  });

  it('初始狀態應為 stopped', () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    assert.equal(engine.getState(), 'stopped');
  });

  it('start() 應初始化並轉為 running', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    const states = [];
    engine.on('stateChange', (state) => states.push(state));

    await engine.start();
    assert.equal(engine.getState(), 'running');
    assert.deepEqual(states, ['starting', 'running']);

    await engine.stop();
  });

  it('stop() 應清理資源並轉為 stopped', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();

    const states = [];
    engine.on('stateChange', (state) => states.push(state));

    await engine.stop();
    assert.equal(engine.getState(), 'stopped');
    assert.deepEqual(states, ['stopping', 'stopped']);
  });

  it('重複 start() 應拋錯', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();

    await assert.rejects(
      () => engine.start(),
      { message: /Cannot start: engine is running/ },
    );

    await engine.stop();
  });

  it('未啟動時 stop() 應拋錯', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });

    await assert.rejects(
      () => engine.stop(),
      { message: /Cannot stop: engine is stopped/ },
    );
  });

  it('getStatus() 應回傳狀態資訊', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();

    const status = engine.getStatus();
    assert.equal(status.state, 'running');
    assert.equal(typeof status.dataSources, 'number');
    assert.equal(typeof status.llmConfigured, 'boolean');

    await engine.stop();
  });

  it('start() 失敗時應清理已建立的資源', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });

    // Monkey-patch DB.prototype.open to throw after real open succeeds
    const DB = require('../src/database/db');
    const origOpen = DB.prototype.open;
    let openCalled = false;
    DB.prototype.open = function () {
      origOpen.call(this); // actually open DB
      openCalled = true;
      throw new Error('simulated init failure');
    };

    try {
      await assert.rejects(
        () => engine.start(),
        { message: /simulated init failure/ },
      );
      assert.ok(openCalled, 'DB.open should have been called');
      // After failed start, state should be stopped
      assert.equal(engine.getState(), 'stopped');
      // Verify cleanup worked: engine can be started again successfully
      DB.prototype.open = origOpen;
      await engine.start();
      assert.equal(engine.getState(), 'running');
      await engine.stop();
    } finally {
      DB.prototype.open = origOpen;
    }
  });

  it('stateChange 事件應包含新舊狀態', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    const transitions = [];
    engine.on('stateChange', (newState, oldState) => {
      transitions.push({ from: oldState, to: newState });
    });

    await engine.start();
    assert.deepEqual(transitions, [
      { from: 'stopped', to: 'starting' },
      { from: 'starting', to: 'running' },
    ]);

    await engine.stop();
  });

  it('pause() 應停止排程並轉為 paused', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();

    const states = [];
    engine.on('stateChange', (state) => states.push(state));

    engine.pause();
    assert.equal(engine.getState(), 'paused');
    assert.deepEqual(states, ['paused']);

    await engine.stop();
  });

  it('resume() 應重啟排程並轉為 running', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();
    engine.pause();

    const states = [];
    engine.on('stateChange', (state) => states.push(state));

    engine.resume();
    assert.equal(engine.getState(), 'running');
    assert.deepEqual(states, ['running']);

    await engine.stop();
  });

  it('getOAuthStatus() 在 _oauthClient 為 null 時應回傳 {loggedIn: false}', () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    // _oauthClient starts as null (engine not started)
    const status = engine.getOAuthStatus();
    assert.deepEqual(status, { loggedIn: false });
  });

  it('startOAuthLogin() 應防止重複觸發（回傳同一 Promise）', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    let resolveLogin;
    const loginPromise = new Promise((res) => { resolveLogin = res; });
    // Inject a mock oauthClient
    engine._oauthClient = {
      login: () => loginPromise,
    };
    const p1 = engine.startOAuthLogin();
    const p2 = engine.startOAuthLogin();
    assert.strictEqual(p1, p2, 'second call should return same promise');
    resolveLogin({ accountId: 'test' });
    await p1;
    // After resolution, promise should be cleared
    const p3 = engine.startOAuthLogin();
    assert.notStrictEqual(p1, p3, 'after completion, new call should return new promise');
    resolveLogin({ accountId: 'test' });
    await p3;
  });

  it('logoutOAuth() 應清除 llmService（providerName=openai-oauth）', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    // Inject mock oauthClient and llmService
    engine._oauthClient = { logout: async () => {} };
    engine._llmService = { providerName: 'openai-oauth' };
    await engine.logoutOAuth();
    assert.equal(engine._llmService, null, 'llmService should be cleared after logout');
  });

  it('logoutOAuth() 不應清除非 openai-oauth 的 llmService', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    engine._oauthClient = { logout: async () => {} };
    engine._llmService = { providerName: 'openai' };
    await engine.logoutOAuth();
    assert.notEqual(engine._llmService, null, 'non-oauth llmService should not be cleared');
  });

  it('stop() 應能從 paused 狀態執行', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();
    engine.pause();

    const states = [];
    engine.on('stateChange', (state) => states.push(state));

    await engine.stop();
    assert.equal(engine.getState(), 'stopped');
    assert.deepEqual(states, ['stopping', 'stopped']);
  });

  it('pause() 在非 running 狀態應拋錯', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    assert.throws(
      () => engine.pause(),
      { message: /Cannot pause: engine is stopped/ },
    );
  });

  it('resume() 在非 paused 狀態應拋錯', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();
    assert.throws(
      () => engine.resume(),
      { message: /Cannot resume: engine is running/ },
    );
    await engine.stop();
  });

  it('setLLMSettings() apiKey 分支設定 LLM 後應呼叫 _resumePendingSummaries()', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    let resumeCalled = false;
    engine._resumePendingSummaries = async () => { resumeCalled = true; };

    // Need _db to be set (setLLMSettings guards on it)
    engine._db = { setAppSetting: () => {} };

    engine.setLLMSettings({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });

    // Wait a tick for the async .catch chain
    await new Promise(r => setImmediate(r));
    assert.ok(resumeCalled, '_resumePendingSummaries should be called after apiKey LLM setup');
  });

  it('setLLMSettings() openai-oauth 分支設定 LLM 後應呼叫 _resumePendingSummaries()', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    let resumeCalled = false;
    engine._resumePendingSummaries = async () => { resumeCalled = true; };
    engine._oauthClient = {};
    engine._db = { setAppSetting: () => {} };

    engine.setLLMSettings({ provider: 'openai-oauth' });

    await new Promise(r => setImmediate(r));
    assert.ok(resumeCalled, '_resumePendingSummaries should be called after openai-oauth LLM setup');
  });

  it('setLLMSettings() 清除 LLM 時不應呼叫 _resumePendingSummaries()', async () => {
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    let resumeCalled = false;
    engine._resumePendingSummaries = async () => { resumeCalled = true; };
    engine._db = { setAppSetting: () => {} };

    engine.setLLMSettings({}); // no apiKey, no oauth

    await new Promise(r => setImmediate(r));
    assert.ok(!resumeCalled, '_resumePendingSummaries should NOT be called when clearing LLM');
  });

  it('stop() 在 LLM queue 有 active task 時應在 6 秒內完成', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();

    // Simulate a long-running LLM task by patching drain to never resolve
    const LLMQueue = require('../src/llm-queue');
    const origDrain = LLMQueue.prototype.drain;
    LLMQueue.prototype.drain = function () {
      return new Promise(() => {}); // never resolves
    };

    try {
      const start = Date.now();
      await engine.stop();
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 6000, `stop() should complete within 6s, took ${elapsed}ms`);
      assert.equal(engine.getState(), 'stopped');
    } finally {
      LLMQueue.prototype.drain = origDrain;
    }
  });
});
