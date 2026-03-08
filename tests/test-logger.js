const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Logger = require('../src/logger');
const { LoggerConfig } = require('../src/logger');

const TMP_LOG_DIR = path.join(__dirname, '_tmp_logs');
const LOG_FILE = 'test.log';

function cleanup() {
  if (fs.existsSync(TMP_LOG_DIR)) fs.rmSync(TMP_LOG_DIR, { recursive: true });
}

function readLogFile(dir = TMP_LOG_DIR, file = LOG_FILE) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('LoggerConfig', () => {
  it('預設值應正確設定', () => {
    const config = new LoggerConfig();
    assert.equal(config.level, 'info');
    assert.equal(config.category, 'App');
    assert.equal(config.logFile, 'app.log');
    assert.equal(config.retentionDays, 7);
    assert.ok(config.logDir.endsWith('logs'));
  });

  it('傳入的值應覆蓋預設值', () => {
    const config = new LoggerConfig({ level: 'debug', category: 'API', logDir: '/tmp/logs', logFile: 'api.log', retentionDays: 14 });
    assert.equal(config.level, 'debug');
    assert.equal(config.category, 'API');
    assert.equal(config.logDir, '/tmp/logs');
    assert.equal(config.logFile, 'api.log');
    assert.equal(config.retentionDays, 14);
  });

  it('Logger 傳入 LoggerConfig 實例應正常運作', async () => {
    const config = new LoggerConfig({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    const logger = new Logger(config);
    logger.info('config instance test');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = readLogFile();
    assert.ok(content.includes('[INFO] config instance test'));
  });
});

describe('Logger', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('level=info 時 info/warn/error 應寫入，debug 不寫入', async () => {
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');
    logger.debug('debug hidden');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = readLogFile();
    assert.ok(content.includes('[INFO] info message'));
    assert.ok(content.includes('[WARN] warn message'));
    assert.ok(content.includes('[ERROR] error message'));
    assert.ok(!content.includes('debug hidden'));
  });

  it('日誌格式應為 [timestamp] [CATEGORY] [LEVEL] message', async () => {
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('format test');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const lines = readLogFile().trim().split('\n');
    for (const line of lines) {
      assert.match(line, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[\w+\] \[(INFO|WARN|ERROR|DEBUG)\] .+/);
    }
  });

  it('level=error 時只有 ERROR 等級寫入', async () => {
    const logger = new Logger({ level: 'error', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('hidden');
    logger.warn('hidden');
    logger.error('error only');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = readLogFile();
    assert.ok(content.includes('error only'));
    assert.ok(!content.includes('hidden'));
  });

  it('setLevel() 應能動態切換日誌等級', async () => {
    const logger = new Logger({ level: 'error', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('before - hidden');
    logger.setLevel('debug');
    logger.debug('after - visible');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = readLogFile();
    assert.ok(!content.includes('before - hidden'));
    assert.ok(content.includes('after - visible'));
  });

  it('log 目錄不存在時應自動建立', async () => {
    const nestedDir = path.join(TMP_LOG_DIR, 'sub', 'dir');
    const logger = new Logger({ level: 'info', logDir: nestedDir, logFile: LOG_FILE });
    logger.info('nested dir test');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    assert.ok(fs.existsSync(path.join(nestedDir, LOG_FILE)));
  });

  it('category 應出現在日誌輸出中', async () => {
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE, category: 'API' });
    logger.info('category test');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = readLogFile();
    assert.ok(content.includes('[API]'));
    assert.ok(content.includes('[INFO] category test'));
  });

  it('未指定 category 時預設為 App', async () => {
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('default category');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = readLogFile();
    assert.ok(content.includes('[App]'));
  });

  it('日期變更時應自動 rotate log', async () => {
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('before rotation');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    // Verify log file exists
    assert.ok(fs.existsSync(path.join(TMP_LOG_DIR, LOG_FILE)));

    // Create a new logger and simulate date change
    const logger2 = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    logger2.currentDate = toLocalDateStr(yesterday);

    // Write should trigger rotation
    logger2.info('after rotation');
    logger2.close();
    await new Promise(r => setTimeout(r, 200));

    // Rotated file should exist with yesterday's date
    const rotatedFile = `${LOG_FILE}.${toLocalDateStr(yesterday)}`;
    assert.ok(fs.existsSync(path.join(TMP_LOG_DIR, rotatedFile)),
      `Rotated file ${rotatedFile} should exist`);

    // Current log file should have the new entry
    const currentContent = readLogFile();
    assert.ok(currentContent.includes('after rotation'));

    // Rotated file should have the old entry
    const rotatedContent = readLogFile(TMP_LOG_DIR, rotatedFile);
    assert.ok(rotatedContent.includes('before rotation'));
  });

  it('啟動時若 log 檔為舊日期應自動 rotate', async () => {
    fs.mkdirSync(TMP_LOG_DIR, { recursive: true });
    const logPath = path.join(TMP_LOG_DIR, LOG_FILE);

    // 模擬昨天留下的 log 檔
    fs.writeFileSync(logPath, 'old log from yesterday\n');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fs.utimesSync(logPath, yesterday, yesterday);

    // 建立新 Logger（今天），首次寫入應觸發 rotate
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE });
    logger.info('today entry');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    // 舊 log 應被搬到 app.log.<昨天日期>
    const yesterdayStr = toLocalDateStr(yesterday);
    const rotatedPath = path.join(TMP_LOG_DIR, `${LOG_FILE}.${yesterdayStr}`);
    assert.ok(fs.existsSync(rotatedPath), `Rotated file ${LOG_FILE}.${yesterdayStr} should exist`);

    const rotatedContent = fs.readFileSync(rotatedPath, 'utf8');
    assert.ok(rotatedContent.includes('old log from yesterday'));

    // 今天的 log 檔只有今天的 entry
    const currentContent = readLogFile();
    assert.ok(currentContent.includes('today entry'));
    assert.ok(!currentContent.includes('old log from yesterday'));
  });

  it('超過 retentionDays 的舊 log 應被刪除', async () => {
    fs.mkdirSync(TMP_LOG_DIR, { recursive: true });

    // Create old log files (10 days ago and 3 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldFile = `${LOG_FILE}.${toLocalDateStr(oldDate)}`;
    fs.writeFileSync(path.join(TMP_LOG_DIR, oldFile), 'old log\n');

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const recentFile = `${LOG_FILE}.${toLocalDateStr(recentDate)}`;
    fs.writeFileSync(path.join(TMP_LOG_DIR, recentFile), 'recent log\n');

    // Create logger with 7-day retention and simulate rotation to trigger cleanup
    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE, retentionDays: 7 });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    logger.currentDate = toLocalDateStr(yesterday);

    // Write a current log first so rotation has something to rename
    fs.writeFileSync(path.join(TMP_LOG_DIR, LOG_FILE), 'current\n');
    logger.stream = null;

    logger.info('trigger rotation');
    logger.close();
    await new Promise(r => setTimeout(r, 200));

    // Old file (10 days) should be deleted
    assert.ok(!fs.existsSync(path.join(TMP_LOG_DIR, oldFile)),
      `Old file ${oldFile} should be deleted`);

    // Recent file (3 days) should be kept
    assert.ok(fs.existsSync(path.join(TMP_LOG_DIR, recentFile)),
      `Recent file ${recentFile} should be kept`);
  });

  it('retentionDays 內的 log 應保留', async () => {
    fs.mkdirSync(TMP_LOG_DIR, { recursive: true });

    // Create log files within retention period
    for (let i = 1; i <= 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const file = `${LOG_FILE}.${toLocalDateStr(d)}`;
      fs.writeFileSync(path.join(TMP_LOG_DIR, file), `log day -${i}\n`);
    }

    const logger = new Logger({ level: 'info', logDir: TMP_LOG_DIR, logFile: LOG_FILE, retentionDays: 7 });
    // Call _cleanOldLogs directly
    logger._cleanOldLogs();

    // All 5 files should still exist (within 7 days)
    for (let i = 1; i <= 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const file = `${LOG_FILE}.${toLocalDateStr(d)}`;
      assert.ok(fs.existsSync(path.join(TMP_LOG_DIR, file)),
        `File ${file} (${i} days old) should be kept`);
    }
  });
});

