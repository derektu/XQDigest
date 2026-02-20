const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ConfigManager = require('../src/config');

const TMP_CONFIG = path.join(__dirname, '_tmp_settings.json');
const TMP_PARTIAL_CONFIG = path.join(__dirname, '_tmp_partial_settings.json');
const NON_EXISTENT_CONFIG = path.join(__dirname, '_tmp_nonexistent.json');

const sampleConfig = {
  app: { logLevel: 'debug', dataPath: './test-data' },
  download: { concurrentLimit: 5, retryAttempts: 2, retryDelay: 500, timeoutMs: 10000 },
};

describe('ConfigManager', () => {
  before(() => {
    fs.writeFileSync(TMP_CONFIG, JSON.stringify(sampleConfig, null, 2));
  });

  after(() => {
    if (fs.existsSync(TMP_CONFIG)) fs.unlinkSync(TMP_CONFIG);
    if (fs.existsSync(TMP_PARTIAL_CONFIG)) fs.unlinkSync(TMP_PARTIAL_CONFIG);
    if (fs.existsSync(NON_EXISTENT_CONFIG)) fs.unlinkSync(NON_EXISTENT_CONFIG);
  });

  it('load() 應正確讀取 JSON 設定檔', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    const config = cm.load();
    assert.equal(config.app.logLevel, 'debug');
    assert.equal(config.download.concurrentLimit, 5);
  });

  it('get() 若未 load 過應自動載入', () => {
    const cm = new ConfigManager(TMP_CONFIG);
    assert.equal(cm.get().app.logLevel, 'debug');
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

  it('設定檔變更應觸發 changed 事件', async () => {
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    cm.startWatching();

    try {
      const changedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('changed 事件未在 5 秒內觸發')), 5000);
        cm.on('changed', (newConfig, oldConfig) => {
          // 忽略非預期的 spurious 事件（chokidar 可能因 metadata 變更而觸發）
          if (newConfig.app.logLevel !== 'warn') return;
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
    } finally {
      cm.stopWatching();
    }
  });

  it('無效 JSON 應觸發 error 事件', async () => {
    fs.writeFileSync(TMP_CONFIG, JSON.stringify(sampleConfig, null, 2));
    const cm = new ConfigManager(TMP_CONFIG);
    cm.load();
    cm.startWatching();

    try {
      const errorPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('error 事件未在 5 秒內觸發')), 5000);
        cm.on('error', (err) => {
          clearTimeout(timer);
          resolve(err);
        });
      });

      await new Promise(r => setTimeout(r, 500));
      fs.writeFileSync(TMP_CONFIG, '{ invalid json !!!');

      const err = await errorPromise;
      assert.ok(err instanceof Error);
    } finally {
      cm.stopWatching();
    }
  });

  // 預設值相關測試
  it('ConfigManager 無設定檔時應使用預設值', () => {
    const cm = new ConfigManager(NON_EXISTENT_CONFIG);
    const config = cm.load();

    // 驗證關鍵預設值
    assert.equal(config.app.logLevel, 'info');
    assert.equal(config.app.dataPath, './data');
    assert.equal(config.app.apiPort, 3579);
    assert.equal(config.download.concurrentLimit, 3);
    assert.equal(config.download.retryAttempts, 3);
    assert.equal(config.download.retryDelay, 1000);
    assert.equal(config.download.timeoutMs, 30000);
  });

  it('ConfigManager 應正確合併設定檔與預設值', () => {
    // 只覆蓋部分參數
    const partialConfig = {
      app: { logLevel: 'debug' },
      download: { concurrentLimit: 5 },
    };
    fs.writeFileSync(TMP_PARTIAL_CONFIG, JSON.stringify(partialConfig, null, 2));

    const cm = new ConfigManager(TMP_PARTIAL_CONFIG);
    const config = cm.load();

    // 被覆蓋的值
    assert.equal(config.app.logLevel, 'debug');
    assert.equal(config.download.concurrentLimit, 5);

    // 保留預設值的欄位
    assert.equal(config.app.dataPath, './data');
    assert.equal(config.app.apiPort, 3579);
    assert.equal(config.download.retryAttempts, 3);
    assert.equal(config.download.retryDelay, 1000);
    assert.equal(config.download.timeoutMs, 30000);
  });

  it('用戶設定應覆蓋預設值', () => {
    const customConfig = {
      app: {
        logLevel: 'error',
        dataPath: './custom-data',
        apiPort: 9999,
      },
      download: {
        concurrentLimit: 10,
        retryAttempts: 5,
        retryDelay: 2000,
        timeoutMs: 60000,
      },
    };
    fs.writeFileSync(TMP_PARTIAL_CONFIG, JSON.stringify(customConfig, null, 2));

    const cm = new ConfigManager(TMP_PARTIAL_CONFIG);
    const config = cm.load();

    // 所有值都被覆蓋
    assert.equal(config.app.logLevel, 'error');
    assert.equal(config.app.dataPath, './custom-data');
    assert.equal(config.app.apiPort, 9999);
    assert.equal(config.download.concurrentLimit, 10);
    assert.equal(config.download.retryAttempts, 5);
    assert.equal(config.download.retryDelay, 2000);
    assert.equal(config.download.timeoutMs, 60000);
  });

  it('部分覆蓋時其餘應保留預設值', () => {
    const partialConfig = {
      app: { logLevel: 'warn' },
      // download 區塊完全不設定
    };
    fs.writeFileSync(TMP_PARTIAL_CONFIG, JSON.stringify(partialConfig, null, 2));

    const cm = new ConfigManager(TMP_PARTIAL_CONFIG);
    const config = cm.load();

    // 覆蓋的值
    assert.equal(config.app.logLevel, 'warn');

    // 未覆蓋的 app 參數保留預設值
    assert.equal(config.app.dataPath, './data');
    assert.equal(config.app.apiPort, 3579);

    // download 整個區塊保留預設值
    assert.equal(config.download.concurrentLimit, 3);
    assert.equal(config.download.retryAttempts, 3);
    assert.equal(config.download.retryDelay, 1000);
    assert.equal(config.download.timeoutMs, 30000);
  });

  it('getDefaults() 應回傳預設配置副本', () => {
    const defaults1 = ConfigManager.getDefaults();
    const defaults2 = ConfigManager.getDefaults();

    // 驗證內容正確
    assert.equal(defaults1.app.logLevel, 'info');
    assert.equal(defaults1.app.dataPath, './data');

    // 驗證是副本（不是同一物件）
    assert.notEqual(defaults1, defaults2);
    defaults1.app.logLevel = 'modified';
    assert.equal(defaults2.app.logLevel, 'info'); // 不應被影響
  });
});
