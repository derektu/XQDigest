const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const ApiServer = require('../src/api-server');

function makeRequest(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Mock engine that simulates a running AppEngine
function createMockEngine() {
  const sources = new Map();
  let nextId = 1;
  const schedulerActions = [];

  const mgr = {
    getAll: () => Array.from(sources.values()),
    getById: (id) => sources.get(id) || null,
    add: (fields) => {
      // 檢查重複 URL
      const existing = Array.from(sources.values()).find(s => s.url === fields.url);
      if (existing) {
        const err = new Error(`Duplicate URL: ${fields.url}`);
        err.code = 'DUPLICATE_URL';
        throw err;
      }
      const id = fields.id || `ds-${nextId++}`;
      const ds = { id, ...fields, enabled: fields.enabled !== false };
      sources.set(id, ds);
      return ds;
    },
    update: (id, fields) => {
      const ds = sources.get(id);
      if (!ds) throw new Error(`Not found: ${id}`);
      Object.assign(ds, fields);
      return ds;
    },
    remove: (id) => { sources.delete(id); },
    toggle: (id, enabled) => {
      const ds = sources.get(id);
      if (!ds) throw new Error(`Not found: ${id}`);
      ds.enabled = enabled;
      return ds;
    },
    getStats: (id) => ({ id, totalItems: 5, processedItems: 3 }),
  };

  const scheduler = {
    addSource: (id) => schedulerActions.push({ action: 'add', id }),
    removeSource: (id) => schedulerActions.push({ action: 'remove', id }),
    checkSource: async (id) => schedulerActions.push({ action: 'check', id }),
  };

  // Mock DB for content endpoints
  let nextContentId = 1;
  const contentItems = new Map();

  function addContentItem(fields) {
    const id = nextContentId++;
    const item = {
      id,
      source_type: 'youtube',
      source_id: 'src-1',
      source_name: 'Test Channel',
      item_id: `item-${id}`,
      title: `Item ${id}`,
      url: `https://example.com/${id}`,
      author: 'Author',
      published_date: '2026-02-18T10:00:00Z',
      summary: '## Summary\n\nThis is a summary.',
      is_read: 0,
      status: 'processed',
      ...fields,
    };
    contentItems.set(id, item);
    return item;
  }

  const db = {
    getContentItems: ({ statuses, status, sourceId, limit = 20, offset = 0 } = {}) => {
      let items = Array.from(contentItems.values());
      if (statuses && Array.isArray(statuses)) {
        items = items.filter(i => statuses.includes(i.status));
      } else if (status) {
        items = items.filter(i => i.status === status);
      }
      if (sourceId) items = items.filter(i => i.source_id === sourceId);
      return items.slice(offset, offset + limit).map(i => ({
        ...i,
        summary: i.summary ? i.summary.slice(0, 300) : null,
      }));
    },
    db: {
      prepare: (sql) => ({
        get: (id) => {
          const item = contentItems.get(id);
          return item || null;
        },
      }),
    },
    markContentRead: (id, isRead) => {
      const item = contentItems.get(id);
      if (item) item.is_read = isRead ? 1 : 0;
    },
    getUnreadCounts: () => {
      const processed = Array.from(contentItems.values()).filter(i => i.status === 'processed' && i.is_read === 0);
      const bySource = {};
      for (const item of processed) {
        bySource[item.source_id] = (bySource[item.source_id] || 0) + 1;
      }
      return { all: processed.length, bySource };
    },
    _addContentItem: addContentItem,
  };

  let llmSettingsStore = null;
  let oauthLoggedIn = false;

  return {
    getState: () => 'running',
    getStatus: () => ({ state: 'running', dataSources: sources.size, llmConfigured: !!llmSettingsStore }),
    getDataSourceManager: () => mgr,
    getScheduler: () => scheduler,
    getDB: () => db,
    getLLMSettings: () => llmSettingsStore,
    setLLMSettings: (data) => { llmSettingsStore = data; },
    getOAuthStatus: () => ({ loggedIn: oauthLoggedIn }),
    startOAuthLogin: () => {},
    logoutOAuth: async () => { oauthLoggedIn = false; },
    _mgr: mgr,
    _schedulerActions: schedulerActions,
    _db: db,
    _setOAuthLoggedIn: (v) => { oauthLoggedIn = v; },
  };
}

// Mock engine that simulates a stopped engine
function createStoppedEngine() {
  return {
    getState: () => 'stopped',
    getStatus: () => ({ state: 'stopped', dataSources: 0, llmConfigured: false }),
    getDataSourceManager: () => null,
    getScheduler: () => null,
    getDB: () => null,
  };
}

describe('ApiServer', () => {
  let server;
  let port;
  let engine;

  before(async () => {
    engine = createMockEngine();
    server = new ApiServer(engine);
    port = await server.start(0); // OS-assigned random port
  });

  after(async () => {
    await server.stop();
  });

  it('GET /api/engine/status 應回傳引擎狀態', async () => {
    const res = await makeRequest(port, 'GET', '/api/engine/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'running');
  });

  it('GET /api/datasources 應回傳空陣列（初始）', async () => {
    const res = await makeRequest(port, 'GET', '/api/datasources');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('POST /api/datasources 應新增資料源', async () => {
    const ds = { id: 'test-1', type: 'youtube', name: 'Test', url: 'https://youtube.com/@test' };
    const res = await makeRequest(port, 'POST', '/api/datasources', ds);
    assert.equal(res.status, 201);
    assert.equal(res.body.id, 'test-1');
  });

  it('GET /api/datasources 應回傳已新增的資料源', async () => {
    const res = await makeRequest(port, 'GET', '/api/datasources');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, 'test-1');
  });

  it('PUT /api/datasources/:id 應更新資料源', async () => {
    const res = await makeRequest(port, 'PUT', '/api/datasources/test-1', { name: 'Updated' });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Updated');
  });

  it('PATCH /api/datasources/:id/toggle 應切換啟用狀態', async () => {
    const res = await makeRequest(port, 'PATCH', '/api/datasources/test-1/toggle', { enabled: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
  });

  it('GET /api/datasources/:id/stats 應回傳統計', async () => {
    const res = await makeRequest(port, 'GET', '/api/datasources/test-1/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.totalItems, 5);
  });

  it('POST /api/datasources/:id/check 應觸發立即檢查', async () => {
    const res = await makeRequest(port, 'POST', '/api/datasources/test-1/check');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const checkAction = engine._schedulerActions.find(a => a.action === 'check' && a.id === 'test-1');
    assert.ok(checkAction, 'scheduler.checkSource should have been called');
  });

  it('DELETE /api/datasources/:id 應刪除資料源', async () => {
    const res = await makeRequest(port, 'DELETE', '/api/datasources/test-1');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const listRes = await makeRequest(port, 'GET', '/api/datasources');
    assert.equal(listRes.body.length, 0);
  });

  it('GET /api/datasources/export 應回傳所有資料源的設定', async () => {
    // 先新增一個資料源
    await makeRequest(port, 'POST', '/api/datasources', {
      id: 'yt-export-test', type: 'youtube', name: 'Export Test',
      url: 'https://www.youtube.com/@test', enabled: true,
    });
    const res = await makeRequest(port, 'GET', '/api/datasources/export');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, '1');
    assert.ok(res.body.exportedAt);
    assert.ok(Array.isArray(res.body.sources));
    const src = res.body.sources.find(s => s.name === 'Export Test');
    assert.ok(src, 'should contain exported source');
    assert.equal(src.type, 'youtube');
    assert.equal(src.id, 'yt-export-test', 'export should include the original id');
  });

  it('POST /api/datasources/import 應匯入新資料源', async () => {
    const sources = [
      { type: 'rss', name: 'Import RSS', url: 'https://example.com/feed.xml', enabled: true },
    ];
    const res = await makeRequest(port, 'POST', '/api/datasources/import', { sources });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);
    assert.equal(res.body.skipped, 0);
    assert.equal(res.body.errors.length, 0);

    const listRes = await makeRequest(port, 'GET', '/api/datasources');
    const found = listRes.body.find(s => s.name === 'Import RSS');
    assert.ok(found, 'imported source should appear in list');
  });

  it('POST /api/datasources/import 重複 URL 應跳過', async () => {
    // 使用已存在的 URL（Export Test 已加入）
    const sources = [
      { type: 'youtube', name: 'Dup Test', url: 'https://www.youtube.com/@test', enabled: true },
    ];
    const res = await makeRequest(port, 'POST', '/api/datasources/import', { sources });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 0);
    assert.equal(res.body.skipped, 1);
  });

  it('POST /api/datasources/import 帶有 id 欄位時應復用原始 ID', async () => {
    const sources = [
      { id: 'my-original-id', type: 'rss', name: 'Original ID RSS', url: 'https://example.com/original-feed.xml', enabled: true },
    ];
    const res = await makeRequest(port, 'POST', '/api/datasources/import', { sources });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);

    const listRes = await makeRequest(port, 'GET', '/api/datasources');
    const found = listRes.body.find(s => s.url === 'https://example.com/original-feed.xml');
    assert.ok(found, 'imported source should appear in list');
    assert.equal(found.id, 'my-original-id', 'should use the original ID from export');
  });

  it('POST /api/datasources/import id 衝突時應 fallback 為 name-based ID', async () => {
    // Import again with the same ID but different URL (URL won't conflict, but ID will)
    const sources = [
      { id: 'my-original-id', type: 'rss', name: 'Conflict ID RSS', url: 'https://example.com/conflict-feed.xml', enabled: true },
    ];
    const res = await makeRequest(port, 'POST', '/api/datasources/import', { sources });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);

    const listRes = await makeRequest(port, 'GET', '/api/datasources');
    const found = listRes.body.find(s => s.url === 'https://example.com/conflict-feed.xml');
    assert.ok(found, 'imported source should appear in list');
    assert.notEqual(found.id, 'my-original-id', 'should use fallback ID when original ID conflicts');
  });

  it('POST /api/datasources/import 缺少必填欄位應回傳 errors', async () => {
    const sources = [
      { type: 'rss', name: 'No URL' },  // 缺少 url
    ];
    const res = await makeRequest(port, 'POST', '/api/datasources/import', { sources });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 0);
    assert.equal(res.body.errors.length, 1);
  });

  it('不存在的 API route 應回傳 404', async () => {
    const res = await makeRequest(port, 'GET', '/api/nonexistent');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not Found');
  });

  it('GET /api/content/unread-counts 應回傳未讀統計', async () => {
    // Add a content item to the mock db
    engine._db._addContentItem({ id: 10, title: 'News', status: 'processed', is_read: 0, source_id: 'src-1' });
    const res = await makeRequest(port, 'GET', '/api/content/unread-counts');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.all === 'number');
    assert.ok(typeof res.body.bySource === 'object');
  });

  it('GET /api/content 應回傳內容列表（含 status 欄位）', async () => {
    // Add a fetched item to verify multi-status support
    engine._db._addContentItem({ title: 'Fetched Item', status: 'fetched', summary: null });
    const res = await makeRequest(port, 'GET', '/api/content');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    // All returned items should have a status field
    assert.ok(res.body.every(item => item.status !== undefined), 'each item should have status field');
  });

  it('GET /api/content?sourceId=src-1 應依來源篩選', async () => {
    const res = await makeRequest(port, 'GET', '/api/content?sourceId=src-1');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.every(item => item.source_id === 'src-1'));
  });

  it('GET /api/content/:id 不存在時應回傳 404', async () => {
    const res = await makeRequest(port, 'GET', '/api/content/99999');
    assert.equal(res.status, 404);
  });

  it('PATCH /api/content/:id/read 應標記已讀', async () => {
    const item = engine._db._addContentItem({ title: 'Readable', status: 'processed' });
    const res = await makeRequest(port, 'PATCH', `/api/content/${item.id}/read`, { is_read: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('GET /api/settings/llm 尚未設定應回傳 null', async () => {
    const res = await makeRequest(port, 'GET', '/api/settings/llm');
    assert.equal(res.status, 200);
    assert.equal(res.body, null);
  });

  it('PUT /api/settings/llm 應儲存設定', async () => {
    const data = { provider: 'openai', apiKey: 'sk-test1234', model: 'gpt-4o-mini', maxTokens: 4096, temperature: 0.7, summarizationPrompt: '' };
    const res = await makeRequest(port, 'PUT', '/api/settings/llm', data);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('GET /api/settings/llm 儲存後應回傳遮罩版 apiKey', async () => {
    const res = await makeRequest(port, 'GET', '/api/settings/llm');
    assert.equal(res.status, 200);
    assert.ok(res.body !== null, 'should not be null after PUT');
    assert.equal(res.body.provider, 'openai');
    assert.ok(res.body.apiKey.startsWith('****'), 'apiKey should be masked');
    assert.ok(res.body.apiKey.endsWith('1234'), 'last 4 chars should be visible');
  });

  it('PUT /api/settings/llm 傳送遮罩 apiKey 應保留舊值', async () => {
    const res = await makeRequest(port, 'PUT', '/api/settings/llm', {
      provider: 'openai', apiKey: '****1234', model: 'gpt-4o', maxTokens: 2048, temperature: 0.5, summarizationPrompt: '',
    });
    assert.equal(res.status, 200);
    // Verify stored apiKey is still the original
    const getRes = await makeRequest(port, 'GET', '/api/settings/llm');
    assert.equal(getRes.body.apiKey, '****1234'); // still masked original key
  });

  it('POST /api/settings/llm/test 傳送遮罩 apiKey 應 fallback 到 DB 實際 key', async () => {
    // Ensure LLM settings are stored with a known key
    await makeRequest(port, 'PUT', '/api/settings/llm', {
      provider: 'gemini', apiKey: 'fake-key-abcd', model: 'gemini-pro',
    });

    // Send masked apiKey — should NOT return "provider and apiKey are required"
    const res = await makeRequest(port, 'POST', '/api/settings/llm/test', {
      provider: 'gemini', apiKey: '****abcd',
    });
    assert.equal(res.status, 200);
    // The handler must have used the actual key from DB, not the masked string.
    // Result may be valid:false (invalid fake key), but NOT the "missing apiKey" error.
    assert.notEqual(res.body.error, 'provider and apiKey are required');
  });

  it('GET /api/settings/llm/oauth/status 應回傳登入狀態', async () => {
    const res = await makeRequest(port, 'GET', '/api/settings/llm/oauth/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.loggedIn, false);
  });

  it('POST /api/settings/llm/oauth/login 應回傳 pending', async () => {
    const res = await makeRequest(port, 'POST', '/api/settings/llm/oauth/login');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'pending');
  });

  it('DELETE /api/settings/llm/oauth/logout 應回傳 ok', async () => {
    const res = await makeRequest(port, 'DELETE', '/api/settings/llm/oauth/logout');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('POST /api/settings/llm/test provider=openai-oauth 未登入應回傳 valid:false', async () => {
    engine._setOAuthLoggedIn(false);
    const res = await makeRequest(port, 'POST', '/api/settings/llm/test', { provider: 'openai-oauth' });
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, false);
    assert.equal(res.body.error, '尚未登入 OpenAI OAuth');
  });

  it('POST /api/settings/llm/test provider=openai-oauth 已登入應回傳 valid:true', async () => {
    engine._setOAuthLoggedIn(true);
    const res = await makeRequest(port, 'POST', '/api/settings/llm/test', { provider: 'openai-oauth' });
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, true);
    assert.deepEqual(res.body.models, ['gpt-5-codex-mini', 'gpt-5.2']);
    engine._setOAuthLoggedIn(false);
  });
});

describe('ApiServer (engine stopped)', () => {
  let server;
  let port;

  before(async () => {
    const engine = createStoppedEngine();
    server = new ApiServer(engine);
    port = await server.start(0);
  });

  after(async () => {
    await server.stop();
  });

  it('POST /api/datasources 在引擎未啟動時應回傳 503', async () => {
    const res = await makeRequest(port, 'POST', '/api/datasources', { id: 'x', type: 'youtube' });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Engine not running');
  });

  it('GET /api/engine/status 在引擎未啟動時仍應回傳狀態', async () => {
    const res = await makeRequest(port, 'GET', '/api/engine/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'stopped');
  });

  it('GET /api/datasources 在引擎未啟動時應回傳空陣列', async () => {
    const res = await makeRequest(port, 'GET', '/api/datasources');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });
});
