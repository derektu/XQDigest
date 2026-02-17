const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DB = require('../src/database/db');
const Storage = require('../src/storage');
const DownloadQueue = require('../src/queue');
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

function mockConfigManager(sources = []) {
  return {
    getEnabledDataSources: () => sources,
    getLLMConfig: () => ({ provider: 'openai', apiKey: '' }),
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
      configManager: mockConfigManager(), queue: new DownloadQueue(),
      youtubeFetcher: mockYT(), rssFetcher: mockRSS(),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });
    scheduler.start();
    assert.equal(scheduler.running, true);
    scheduler.stop();
    assert.equal(scheduler.running, false);
  });

  it('checkNow() 新 RSS 項目應加入佇列並儲存', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    const rssItems = [
      { itemId: 'rss-1', title: 'A1', content: 'C1', publishedDate: '2026-02-11', url: 'http://a/1', author: 'A' },
      { itemId: 'rss-2', title: 'A2', content: 'C2', publishedDate: '2026-02-11', url: 'http://a/2', author: 'A' },
    ];

    const scheduler = new Scheduler({
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'Test', url: 'http://x/feed', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(completed.length, 2);
    assert.ok(db.itemExists('rss-1'));
    assert.ok(db.itemExists('rss-2'));
  });

  it('已存在的項目不應重複加入佇列', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    let count = 0;
    queue.on('taskCompleted', () => count++);

    const rssItems = [{ itemId: 'dup-1', title: 'Dup', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }];

    const scheduler = new Scheduler({
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
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

    // Slow execute: item stays in queue for a while before completing
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
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
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
      configManager: mockConfigManager([
        { id: 'src', type: 'youtube', name: 'YT', url: 'https://youtube.com/@test', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: ytMock, rssFetcher: mockRSS(),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(transcriptCalled, true);
    assert.ok(db.itemExists('yt-001'));

    const item = db.getContentItemByItemId('yt-001');
    const md = fs.readFileSync(path.join(TMP_DIR, 'content', item.markdown_file_path), 'utf8');
    assert.ok(md.includes('Transcript for yt-001'));
  });

  it('有 LLM API Key 時應呼叫摘要並更新狀態為 processed', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    let summarizeCalled = false;
    const llmMock = {
      summarize: async () => { summarizeCalled = true; return 'Mock summary text'; },
    };

    const scheduler = new Scheduler({
      configManager: {
        getEnabledDataSources: () => [
          { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getLLMConfig: () => ({ provider: 'openai', apiKey: 'has-key' }),
        getSourcePrompt: () => null,
      },
      queue, youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'llm-1', title: 'LLM Test', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(summarizeCalled, true);
    const item = db.getContentItemByItemId('llm-1');
    assert.equal(item.status, 'processed');
    assert.equal(item.summary, 'Mock summary text');
  });

  it('有自訂 prompt 的來源應將 prompt 傳入 LLM summarize()', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    let capturedPrompt;
    const llmMock = {
      summarize: async (content, title, customPrompt) => { capturedPrompt = customPrompt; return 'Mock summary'; },
    };

    const customPromptText = '自訂財經分析 prompt';
    const scheduler = new Scheduler({
      configManager: {
        getEnabledDataSources: () => [
          { id: 'src-custom', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getLLMConfig: () => ({ provider: 'openai', apiKey: 'has-key' }),
        getSourcePrompt: (id) => id === 'src-custom' ? customPromptText : null,
      },
      queue, youtubeFetcher: mockYT(),
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
      configManager: mockConfigManager([
        { id: 'src-a', type: 'rss', name: 'A', url: 'http://a', checkInterval: 9999, enabled: true },
        { id: 'src-b', type: 'rss', name: 'B', url: 'http://b', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: mockYT(),
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
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true, lookbackDays: 3 },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
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
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true, maxItems: 3 },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
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
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true, lookbackDays: 3, maxItems: 2 },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
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
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: mockYT(), rssFetcher: mockRSS(rssItems),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    assert.equal(completed.length, 5);
  });

  it('摘要失敗時 item 不應存入 DB', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 0 });
    const failed = [];
    queue.on('taskFailed', (task) => failed.push(task.id));

    const llmMock = {
      summarize: async () => { throw new Error('LLM API error'); },
    };

    const scheduler = new Scheduler({
      configManager: {
        getEnabledDataSources: () => [
          { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getLLMConfig: () => ({ provider: 'openai', apiKey: 'has-key' }),
        getSourcePrompt: () => null,
      },
      queue, youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'fail-1', title: 'Fail', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // Item should NOT be in DB because summarize threw before save
    assert.ok(!db.itemExists('fail-1'));
    assert.equal(failed.length, 1);
  });

  it('暫時性失敗後下次排程應可重試該項目', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 0 });
    const failed = [];
    queue.on('taskFailed', (task) => failed.push(task.id));

    let llmCallCount = 0;
    const llmMock = {
      summarize: async () => {
        llmCallCount++;
        if (llmCallCount === 1) throw new Error('LLM error');
        return 'summary';
      },
    };

    const scheduler = new Scheduler({
      configManager: {
        getEnabledDataSources: () => [
          { id: 'src', type: 'rss', name: 'T', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getLLMConfig: () => ({ provider: 'openai', apiKey: 'has-key' }),
        getSourcePrompt: () => null,
      },
      queue, youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'transient-1', title: 'Transient', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: llmMock, storage: new Storage(db, TMP_DIR), db, logger,
    });

    // First attempt: LLM fails
    await scheduler.checkNow();
    await sleep(500);
    assert.ok(!db.itemExists('transient-1'));
    assert.equal(failed.length, 1);

    // Second attempt: transient failure released from _pendingItems, should retry and succeed
    await scheduler.checkNow();
    await sleep(500);
    assert.ok(db.itemExists('transient-1'));
    assert.equal(llmCallCount, 2);
  });

  it('成功處理項目時應記錄完整 log 流程', async () => {
    const { logger: capLogger, logs } = captureLogger();
    const queue = new DownloadQueue({ concurrentLimit: 3 });

    const scheduler = new Scheduler({
      configManager: mockConfigManager([
        { id: 'src', type: 'rss', name: 'MySource', url: 'http://x', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'log-1', title: 'Log Test', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: null, storage: new Storage(db, TMP_DIR), db, logger: capLogger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // Should have source check log with stats
    assert.ok(logs.info.some(m => m.includes('[MySource]') && m.includes('Fetched') && m.includes('processing')));
    // Should have per-item processing log
    assert.ok(logs.info.some(m => m.includes('[MySource]') && m.includes('Processing:') && m.includes('Log Test')));
    // Should have saved log
    assert.ok(logs.info.some(m => m.includes('[MySource]') && m.includes('Saved:') && m.includes('Log Test')));
  });

  it('處理失敗時應記錄 error log 和 queue failed log', async () => {
    const { logger: capLogger, logs } = captureLogger();
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 0 });

    const scheduler = new Scheduler({
      configManager: {
        getEnabledDataSources: () => [
          { id: 'src', type: 'rss', name: 'FailSource', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getLLMConfig: () => ({ provider: 'openai', apiKey: 'has-key' }),
        getSourcePrompt: () => null,
      },
      queue, youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'errlog-1', title: 'Error Item', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: { summarize: async () => { throw new Error('API timeout'); } },
      storage: new Storage(db, TMP_DIR), db, logger: capLogger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // _processItem should log the error with source tag
    assert.ok(logs.error.some(m => m.includes('[FailSource]') && m.includes('Error processing') && m.includes('API timeout')));
    // Queue should log final failure
    assert.ok(logs.error.some(m => m.includes('Failed:') && m.includes('Error Item')));
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
      configManager: mockConfigManager([
        { id: 'yt-src', type: 'youtube', name: 'YT', url: 'https://youtube.com/@test', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: ytMock, rssFetcher: mockRSS(),
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
      configManager: mockConfigManager([
        { id: 'yt-src2', type: 'youtube', name: 'YT2', url: 'https://youtube.com/@test2', checkInterval: 9999, enabled: true },
      ]),
      queue, youtubeFetcher: ytMock, rssFetcher: mockRSS(),
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

  it('處理重試時應記錄 retry warn log', async () => {
    const { logger: capLogger, logs } = captureLogger();
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 1, retryDelay: 50 });

    let callCount = 0;
    const scheduler = new Scheduler({
      configManager: {
        getEnabledDataSources: () => [
          { id: 'src', type: 'rss', name: 'RetrySource', url: 'http://x', checkInterval: 9999, enabled: true },
        ],
        getLLMConfig: () => ({ provider: 'openai', apiKey: 'has-key' }),
        getSourcePrompt: () => null,
      },
      queue, youtubeFetcher: mockYT(),
      rssFetcher: mockRSS([{ itemId: 'retrylog-1', title: 'Retry Item', content: 'C', publishedDate: '2026-02-11', url: 'http://a', author: 'A' }]),
      llmService: { summarize: async () => { callCount++; if (callCount <= 1) throw new Error('Transient'); return 'OK'; } },
      storage: new Storage(db, TMP_DIR), db, logger: capLogger,
    });

    await scheduler.checkNow();
    await sleep(500);

    // Should have retry warning
    assert.ok(logs.warn.some(m => m.includes('Retry #1') && m.includes('Retry Item')));
    // Should eventually save successfully
    assert.ok(logs.info.some(m => m.includes('Saved:') && m.includes('Retry Item')));
    assert.ok(db.itemExists('retrylog-1'));
  });
});