describe('Logger singleton', () => {
  const SINGLETON_LOG_DIR = path.join(__dirname, '_tmp_singleton_logs');
  const SINGLETON_LOG_FILE = 'singleton.log';

  function cleanupSingleton() {
    Logger.reset();
    if (fs.existsSync(SINGLETON_LOG_DIR)) fs.rmSync(SINGLETON_LOG_DIR, { recursive: true });
  }

  beforeEach(() => cleanupSingleton());
  afterEach(() => cleanupSingleton());

  it('init() 應建立 singleton 實例', () => {
    Logger.init(new LoggerConfig({ level: 'info', logDir: SINGLETON_LOG_DIR, logFile: SINGLETON_LOG_FILE }));
    assert.ok(Logger._instance);
    assert.equal(Logger._instance.level, 'info');
  });

  it('getLogger() 應回傳帶正確 category 的 child logger', async () => {
    Logger.init(new LoggerConfig({ level: 'info', logDir: SINGLETON_LOG_DIR, logFile: SINGLETON_LOG_FILE }));
    const child = Logger.getLogger('MyModule');
    child.info('hello from child');
    Logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = fs.readFileSync(path.join(SINGLETON_LOG_DIR, SINGLETON_LOG_FILE), 'utf8');
    assert.ok(content.includes('[MyModule]'));
    assert.ok(content.includes('[INFO] hello from child'));
  });

  it('getLogger() 未 init 時應回傳 no-op logger（不拋錯）', () => {
    const child = Logger.getLogger('NoInit');
    // Should not throw
    child.info('should not crash');
    child.warn('should not crash');
    child.error('should not crash');
    child.debug('should not crash');
  });

  it('getLogger() 在 init 前取得、init 後應能正常運作', async () => {
    const child = Logger.getLogger('EarlyBird');
    // Before init — no-op
    child.info('before init');

    // Now init
    Logger.init(new LoggerConfig({ level: 'info', logDir: SINGLETON_LOG_DIR, logFile: SINGLETON_LOG_FILE }));
    child.info('after init');
    Logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = fs.readFileSync(path.join(SINGLETON_LOG_DIR, SINGLETON_LOG_FILE), 'utf8');
    assert.ok(content.includes('[EarlyBird]'));
    assert.ok(content.includes('after init'));
    assert.ok(!content.includes('before init'));
  });

  it('static setLevel() 應更新 singleton 的 level', async () => {
    Logger.init(new LoggerConfig({ level: 'error', logDir: SINGLETON_LOG_DIR, logFile: SINGLETON_LOG_FILE }));
    const child = Logger.getLogger('LevelTest');
    child.info('hidden');
    Logger.setLevel('debug');
    child.debug('visible');
    Logger.close();
    await new Promise(r => setTimeout(r, 200));

    const content = fs.readFileSync(path.join(SINGLETON_LOG_DIR, SINGLETON_LOG_FILE), 'utf8');
    assert.ok(!content.includes('hidden'));
    assert.ok(content.includes('visible'));
  });

  it('static close() 應關閉 singleton 的 stream', async () => {
    Logger.init(new LoggerConfig({ level: 'info', logDir: SINGLETON_LOG_DIR, logFile: SINGLETON_LOG_FILE }));
    const child = Logger.getLogger('CloseTest');
    child.info('trigger stream');
    Logger.close();
    await new Promise(r => setTimeout(r, 200));
    assert.equal(Logger._instance.stream, null);
  });

  it('reset() 應清除 singleton', () => {
    Logger.init(new LoggerConfig({ level: 'info', logDir: SINGLETON_LOG_DIR, logFile: SINGLETON_LOG_FILE }));
    assert.ok(Logger._instance);
    Logger.reset();
    assert.equal(Logger._instance, null);
  });
});
