const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ConfigManager = require('../src/config');

const TMP_CONFIG = path.join(__dirname, '_tmp_settings.json');

const sampleConfig = {
  version: '1.0',
  app: { logLevel: 'debug', dataPath: './test-data' },
  download: { concurrentLimit: 5, retryAttempts: 2, retryDelay: 500, timeoutMs: 10000 },
  dataSources: [
    { id: 's1', type: 'youtube', name: 'YT Channel', url: 'https://youtube.com/@test', checkInterval: 1800, enabled: true, prompt: '自訂 YouTube prompt' },
    { id: 's2', type: 'rss', name: 'RSS Feed', url: 'https://example.com/feed', checkInterval: 3600, enabled: false },
  ],
  llm: { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini', baseUrl: null, summarizationPrompt: 'test', maxTokens: 500, temperature: 0.5 },
};

describe('ConfigManager', () => {
  before(() => {
    fs.writeFileSync(TMP_CONFIG, JSON.stringify(sampleConfig, null, 2));
  });

  after(() => {
    if (fs.existsSync(TMP_CONFIG)) fs.unlinkSync(TMP_CONFIG);
  });

  it('load() 應正確讀取 JSON 設定檔', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    const config = cm.load();
    assert.equal(config.version, '1.0');
    assert.equal(config.app.logLevel, 'debug');
  });

  it('get() 若未 load 過應自動載入', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    const config = cm.get();
    assert.equal(config.version, '1.0');
  });

  it('getDataSources() 應回傳所有資料源', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    assert.equal(cm.getDataSources().length, 2);
  });

  it('getEnabledDataSources() 應只回傳 enabled=true 的資料源', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    const enabled = cm.getEnabledDataSources();
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].id, 's1');
  });

  it('getLLMConfig() 應回傳 llm 區塊', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    const llm = cm.getLLMConfig();
    assert.equal(llm.provider, 'openai');
    assert.equal(llm.model, 'gpt-4o-mini');
  });

  it('getDownloadConfig() 應回傳 download 區塊', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    const dl = cm.getDownloadConfig();
    assert.equal(dl.concurrentLimit, 5);
    assert.equal(dl.retryAttempts, 2);
  });

  it('getLogLevel() 應回傳日誌等級', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    assert.equal(cm.getLogLevel(), 'debug');
  });

  it('getDataPath() 應回傳絕對路徑', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    const dataPath = cm.getDataPath();
    assert.ok(path.isAbsolute(dataPath));
    assert.ok(dataPath.endsWith('test-data'));
  });

  it('getSourcePrompt() 有自訂 prompt 的來源應回傳該 prompt', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    assert.equal(cm.getSourcePrompt('s1'), '自訂 YouTube prompt');
  });

  it('getSourcePrompt() 無自訂 prompt 的來源應回傳 null', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    assert.equal(cm.getSourcePrompt('s2'), null);
  });

  it('getSourcePrompt() 不存在的來源應回傳 null', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    assert.equal(cm.getSourcePrompt('nonexistent'), null);
  });

  it('設定檔變更應觸發 changed 事件', async () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    cm.startWatching();

    const changedPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('changed 事件未在 3 秒內觸發')), 3000);
      cm.on('changed', (newConfig, oldConfig) => {
        clearTimeout(timer);
        resolve({ newConfig, oldConfig });
      });
    });

    await new Promise(r => setTimeout(r, 500));
    const updated = { ...sampleConfig, app: { ...sampleConfig.app, logLevel: 'warn' } };
    fs.writeFileSync(TMP_CONFIG, JSON.stringify(updated, null, 2));

    const { newConfig, oldConfig } = await changedPromise;
    assert.equal(newConfig.app.logLevel, 'warn');
    assert.equal(oldConfig.app.logLevel, 'debug');
    cm.stopWatching();
  });

  it('無效 JSON 應觸發 error 事件', async () => {
    fs.writeFileSync(TMP_CONFIG, JSON.stringify(sampleConfig, null, 2));
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    cm.startWatching();

    const errorPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('error 事件未在 3 秒內觸發')), 3000);
      cm.on('error', (err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });

    await new Promise(r => setTimeout(r, 500));
    fs.writeFileSync(TMP_CONFIG, '{ invalid json !!!');

    const err = await errorPromise;
    assert.ok(err instanceof Error);
    cm.stopWatching();
  });
});
