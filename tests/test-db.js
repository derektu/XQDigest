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
    assert.ok(tables.includes('app_settings'));
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

  it('markContentRead() 應更新 is_read 欄位', () => {
    // vid-001 was inserted above; get its numeric id
    const item = db.getContentItemByItemId('vid-001');
    assert.equal(item.is_read, 0, 'default is_read should be 0');
    db.markContentRead(item.id, true);
    const updated = db.getContentItemByItemId('vid-001');
    assert.equal(updated.is_read, 1);
    // Mark back as unread
    db.markContentRead(item.id, false);
    const reverted = db.getContentItemByItemId('vid-001');
    assert.equal(reverted.is_read, 0);
  });

  it('getContentItems() 可依 is_read 篩選', () => {
    // Mark vid-001 as read again for this test
    const item = db.getContentItemByItemId('vid-001');
    db.markContentRead(item.id, true);
    const unread = db.getContentItems({ isRead: false });
    const read = db.getContentItems({ isRead: true });
    assert.ok(unread.every(i => i.is_read === 0), 'all unread items should have is_read=0');
    assert.ok(read.every(i => i.is_read === 1), 'all read items should have is_read=1');
    // Cleanup
    db.markContentRead(item.id, false);
  });

  it('getUnreadCounts() 應回傳正確未讀數', () => {
    // Mark vid-001 as processed and then get unread counts
    db.updateContentSummary('vid-001', '摘要內容');
    const counts = db.getUnreadCounts();
    assert.ok(typeof counts.all === 'number', 'all should be a number');
    assert.ok(typeof counts.bySource === 'object', 'bySource should be an object');
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

  // --- app_settings ---

  it('getAppSetting() 不存在的 key 應回傳 null', () => {
    assert.equal(db.getAppSetting('nonexistent'), null);
  });

  it('setAppSetting() 應儲存並回傳 JSON 物件', () => {
    const value = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' };
    db.setAppSetting('llm', value);
    const result = db.getAppSetting('llm');
    assert.equal(result.provider, 'openai');
    assert.equal(result.apiKey, 'sk-test');
    assert.equal(result.model, 'gpt-4o-mini');
  });

  it('setAppSetting() 重複 key 應覆蓋（INSERT OR REPLACE）', () => {
    db.setAppSetting('llm', { provider: 'gemini', apiKey: 'new-key', model: 'gemini-pro' });
    const result = db.getAppSetting('llm');
    assert.equal(result.provider, 'gemini');
    assert.equal(result.apiKey, 'new-key');
  });

  it('setAppSetting() 應支援不同 key', () => {
    db.setAppSetting('other_setting', { foo: 'bar' });
    const result = db.getAppSetting('other_setting');
    assert.equal(result.foo, 'bar');
    // llm key 不受影響
    const llm = db.getAppSetting('llm');
    assert.equal(llm.provider, 'gemini');
  });

  it('getStats() 應回傳正確統計', () => {
    // 此測試依賴上方已插入的 3 筆 content_items (vid-001, rss-001, vid-002)
    const stats = db.getStats();
    assert.ok(stats.total >= 3, 'total should include all inserted items');
    assert.ok(Array.isArray(stats.bySource), 'bySource should be an array');
    assert.ok(Array.isArray(stats.byStatus), 'byStatus should be an array');
    // Verify structure: each entry has source_type/status and count
    const ytStat = stats.bySource.find(s => s.source_type === 'youtube');
    const rssStat = stats.bySource.find(s => s.source_type === 'rss');
    assert.ok(ytStat && ytStat.count >= 2, 'youtube count should be at least 2');
    assert.ok(rssStat && rssStat.count >= 1, 'rss count should be at least 1');
  });
});
