const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const DB = require('../src/database/db');
const Storage = require('../src/storage');
const DownloadQueue = require('../src/queue');
const LLMQueue = require('../src/llm-queue');
const Scheduler = require('../src/scheduler');
const { PermanentError } = require('../src/fetchers/youtube');

const TMP_DIR = path.join(__dirname, '_tmp_scheduler');
const DB_PATH = path.join(TMP_DIR, 'db', 'test.db');

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
function captureLogger() {
  const logs = { info: [], warn: [], error: [] };
  return {
    logger: {
      info: (msg) => logs.info.push(msg),
      warn: (msg) => logs.warn.push(msg),
      error: (msg) => logs.error.push(msg),
      debug: () => {},
    },
    logs,
  };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mockConfigManager() {
  return {};  // 空物件即可，DataSourceManager 負責資料源管理
}

function mockDataSourceManager(sources = []) {
  return {
    getEnabled: () => sources,
    getSourcePrompt: () => null,
  };
}
function mockYT(videos = []) {
  return {
    fetchRecentVideos: async () => videos,
    fetchTranscript: async (id) => `Transcript for ${id}`,
  };
}
function mockRSS(items = []) {
  return { fetchItems: async () => items };
}

/**
 * LLMQueue mock that executes tasks immediately in a microtask.
 * Supports event listeners via EventEmitter.
 */
function mockLLMQueue(maxRetries = 0) {
  const q = new EventEmitter();
  q.stop = () => {};
  q.drain = async () => {};
  q.updateRateLimit = () => {};
  q._stopped = false;
  q.addTask = (task) => {
    task.retryCount = task.retryCount || 0;
    task.maxRetries = task.maxRetries ?? maxRetries;
    process.nextTick(async () => {
      q.emit('taskStarted', task, {});
      try {
        const result = await task.execute();
        task.result = result;
        q.emit('taskCompleted', task, {});
      } catch (err) {
        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          q.emit('taskRetry', task, task.retryCount, 0, {});
          process.nextTick(async () => {
            try {
              const result = await task.execute();
              task.result = result;
              q.emit('taskCompleted', task, {});
            } catch (err2) {
              task.error = err2;
              q.emit('taskFailed', task, err2, {});
            }
          });
        } else {
          task.error = err;
          q.emit('taskFailed', task, err, {});
        }
      }
    });
  };
  return q;
}

