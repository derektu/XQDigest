const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class DB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  open() {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this._initSchema();
    return this;
  }

  _initSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);
  }

  // --- content_items ---

  insertContentItem(item) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO content_items
        (source_type, source_id, item_id, title, url, author, published_date, fetched_date, markdown_file_path, summary, tags, status)
      VALUES
        (@source_type, @source_id, @item_id, @title, @url, @author, @published_date, @fetched_date, @markdown_file_path, @summary, @tags, @status)
    `);
    return stmt.run(item);
  }

  updateContentSummary(itemId, summary) {
    const stmt = this.db.prepare(`
      UPDATE content_items
      SET summary = ?, status = 'processed', updated_at = CURRENT_TIMESTAMP
      WHERE item_id = ?
    `);
    return stmt.run(summary, itemId);
  }

  getContentItemByItemId(itemId) {
    return this.db.prepare('SELECT * FROM content_items WHERE item_id = ?').get(itemId);
  }

  getContentItems({ status, sourceType, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM content_items WHERE 1=1';
    const params = {};
    if (status) {
      sql += ' AND status = @status';
      params.status = status;
    }
    if (sourceType) {
      sql += ' AND source_type = @sourceType';
      params.sourceType = sourceType;
    }
    sql += ' ORDER BY published_date DESC LIMIT @limit OFFSET @offset';
    params.limit = limit;
    params.offset = offset;
    return this.db.prepare(sql).all(params);
  }

  itemExists(itemId) {
    const row = this.db.prepare('SELECT 1 FROM content_items WHERE item_id = ?').get(itemId);
    return !!row;
  }

  // --- data_sources ---

  upsertDataSource(source) {
    const stmt = this.db.prepare(`
      INSERT INTO data_sources (source_type, source_name, source_url, check_interval, is_active)
      VALUES (@source_type, @source_name, @source_url, @check_interval, @is_active)
      ON CONFLICT(rowid) DO UPDATE SET
        source_name = @source_name,
        source_url = @source_url,
        check_interval = @check_interval,
        is_active = @is_active
    `);
    return stmt.run(source);
  }

  updateLastCheck(sourceId) {
    // sourceId here refers to the data_sources table id
    this.db.prepare('UPDATE data_sources SET last_check = CURRENT_TIMESTAMP WHERE id = ?').run(sourceId);
  }

  // --- stats ---

  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM content_items').get();
    const bySource = this.db.prepare('SELECT source_type, COUNT(*) as count FROM content_items GROUP BY source_type').all();
    const byStatus = this.db.prepare('SELECT status, COUNT(*) as count FROM content_items GROUP BY status').all();
    return { total: total.count, bySource, byStatus };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = DB;
