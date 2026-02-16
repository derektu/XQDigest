const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DB = require('../src/database/db');

const TMP_DB_DIR = path.join(__dirname, '_tmp_db');
const DB_PATH = path.join(TMP_DB_DIR, 'test.db');

function makeItem(overrides = {}) {
  return {
    source_type: 'youtube', source_id: 'source-1', item_id: 'vid-001',
    title: 'Test Video', url: 'https://youtube.com/watch?v=vid-001',
    author: 'Test Channel', published_date: '2026-02-11T10:00:00Z',
    fetched_date: '2026-02-11T12:00:00Z',
    markdown_file_path: 'youtube/2026-02-11_vid-001.md',
    summary: null, tags: null, status: 'new',
    ...overrides,
  };
}

describe('DB', () => {
  let db;

  before(() => {
    if (fs.existsSync(TMP_DB_DIR)) fs.rmSync(TMP_DB_DIR, { recursive: true });
    db = new DB(DB_PATH);
    db.open();
  });

  after(() => {
    db.close();
    if (fs.existsSync(TMP_DB_DIR)) fs.rmSync(TMP_DB_DIR, { recursive: true });
  });

  it('open() 應建立資料庫檔案並初始化 schema', () => {
    assert.ok(fs.existsSync(DB_PATH));
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    assert.ok(tables.includes('content_items'));
    assert.ok(tables.includes('data_sources'));
    assert.ok(tables.includes('llm_configs'));
    assert.ok(tables.includes('failed_items'));
  });

  it('insertContentItem() 應成功插入一筆記錄', () => {
    const result = db.insertContentItem(makeItem());
    assert.equal(result.changes, 1);
  });

  it('重複 item_id 插入應被忽略 (INSERT OR IGNORE)', () => {
    const result = db.insertContentItem(makeItem());
    assert.equal(result.changes, 0);
  });

  it('itemExists() 應正確判斷', () => {
    assert.equal(db.itemExists('vid-001'), true);
    assert.equal(db.itemExists('nonexistent'), false);
  });

  it('getContentItemByItemId() 應回傳完整記錄', () => {
    const item = db.getContentItemByItemId('vid-001');
    assert.equal(item.title, 'Test Video');
    assert.equal(item.status, 'new');
    assert.equal(item.source_type, 'youtube');
  });

  it('updateContentSummary() 應更新摘要和狀態', () => {
    db.updateContentSummary('vid-001', '這是摘要');
    const updated = db.getContentItemByItemId('vid-001');
    assert.equal(updated.summary, '這是摘要');
    assert.equal(updated.status, 'processed');
  });

  it('getContentItems() 分頁與篩選', () => {
    db.insertContentItem(makeItem({ item_id: 'rss-001', source_type: 'rss', title: 'RSS Article', status: 'new' }));
    db.insertContentItem(makeItem({ item_id: 'vid-002', title: 'Video 2', status: 'new' }));

    assert.equal(db.getContentItems().length, 3);
    assert.equal(db.getContentItems({ sourceType: 'rss' }).length, 1);
    assert.equal(db.getContentItems({ status: 'new' }).length, 2);
    assert.equal(db.getContentItems({ limit: 2 }).length, 2);
  });

  // --- failed_items ---

  it('insertFailedItem() 應成功插入一筆失敗記錄', () => {
    const result = db.insertFailedItem({
      source_type: 'youtube', source_id: 'src-1', item_id: 'fail-001',
      title: 'No Subtitles', url: 'https://youtube.com/watch?v=fail-001',
      error_message: 'yt-dlp: no subtitles found',
    });
    assert.equal(result.changes, 1);
  });

  it('重複 item_id 失敗記錄應被忽略 (INSERT OR IGNORE)', () => {
    const result = db.insertFailedItem({
      source_type: 'youtube', source_id: 'src-1', item_id: 'fail-001',
      title: 'No Subtitles', url: 'https://youtube.com/watch?v=fail-001',
      error_message: 'yt-dlp: no subtitles found',
    });
    assert.equal(result.changes, 0);
  });

  it('isItemFailed() 應正確判斷', () => {
    assert.equal(db.isItemFailed('fail-001'), true);
    assert.equal(db.isItemFailed('nonexistent'), false);
  });

  it('getFailedItems() 應回傳所有失敗記錄', () => {
    db.insertFailedItem({
      source_type: 'rss', source_id: 'src-2', item_id: 'fail-002',
      title: 'Another Fail', url: 'http://example.com/fail',
      error_message: 'some error',
    });
    const all = db.getFailedItems();
    assert.equal(all.length, 2);
  });

  it('getFailedItems({ sourceId }) 應可依來源篩選', () => {
    const filtered = db.getFailedItems({ sourceId: 'src-1' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].item_id, 'fail-001');
  });

  it('getStats() 應回傳正確統計', () => {
    const stats = db.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.bySource.find(s => s.source_type === 'youtube').count, 2);
    assert.equal(stats.bySource.find(s => s.source_type === 'rss').count, 1);
  });
});
