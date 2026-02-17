const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const DB = require('../src/database/db');
const Storage = require('../src/storage');

const TMP_DIR = path.join(__dirname, '_tmp_storage');
const DB_PATH = path.join(TMP_DIR, 'db', 'test.db');

describe('Storage', () => {
  let db, storage;

  before(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
    db = new DB(DB_PATH);
    db.open();
    storage = new Storage(db, TMP_DIR);
  });

  after(() => {
    db.close();
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  });

  const ytItem = {
    sourceType: 'youtube', sourceId: 'source-1', itemId: 'abc123',
    title: '測試影片標題', url: 'https://youtube.com/watch?v=abc123',
    author: '測試頻道', publishedDate: '2026-02-11T10:00:00Z',
    content: '這是影片字幕內容',
  };

  it('saveContent() YouTube 項目應建立 Markdown 和 DB 記錄', async () => {
    const relativePath = await storage.saveContent(ytItem);

    assert.ok(relativePath.startsWith('source-1/'));
    assert.ok(relativePath.includes('2026-02-11'));
    assert.ok(relativePath.endsWith('.md'));

    const fullPath = path.join(TMP_DIR, 'content', relativePath);
    assert.ok(fs.existsSync(fullPath));

    const dbItem = db.getContentItemByItemId('abc123');
    assert.equal(dbItem.title, '測試影片標題');
    assert.equal(dbItem.status, 'new');
  });

  it('Markdown 應含正確的 front matter', async () => {
    const relativePath = storage._getRelativePath(ytItem);
    const fullPath = path.join(TMP_DIR, 'content', relativePath);
    const parsed = matter(fs.readFileSync(fullPath, 'utf8'));

    assert.equal(parsed.data.title, '測試影片標題');
    assert.equal(parsed.data.source, 'youtube');
    assert.equal(parsed.data.item_id, 'abc123');
    assert.equal(parsed.data.author, '測試頻道');
    assert.ok(parsed.data.fetched);
  });

  it('YouTube Markdown body 應有字幕區塊', async () => {
    const relativePath = storage._getRelativePath(ytItem);
    const fullPath = path.join(TMP_DIR, 'content', relativePath);
    const parsed = matter(fs.readFileSync(fullPath, 'utf8'));

    assert.ok(parsed.content.includes('# 測試影片標題'));
    assert.ok(parsed.content.includes('### YouTube 字幕'));
    assert.ok(parsed.content.includes('這是影片字幕內容'));
  });

  it('saveContent() RSS 項目應建立 RSS 格式的 Markdown', async () => {
    const rssItem = {
      sourceType: 'rss', sourceId: 'source-2',
      itemId: 'https://example.com/article-1', title: 'RSS 文章標題',
      url: 'https://example.com/article-1', author: '部落格作者',
      publishedDate: '2026-02-10T08:00:00Z', content: '<p>這是文章內容</p>',
    };
    const rssPath = await storage.saveContent(rssItem);
    assert.ok(rssPath.startsWith('source-2/'));

    const content = fs.readFileSync(path.join(TMP_DIR, 'content', rssPath), 'utf8');
    assert.ok(content.includes('### RSS 文章內容'));
  });

  it('updateSummary() 應追加摘要到 Markdown 並更新 DB', async () => {
    const summaryText = '這是AI摘要\n\n## 關鍵重點\n\n- 重點A\n- 重點B\n- 重點C';
    await storage.updateSummary(ytItem, summaryText);

    const relativePath = storage._getRelativePath(ytItem);
    const fullPath = path.join(TMP_DIR, 'content', relativePath);
    const content = fs.readFileSync(fullPath, 'utf8');

    assert.ok(content.includes('## AI 摘要'));
    assert.ok(content.includes('這是AI摘要'));
    assert.ok(content.includes('- 重點A'));

    const dbItem = db.getContentItemByItemId('abc123');
    assert.equal(dbItem.summary, summaryText);
    assert.equal(dbItem.status, 'processed');
  });

  it('updateSummary() 重複呼叫應覆蓋而非重複追加', async () => {
    const item = {
      sourceType: 'youtube', sourceId: 'source-1', itemId: 'idempotent-1',
      title: '冪等測試', url: 'https://youtube.com/watch?v=idempotent-1',
      author: 'Test', publishedDate: '2026-02-11T10:00:00Z', content: '原始內容',
    };
    await storage.saveContent(item);
    await storage.updateSummary(item, '第一次摘要');
    await storage.updateSummary(item, '第二次摘要');

    const relativePath = storage._getRelativePath(item);
    const content = fs.readFileSync(path.join(TMP_DIR, 'content', relativePath), 'utf8');
    const matches = content.match(/## AI 摘要/g);
    assert.equal(matches.length, 1, '應只有一個 AI 摘要區塊');
    assert.ok(content.includes('第二次摘要'), '應包含最新摘要');
    assert.ok(!content.includes('第一次摘要'), '不應包含舊摘要');
  });

  it('自訂 contentFormatter 應覆蓋預設格式', async () => {
    const customStorage = new Storage(db, TMP_DIR, {
      contentFormatters: {
        youtube: (item) => `### 自訂 YouTube 格式\n\n${item.content}\n`,
      },
    });
    const customItem = {
      sourceType: 'youtube', sourceId: 'source-1', itemId: 'custom-fmt-1',
      title: '自訂格式測試', url: 'https://youtube.com/watch?v=custom-fmt-1',
      author: '測試', publishedDate: '2026-02-11T10:00:00Z', content: '自訂內容',
    };
    const relPath = await customStorage.saveContent(customItem);
    const content = fs.readFileSync(path.join(TMP_DIR, 'content', relPath), 'utf8');
    assert.ok(content.includes('### 自訂 YouTube 格式'));
    assert.ok(!content.includes('### YouTube 字幕'));
  });

  it('未知 sourceType 應使用預設 formatter', async () => {
    const unknownItem = {
      sourceType: 'podcast', sourceId: 'source-3', itemId: 'unknown-type-1',
      title: '未知類型測試', url: 'https://example.com/podcast',
      content: 'Podcast 內容', publishedDate: '2026-02-11T10:00:00Z',
    };
    const relPath = await storage.saveContent(unknownItem);
    const content = fs.readFileSync(path.join(TMP_DIR, 'content', relPath), 'utf8');
    assert.ok(content.includes('Podcast 內容'));
    assert.ok(!content.includes('### YouTube'));
    assert.ok(!content.includes('### RSS'));
  });

  it('新增 contentFormatter 不應影響其他預設 formatters', async () => {
    const customStorage = new Storage(db, TMP_DIR, {
      contentFormatters: {
        podcast: (item) => `### Podcast\n\n${item.content}\n`,
      },
    });
    // 預設 youtube formatter 應仍然存在
    const ytItem2 = {
      sourceType: 'youtube', sourceId: 'source-1', itemId: 'preserve-default-1',
      title: '預設格式測試', url: 'https://youtube.com/watch?v=preserve-default-1',
      author: '測試', publishedDate: '2026-02-11T10:00:00Z', content: '預設內容',
    };
    const relPath = await customStorage.saveContent(ytItem2);
    const content = fs.readFileSync(path.join(TMP_DIR, 'content', relPath), 'utf8');
    assert.ok(content.includes('### YouTube 字幕'));
  });

  it('item_id 含特殊字元應被安全處理', async () => {
    const specialItem = {
      sourceType: 'rss', sourceId: 'source-2',
      itemId: 'https://example.com/article?id=123&cat=news',
      title: 'Special Chars', url: 'https://example.com/article?id=123',
      content: 'content', publishedDate: '2026-02-11T00:00:00Z',
    };
    const specialPath = await storage.saveContent(specialItem);
    assert.ok(!specialPath.includes('?'));
    assert.ok(!specialPath.includes('&'));
    assert.ok(fs.existsSync(path.join(TMP_DIR, 'content', specialPath)));
  });
});
