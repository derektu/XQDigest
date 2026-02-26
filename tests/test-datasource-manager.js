const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DB = require('../src/database/db');
const DataSourceManager = require('../src/datasource-manager');

const TMP_DIR = path.join(__dirname, '_tmp_dsm');
const DB_PATH = path.join(TMP_DIR, 'db', 'test.db');

describe('DataSourceManager', () => {
  let db, mgr;

  beforeEach(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
    db = new DB(DB_PATH);
    db.open();
    mgr = new DataSourceManager(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  });

  it('add() 應新增資料源並回傳 camelCase 物件', () => {
    const ds = mgr.add({
      id: 'yt-test',
      type: 'youtube',
      name: 'Test Channel',
      url: 'https://www.youtube.com/@test',
    });
    assert.equal(ds.id, 'yt-test');
    assert.equal(ds.type, 'youtube');
    assert.equal(ds.name, 'Test Channel');
    assert.equal(ds.url, 'https://www.youtube.com/@test');
    assert.equal(ds.checkInterval, 3600);
    assert.equal(ds.maxItems, 10);
    assert.equal(ds.lookbackDays, 7);
    assert.equal(ds.prompt, '');
    assert.equal(ds.enabled, true);
  });

  it('add() 自訂參數應正確儲存', () => {
    const ds = mgr.add({
      id: 'rss-custom',
      type: 'rss',
      name: 'Custom Feed',
      url: 'https://example.com/feed',
      checkInterval: 1800,
      maxItems: 5,
      lookbackDays: 14,
      prompt: 'Custom prompt',
      enabled: false,
    });
    assert.equal(ds.checkInterval, 1800);
    assert.equal(ds.maxItems, 5);
    assert.equal(ds.lookbackDays, 14);
    assert.equal(ds.prompt, 'Custom prompt');
    assert.equal(ds.enabled, false);
  });

  it('add() 重複 id 應拋錯', () => {
    mgr.add({ id: 'dup', type: 'rss', name: 'A', url: 'http://a' });
    assert.throws(() => {
      mgr.add({ id: 'dup', type: 'rss', name: 'B', url: 'http://b' });
    });
  });

  it('add() 重複 URL 應拋錯且 code 為 DUPLICATE_URL', () => {
    mgr.add({ id: 'dup-url-1', type: 'rss', name: 'Original', url: 'http://same-url' });
    let caught;
    try {
      mgr.add({ id: 'dup-url-2', type: 'rss', name: 'Duplicate', url: 'http://same-url' });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, '應拋出錯誤');
    assert.equal(caught.code, 'DUPLICATE_URL');
    assert.ok(caught.message.includes('Original'), '錯誤訊息應包含原始資料源名稱');
  });

  it('add() 不同 URL 應正常新增', () => {
    mgr.add({ id: 'url-a', type: 'rss', name: 'A', url: 'http://url-a' });
    const ds = mgr.add({ id: 'url-b', type: 'rss', name: 'B', url: 'http://url-b' });
    assert.equal(ds.id, 'url-b');
  });

  it('getAll() 應回傳所有資料源', () => {
    mgr.add({ id: 'a', type: 'youtube', name: 'A', url: 'http://a' });
    mgr.add({ id: 'b', type: 'rss', name: 'B', url: 'http://b', enabled: false });
    const all = mgr.getAll();
    assert.equal(all.length, 2);
  });

  it('getEnabled() 應只回傳啟用的資料源', () => {
    mgr.add({ id: 'a', type: 'youtube', name: 'A', url: 'http://a', enabled: true });
    mgr.add({ id: 'b', type: 'rss', name: 'B', url: 'http://b', enabled: false });
    const enabled = mgr.getEnabled();
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].id, 'a');
  });

  it('getById() 應回傳指定資料源', () => {
    mgr.add({ id: 'x', type: 'rss', name: 'X', url: 'http://x' });
    const ds = mgr.getById('x');
    assert.equal(ds.id, 'x');
  });

  it('getById() 不存在的 id 應回傳 null', () => {
    const ds = mgr.getById('nonexistent');
    assert.equal(ds, null);
  });

  it('update() 應更新指定欄位', () => {
    mgr.add({ id: 'u', type: 'rss', name: 'Old', url: 'http://old' });
    const updated = mgr.update('u', { name: 'New', url: 'http://new', checkInterval: 600 });
    assert.equal(updated.name, 'New');
    assert.equal(updated.url, 'http://new');
    assert.equal(updated.checkInterval, 600);
    // 未更新的欄位不變
    assert.equal(updated.type, 'rss');
  });

  it('remove() 應刪除資料源', () => {
    mgr.add({ id: 'del', type: 'rss', name: 'Del', url: 'http://del' });
    mgr.remove('del');
    assert.equal(mgr.getById('del'), null);
  });

  it('remove() 預設不刪除 content_items', () => {
    mgr.add({ id: 'del-keep', type: 'rss', name: 'Del Keep', url: 'http://del-keep' });
    db.insertContentItem({
      source_type: 'rss', source_id: 'del-keep', item_id: 'ci-keep-1',
      title: 'T1', url: 'http://1', author: 'A',
      published_date: '2026-01-01', fetched_date: '2026-01-01',
      markdown_file_path: 'mock-keep.md', raw_content: null, summary: null, tags: null, status: 'fetched',
    });
    mgr.remove('del-keep');
    // 資料源刪除，但 content_items 應保留
    assert.equal(mgr.getById('del-keep'), null);
    const items = db.getContentItems({ sourceId: 'del-keep' });
    assert.equal(items.length, 1);
  });

  it('remove(id, { deleteData: true }) 應刪除 content_items 和 failed_items', () => {
    mgr.add({ id: 'del-data', type: 'rss', name: 'Del Data', url: 'http://del-data' });
    db.insertContentItem({
      source_type: 'rss', source_id: 'del-data', item_id: 'ci-data-1',
      title: 'T1', url: 'http://1', author: 'A',
      published_date: '2026-01-01', fetched_date: '2026-01-01',
      markdown_file_path: 'mock-data.md', raw_content: null, summary: null, tags: null, status: 'fetched',
    });
    db.insertFailedItem({
      source_type: 'rss', source_id: 'del-data', item_id: 'fi-data-1',
      title: 'F1', url: 'http://f1', error_message: 'err',
    });
    mgr.remove('del-data', { deleteData: true });
    assert.equal(mgr.getById('del-data'), null);
    const items = db.getContentItems({ sourceId: 'del-data' });
    assert.equal(items.length, 0);
    const failed = db.getFailedItems({ sourceId: 'del-data' });
    assert.equal(failed.length, 0);
  });

  it('remove(id, { deleteData: true }) 應刪除磁碟上的 markdown 檔案', () => {
    const mdPath = path.join(TMP_DIR, 'article.md');
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(mdPath, '# Test Article');

    mgr.add({ id: 'del-md', type: 'rss', name: 'Del MD', url: 'http://del-md' });
    db.insertContentItem({
      source_type: 'rss', source_id: 'del-md', item_id: 'ci-md-1',
      title: 'T1', url: 'http://1', author: 'A',
      published_date: '2026-01-01', fetched_date: '2026-01-01',
      markdown_file_path: mdPath, raw_content: null, summary: null, tags: null, status: 'fetched',
    });
    mgr.remove('del-md', { deleteData: true });
    assert.equal(fs.existsSync(mdPath), false);
  });

  it('remove(id, { deleteData: true }) markdown 檔不存在時不應拋出錯誤', () => {
    mgr.add({ id: 'del-nofile', type: 'rss', name: 'Del NoFile', url: 'http://del-nofile' });
    db.insertContentItem({
      source_type: 'rss', source_id: 'del-nofile', item_id: 'ci-nofile-1',
      title: 'T1', url: 'http://1', author: 'A',
      published_date: '2026-01-01', fetched_date: '2026-01-01',
      markdown_file_path: '/nonexistent/path/article.md', raw_content: null, summary: null, tags: null, status: 'fetched',
    });
    assert.doesNotThrow(() => mgr.remove('del-nofile', { deleteData: true }));
    assert.equal(mgr.getById('del-nofile'), null);
  });

  it('toggle() 應切換啟用狀態', () => {
    mgr.add({ id: 't', type: 'rss', name: 'T', url: 'http://t' });
    let ds = mgr.toggle('t', false);
    assert.equal(ds.enabled, false);
    ds = mgr.toggle('t', true);
    assert.equal(ds.enabled, true);
  });

  it('updateLastCheck() 應更新 lastCheck 時間', () => {
    mgr.add({ id: 'lc', type: 'rss', name: 'LC', url: 'http://lc' });
    assert.equal(mgr.getById('lc').lastCheck, null);
    mgr.updateLastCheck('lc');
    assert.notEqual(mgr.getById('lc').lastCheck, null);
  });

  it('getSourcePrompt() 有 prompt 時應回傳 prompt', () => {
    mgr.add({ id: 'p', type: 'rss', name: 'P', url: 'http://p', prompt: 'My prompt' });
    assert.equal(mgr.getSourcePrompt('p'), 'My prompt');
  });

  it('getSourcePrompt() 無 prompt 時應回傳 null', () => {
    mgr.add({ id: 'np', type: 'rss', name: 'NP', url: 'http://np' });
    assert.equal(mgr.getSourcePrompt('np'), null);
  });

  it('getSourcePrompt() 不存在的 id 應回傳 null', () => {
    assert.equal(mgr.getSourcePrompt('missing'), null);
  });

  it('getStats() 應回傳正確統計', () => {
    mgr.add({ id: 'stats-src', type: 'rss', name: 'Stats', url: 'http://stats' });

    // Insert some content items
    db.insertContentItem({
      source_type: 'rss', source_id: 'stats-src', item_id: 'ci-1',
      title: 'T1', url: 'http://1', author: 'A',
      published_date: '2026-01-01', fetched_date: '2026-01-01',
      markdown_file_path: 'f1.md', raw_content: null, summary: null, tags: null, status: 'fetched',
    });
    db.insertContentItem({
      source_type: 'rss', source_id: 'stats-src', item_id: 'ci-2',
      title: 'T2', url: 'http://2', author: 'A',
      published_date: '2026-01-02', fetched_date: '2026-01-02',
      markdown_file_path: 'f2.md', raw_content: null, summary: 'S', tags: null, status: 'summarized',
    });
    db.insertFailedItem({
      source_type: 'rss', source_id: 'stats-src', item_id: 'fi-1',
      title: 'F1', url: 'http://f1', error_message: 'err',
    });

    const stats = mgr.getStats('stats-src');
    assert.equal(stats.totalItems, 2);
    assert.equal(stats.processedItems, 1);
    assert.equal(stats.failedItems, 1);
    assert.equal(stats.lastCheck, null);
  });
});
