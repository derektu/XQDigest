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

  return {
    getState: () => 'running',
    getStatus: () => ({ state: 'running', dataSources: sources.size, llmConfigured: false }),
    getDataSourceManager: () => mgr,
    getScheduler: () => scheduler,
    _mgr: mgr,
    _schedulerActions: schedulerActions,
  };
}

// Mock engine that simulates a stopped engine
function createStoppedEngine() {
  return {
    getState: () => 'stopped',
    getStatus: () => ({ state: 'stopped', dataSources: 0, llmConfigured: false }),
    getDataSourceManager: () => null,
    getScheduler: () => null,
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

  it('不存在的 API route 應回傳 404', async () => {
    const res = await makeRequest(port, 'GET', '/api/nonexistent');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not Found');
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
