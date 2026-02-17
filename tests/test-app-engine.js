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
    version: '1.0',
    app: { logLevel: 'error', dataPath: DATA_DIR },
    download: { concurrentLimit: 2, retryAttempts: 1, retryDelay: 100, timeoutMs: 5000 },
    dataSources: [],
    llm: { provider: 'openai', apiKey: '', model: 'gpt-4' },
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

  it('restart() 應依序 stop → start', async () => {
    writeConfig();
    const engine = new AppEngine({ configPath: CONFIG_PATH });
    await engine.start();

    const states = [];
    engine.on('stateChange', (state) => states.push(state));

    await engine.restart();
    assert.equal(engine.getState(), 'running');
    assert.deepEqual(states, ['stopping', 'stopped', 'starting', 'running']);

    await engine.stop();
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
});