describe('Scheduler', () => {
  let db;

  beforeEach(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
    db = new DB(DB_PATH);
    db.open();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  });

  it('start() / stop() 應正確控制排程狀態', () => {
    const scheduler = new Scheduler({
      configManager: mockConfigManager(), dataSourceManager: mockDataSourceManager(),
      queue: new DownloadQueue(), llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });
    scheduler.start();
    assert.equal(scheduler.running, true);
    scheduler.stop();
    assert.equal(scheduler.running, false);
  });

  it('checkNow() 新 RSS 項目應加入佇列並儲存（status=fetched）', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    const rssItems = [
      { itemId: 'rss-1', title: 'A1', content: 'C1', publishedDate: '2026-02-11', url: 'http://a/1', author: 'A' },
      { itemId: 'rss-2', title: 'A2', content: 'C2', publishedDate: '2026-02-11', url: 'http://a/2', author: 'A' },
    ];

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'Test', url: 'http://x/feed', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(completed.length, 2);
    assert.ok(db.itemExists('rss-1'));
    assert.ok(db.itemExists('rss-2'));
    // Items saved with status='fetched' (no LLM)
    assert.equal(db.getContentItemByItemId('rss-1').status, 'fetched');
  });

  it('已存在的項目不應重複加入佇列', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    let count = 0;
    queue.on('taskCompleted', () => count++);

    const rssItems = [{ itemId: 'dup-1', title: 'Dup', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }];

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(300);
    assert.equal(count, 1);

    await scheduler.checkNow();
    await sleep(300);
    assert.equal(count, 1); // 不應增加
  });

  it('queue 處理中的項目不應被重複加入', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 1 });
    let processCount = 0;

    const rssItems = [{ itemId: 'slow-1', title: 'Slow', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }];

    const slowStorage = {
      saveContent: async (item) => {
        processCount++;
        await sleep(400); // Simulate slow processing
        return new Storage(db, TMP_DIR).saveContent(item);
      },
      updateSummary: async () => {},
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: slowStorage, db, logger,
    });

    // First check: adds item to queue
    await scheduler.checkNow();
    // Second check immediately: item still processing, should NOT add again
    await scheduler.checkNow();
    await sleep(800);

    assert.equal(processCount, 1); // Should only process once
  });

  it('YouTube 項目應先下載字幕再儲存', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    let transcriptCalled = false;

    const ytMock = {
      fetchRecentVideos: async () => [
        { videoId: 'yt-001', title: 'YT Video', publishedDate: '2026-02-11', url: 'https://youtube.com/watch?v=yt-001', author: 'Ch' },
      ],
      fetchTranscript: async (id) => { transcriptCalled = true; return `Transcript for ${id}`; },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'youtube', name: 'YT', url: 'https://youtube.com/@test', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: ytMock, rssFetcher: mockRSS(),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(transcriptCalled, true);
    assert.ok(db.itemExists('yt-001'));

    const item = db.getContentItemByItemId('yt-001');
    const md = fs.readFileSync(path.join(TMP_DIR, 'content', item.markdown_file_path), 'utf8');
    assert.ok(md.includes('Transcript for yt-001'));
    // raw_content should also be saved
    assert.ok(item.raw_content.includes('Transcript for yt-001'));
  });

  it('有 LLM 服務時應呼叫摘要並更新狀態為 summarized', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const llmQueue = mockLLMQueue();
    let summarizeCalled = false;
    const llmMock = {
      summarize: async () => { summarizeCalled = true; return 'Mock summary text'; },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue,
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'llm-1', title: 'LLM Test', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(summarizeCalled, true);
    const item = db.getContentItemByItemId('llm-1');
    assert.equal(item.status, 'summarized');
    assert.equal(item.summary, 'Mock summary text');
  });

  it('有自訂 prompt 的來源應將 prompt 傳入 LLM summarize()', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const llmQueue = mockLLMQueue();
    let capturedPrompt;
    const llmMock = {
      summarize: async (content, title, customPrompt) => { capturedPrompt = customPrompt; return 'Mock summary'; },
    };

    const customPromptText = '自訂財經分析 prompt';
    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: {
        getEnabled: () => [
          { id: 'src-custom', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getSourcePrompt: (id) => id === 'src-custom' ? customPromptText : null,
      },
      queue, llmQueue,
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'prompt-1', title: 'Prompt Test', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(capturedPrompt, customPromptText);
  });

  it('checkSource() 應只檢查指定的資料源', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    let count = 0;
    queue.on('taskCompleted', () => count++);

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src-a', type: 'rss', name: 'A', url: 'http://a', checkInterval: 9999, enabled: true },
        { id: 'src-b', type: 'rss', name: 'B', url: 'http://b', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(),
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'x', title: 'X', content: 'C', publishedDate: '2026-02-11', url: 'http://x', author: 'A' }]),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkSource('src-a');
    await sleep(300);
    assert.equal(count, 1);

    // 不存在的 source 不應拋錯
    await scheduler.checkSource('nonexistent');
  });

  it('lookbackDays 應過濾超過天數的舊項目', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    const now = Date.now();
    const recentDate = new Date(now - 1 * 86400000).toISOString(); // 1 day ago
    const oldDate = new Date(now - 10 * 86400000).toISOString();   // 10 days ago

    const rssItems = [
      { itemId: 'recent-1', title: 'Recent', content: 'C', publishedDate: recentDate, url: 'http://a/1', author: 'A' },
      { itemId: 'old-1', title: 'Old', content: 'C', publishedDate: oldDate, url: 'http://a/2', author: 'A' },
    ];

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true, lookbackDays: 3 },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(completed.length, 1);
    assert.ok(db.itemExists('recent-1'));
    assert.ok(!db.itemExists('old-1'));
  });

  it('maxItems 應限制處理數量', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    const rssItems = [];
    for (let i = 0; i < 10; i++) {
      rssItems.push({ itemId: `item-${i}`, title: `Item ${i}`, content: 'C', publishedDate: '2026-02-11', url: `http://a/${i}`, author: 'A' });
    }

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true, maxItems: 3 },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(completed.length, 3);
  });

  it('lookbackDays + maxItems 同時設定應兩者都生效', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    const now = Date.now();
    const recentDate = new Date(now - 1 * 86400000).toISOString();
    const oldDate = new Date(now - 10 * 86400000).toISOString();

    const rssItems = [
      { itemId: 'r1', title: 'R1', content: 'C', publishedDate: recentDate, url: 'http://a/1', author: 'A' },
      { itemId: 'r2', title: 'R2', content: 'C', publishedDate: recentDate, url: 'http://a/2', author: 'A' },
      { itemId: 'r3', title: 'R3', content: 'C', publishedDate: recentDate, url: 'http://a/3', author: 'A' },
      { itemId: 'old', title: 'Old', content: 'C', publishedDate: oldDate, url: 'http://a/4', author: 'A' },
    ];

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true, lookbackDays: 3, maxItems: 2 },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // 4 items, 1 filtered by lookbackDays, 3 remain, maxItems=2 so only 2 processed
    assert.equal(completed.length, 2);
    assert.ok(!db.itemExists('old'));
  });

  it('未設定 maxItems/lookbackDays 時應處理全部項目', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    const rssItems = [];
    for (let i = 0; i < 5; i++) {
      rssItems.push({ itemId: `all-${i}`, title: `All ${i}`, content: 'C', publishedDate: '2026-02-11', url: `http://a/${i}`, author: 'A' });
    }

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(completed.length, 5);
  });

  it('LLM 摘要失敗時 item 應保持 status=\'fetched\'', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const llmQueue = mockLLMQueue(0); // no retries
    const llmFailed = [];
    llmQueue.on('taskFailed', (task) => llmFailed.push(task.id));

    const llmMock = {
      summarize: async () => { throw new Error('LLM API error'); },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue,
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'fail-1', title: 'Fail', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // Item IS saved (download succeeded) but stays at status='fetched'
    const item = db.getContentItemByItemId('fail-1');
    assert.ok(item !== null);
    assert.equal(item.status, 'fetched');
    assert.equal(llmFailed.length, 1);
  });

  it('LLM 佇列重試機制：暫時性失敗後應重試並成功', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    // Use real LLMQueue with retryAttempts: 1 and short delay
    const llmQueue = new LLMQueue({ retryAttempts: 1, retryDelay: 50, logger });
    let llmCallCount = 0;
    const llmMock = {
      summarize: async () => {
        llmCallCount++;
        if (llmCallCount === 1) throw new Error('LLM transient error');
        return 'summary text';
      },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue,
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'transient-1', title: 'Transient', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(600); // download + LLM with 50ms retry delay

    assert.equal(llmCallCount, 2);
    const item = db.getContentItemByItemId('transient-1');
    assert.ok(item !== null);
    assert.equal(item.status, 'summarized');
    llmQueue.stop();
  });

  it('enqueuePendingSummary() 應重新加入 LLM 佇列', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const llmQueue = mockLLMQueue();
    let summarizeCalled = false;
    const llmMock = {
      summarize: async () => { summarizeCalled = true; return 'resumed summary'; },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    const source = { id: 'src', type: 'rss', name: 'T' };
    // Simulate a fetched item in DB
    const storage = new Storage(db, TMP_DIR);
    await storage.saveContent({
      itemId: 'resume-1', title: 'Resume Item', content: 'raw content',
      sourceType: 'rss', sourceId: 'src', publishedDate: '2026-02-11',
      url: 'http://a', author: 'A',
    });

    scheduler.enqueuePendingSummary(source, {
      itemId: 'resume-1', title: 'Resume Item', rawContent: 'raw content',
    });

    await sleep(200);
    assert.ok(summarizeCalled);
    assert.equal(db.getContentItemByItemId('resume-1').status, 'summarized');
  });

  it('enqueuePendingSummary() 無 llmService 時不應加入佇列', async () => {
    const queue = new DownloadQueue();
    const llmQueue = mockLLMQueue();
    let addTaskCalled = false;
    const origAddTask = llmQueue.addTask.bind(llmQueue);
    llmQueue.addTask = (task) => { addTaskCalled = true; origAddTask(task); };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager(),
      queue, llmQueue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(),
      llmService: null, // no LLM
      storage: new Storage(db, TMP_DIR), db, logger,
    });

    scheduler.enqueuePendingSummary({ id: 'src' }, { itemId: 'x', title: 'x' });
    assert.ok(!addTaskCalled);
  });

  it('成功處理項目時應記錄完整 log 流程', async () => {
    const { logger: capLogger, logs } = captureLogger();
    const queue = new DownloadQueue({ concurrentLimit: 3 });

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'MySource', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(),
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'log-1', title: 'Log Test', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger: capLogger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // Should have source check log with stats
    assert.ok(logs.info.some(m => m.includes('[MySource]') && m.includes('Fetched') && m.includes('processing')));
    // Should have per-item processing log
    assert.ok(logs.info.some(m => m.includes('[MySource]') && m.includes('Processing:') && m.includes('Log Test')));
    // Should have content saved log
    assert.ok(logs.info.some(m => m.includes('[MySource]') && m.includes('Content saved:') && m.includes('Log Test')));
  });

  it('LLM 摘要失敗時應記錄 error log', async () => {
    const { logger: capLogger, logs } = captureLogger();
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const llmQueue = mockLLMQueue(0); // no retries

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'FailSource', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue,
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'errlog-1', title: 'Error Item', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: { summarize: async () => { throw new Error('API timeout'); } },
      storage: new Storage(db, TMP_DIR), db, logger: capLogger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // _summarizeItem should log the error with source tag
    assert.ok(logs.error.some(m => m.includes('[FailSource]') && m.includes('Error summarizing') && m.includes('API timeout')));
    // LLM Queue should log final failure
    assert.ok(logs.error.some(m => m.includes('[LLMQueue]') && m.includes('Failed:') && m.includes('Error Item')));
  });

  it('PermanentError 應寫入 DB 且不再重試', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 0 });
    const failed = [];
    queue.on('taskFailed', (task) => failed.push(task.id));

    const ytMock = {
      fetchRecentVideos: async () => [
        { videoId: 'nosub-1', title: 'No Sub', publishedDate: '2026-02-11', url: 'https://youtube.com/watch?v=nosub-1', author: 'Ch' },
      ],
      fetchTranscript: async () => { throw new PermanentError('no subtitles found'); },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'yt-src', type: 'youtube', name: 'YT', url: 'https://youtube.com/@test', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: ytMock, rssFetcher: mockRSS(),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // Should be recorded as failed in DB
    assert.equal(failed.length, 1);
    assert.ok(db.isItemFailed('nosub-1'));
    assert.ok(!db.itemExists('nosub-1')); // not in content_items

    // Second check: should NOT retry (DB blocks it)
    await scheduler.checkNow();
    await sleep(500);
    assert.equal(failed.length, 1); // no additional failure
  });

  it('PermanentError 失敗記錄應包含正確資訊', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 0 });

    const ytMock = {
      fetchRecentVideos: async () => [
        { videoId: 'perm-info-1', title: 'Perm Fail', publishedDate: '2026-02-11', url: 'https://youtube.com/watch?v=perm-info-1', author: 'Ch' },
      ],
      fetchTranscript: async () => { throw new PermanentError('no subtitles found for perm-info-1'); },
    };

    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'yt-src2', type: 'youtube', name: 'YT2', url: 'https://youtube.com/@test2', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue: mockLLMQueue(), youtubeFetcher: ytMock, rssFetcher: mockRSS(),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    const failedItems = db.getFailedItems({ sourceId: 'yt-src2' });
    assert.equal(failedItems.length, 1);
    assert.equal(failedItems[0].item_id, 'perm-info-1');
    assert.equal(failedItems[0].title, 'Perm Fail');
    assert.ok(failedItems[0].error_message.includes('no subtitles found'));
  });

  it('LLM 佇列重試時應記錄 retry warn log 並最終成功', async () => {
    const { logger: capLogger, logs } = captureLogger();
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    // Use real LLMQueue for proper retry logging
    const llmQueue = new LLMQueue({ retryAttempts: 1, retryDelay: 50, logger: capLogger });

    let callCount = 0;
    const scheduler = new Scheduler({
      configManager: mockConfigManager(),
      dataSourceManager: mockDataSourceManager([
        { id: 'src', type: 'rss', name: 'RetrySource', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, llmQueue,
      youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'retrylog-1', title: 'Retry Item', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: { summarize: async () => { callCount++; if (callCount <= 1) throw new Error('Transient'); return 'OK'; } },
      storage: new Storage(db, TMP_DIR), db, logger: capLogger,
    });

    await scheduler.checkNow();
    await sleep(600);

    // Should have retry warning from LLM queue
    assert.ok(logs.warn.some(m => m.includes('[LLMQueue] Retry #1') && m.includes('Retry Item')));
    // Should eventually save successfully
    assert.ok(logs.info.some(m => m.includes('[RetrySource]') && m.includes('Summary saved:') && m.includes('Retry Item')));
    assert.ok(db.itemExists('retrylog-1'));
    llmQueue.stop();
  });
});
