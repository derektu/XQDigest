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
        (source_type, source_id, item_id, title, url, author, published_date, fetched_date, markdown_file_path, raw_content, summary, tags, status)
      VALUES
        (@source_type, @source_id, @item_id, @title, @url, @author, @published_date, @fetched_date, @markdown_file_path, @raw_content, @summary, @tags, @status)
    `);
    return stmt.run(item);
  }

  updateContentSummary(itemId, summary) {
    const stmt = this.db.prepare(`
      UPDATE content_items
      SET summary = ?, status = 'summarized', updated_at = CURRENT_TIMESTAMP
      WHERE item_id = ?
    `);
    return stmt.run(summary, itemId);
  }

  getContentItemByItemId(itemId) {
    return this.db.prepare('SELECT * FROM content_items WHERE item_id = ?').get(itemId);
  }

  getContentItems({ statuses, status, sourceType, sourceId, isRead, limit = 50, offset = 0 } = {}) {
    let sql = `
      SELECT ci.*, ds.source_name
      FROM content_items ci
      LEFT JOIN data_sources ds ON ci.source_id = ds.id
      WHERE 1=1
    `;
    const params = {};
    if (statuses && Array.isArray(statuses) && statuses.length > 0) {
      const placeholders = statuses.map((_, i) => `@s${i}`).join(', ');
      sql += ` AND ci.status IN (${placeholders})`;
      statuses.forEach((s, i) => { params[`s${i}`] = s; });
    } else if (status) {
      sql += ' AND ci.status = @status';
      params.status = status;
    }
    if (sourceType) {
      sql += ' AND ci.source_type = @sourceType';
      params.sourceType = sourceType;
    }
    if (sourceId) {
      sql += ' AND ci.source_id = @sourceId';
      params.sourceId = sourceId;
    }
    if (isRead !== undefined) {
      sql += ' AND ci.is_read = @isRead';
      params.isRead = isRead ? 1 : 0;
    }
    sql += ' ORDER BY ci.published_date DESC LIMIT @limit OFFSET @offset';
    params.limit = limit;
    params.offset = offset;
    return this.db.prepare(sql).all(params);
  }

  getItemsByStatus(status) {
    return this.db.prepare('SELECT * FROM content_items WHERE status = ?').all(status);
  }

  markContentRead(id, isRead) {
    return this.db.prepare(
      'UPDATE content_items SET is_read = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(isRead ? 1 : 0, id);
  }

  getUnreadCounts() {
    const all = this.db.prepare(
      "SELECT COUNT(*) as count FROM content_items WHERE is_read = 0 AND status IN ('processed', 'summarized')"
    ).get();
    const bySourceRows = this.db.prepare(
      "SELECT source_id, COUNT(*) as count FROM content_items WHERE is_read = 0 AND status IN ('processed', 'summarized') GROUP BY source_id"
    ).all();
    const bySource = {};
    for (const row of bySourceRows) {
      bySource[row.source_id] = row.count;
    }
    return { all: all.count, bySource };
  }

  itemExists(itemId) {
    const row = this.db.prepare('SELECT 1 FROM content_items WHERE item_id = ?').get(itemId);
    return !!row;
  }

  // --- failed_items ---

  insertFailedItem(item) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO failed_items
        (source_type, source_id, item_id, title, url, error_message)
      VALUES
        (@source_type, @source_id, @item_id, @title, @url, @error_message)
    `);
    return stmt.run(item);
  }

  isItemFailed(itemId) {
    const row = this.db.prepare('SELECT 1 FROM failed_items WHERE item_id = ?').get(itemId);
    return !!row;
  }

  getFailedItems({ sourceId } = {}) {
    let sql = 'SELECT * FROM failed_items WHERE 1=1';
    const params = {};
    if (sourceId) {
      sql += ' AND source_id = @sourceId';
      params.sourceId = sourceId;
    }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(params);
  }

  // --- data_sources ---

  getAllDataSources() {
    return this.db.prepare('SELECT * FROM data_sources ORDER BY created_at ASC').all();
  }

  getActiveDataSources() {
    return this.db.prepare('SELECT * FROM data_sources WHERE is_active = 1 ORDER BY created_at ASC').all();
  }

  getDataSourceById(id) {
    return this.db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
  }

  getDataSourceByUrl(url) {
    return this.db.prepare(
      'SELECT id, source_name FROM data_sources WHERE source_url = ?'
    ).get(url);
  }

  insertDataSource(ds) {
    const stmt = this.db.prepare(`
      INSERT INTO data_sources (id, source_type, source_name, source_url, check_interval, max_items, lookback_days, prompt, is_active)
      VALUES (@id, @source_type, @source_name, @source_url, @check_interval, @max_items, @lookback_days, @prompt, @is_active)
    `);
    return stmt.run(ds);
  }

  updateDataSource(id, fields) {
    const allowed = ['source_type', 'source_name', 'source_url', 'check_interval', 'max_items', 'lookback_days', 'prompt', 'is_active'];
    const sets = [];
    const params = { id };
    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = @${key}`);
        params[key] = value;
      }
    }
    if (sets.length === 0) return;
    sets.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE data_sources SET ${sets.join(', ')} WHERE id = @id`;
    return this.db.prepare(sql).run(params);
  }

  deleteDataSource(id) {
    return this.db.prepare('DELETE FROM data_sources WHERE id = ?').run(id);
  }

  setDataSourceActive(id, active) {
    return this.db.prepare('UPDATE data_sources SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active ? 1 : 0, id);
  }

  updateDataSourceLastCheck(id) {
    return this.db.prepare('UPDATE data_sources SET last_check = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }

  getDataSourceStats(id) {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM content_items WHERE source_id = ?').get(id);
    const processed = this.db.prepare("SELECT COUNT(*) as count FROM content_items WHERE source_id = ? AND status IN ('processed', 'summarized')").get(id);
    const failed = this.db.prepare('SELECT COUNT(*) as count FROM failed_items WHERE source_id = ?').get(id);
    const ds = this.getDataSourceById(id);
    return {
      totalItems: total.count,
      processedItems: processed.count,
      failedItems: failed.count,
      lastCheck: ds ? ds.last_check : null,
    };
  }

  // --- app_settings ---

  getAppSetting(key) {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (_) { return null; }
  }

  setAppSetting(key, value) {
    return this.db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    ).run(key, JSON.stringify(value));
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
