/**
 * DataSourceManager — business logic layer for data sources stored in SQLite.
 * Wraps DB CRUD with camelCase API and returns objects compatible with Scheduler.
 */
class DataSourceManager {
  constructor(db) {
    this._db = db;
  }

  /**
   * Convert DB row (snake_case) to app object (camelCase), matching the shape
   * Scheduler expects (same as config's dataSources entries).
   */
  _toAppObject(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.source_type,
      name: row.source_name,
      url: row.source_url,
      checkInterval: row.check_interval,
      maxItems: row.max_items,
      lookbackDays: row.lookback_days,
      prompt: row.prompt,
      enabled: !!row.is_active,
      lastCheck: row.last_check,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Convert app-level add/update fields to DB row (snake_case).
   */
  _toDbFields(fields) {
    const map = {
      type: 'source_type',
      name: 'source_name',
      url: 'source_url',
      checkInterval: 'check_interval',
      maxItems: 'max_items',
      lookbackDays: 'lookback_days',
      prompt: 'prompt',
      enabled: 'is_active',
    };
    const result = {};
    for (const [key, value] of Object.entries(fields)) {
      const dbKey = map[key];
      if (dbKey) {
        result[dbKey] = dbKey === 'is_active' ? (value ? 1 : 0) : value;
      }
    }
    return result;
  }

  getAll() {
    return this._db.getAllDataSources().map(r => this._toAppObject(r));
  }

  getEnabled() {
    return this._db.getActiveDataSources().map(r => this._toAppObject(r));
  }

  getById(id) {
    return this._toAppObject(this._db.getDataSourceById(id));
  }

  add({ id, type, name, url, checkInterval = 3600, maxItems = 10, lookbackDays = 7, prompt = '', enabled = true }) {
    this._db.insertDataSource({
      id,
      source_type: type,
      source_name: name,
      source_url: url,
      check_interval: checkInterval,
      max_items: maxItems,
      lookback_days: lookbackDays,
      prompt,
      is_active: enabled ? 1 : 0,
    });
    return this.getById(id);
  }

  update(id, fields) {
    const dbFields = this._toDbFields(fields);
    this._db.updateDataSource(id, dbFields);
    return this.getById(id);
  }

  remove(id) {
    this._db.deleteDataSource(id);
  }

  toggle(id, enabled) {
    this._db.setDataSourceActive(id, enabled);
    return this.getById(id);
  }

  updateLastCheck(id) {
    this._db.updateDataSourceLastCheck(id);
  }

  getSourcePrompt(id) {
    const row = this._db.getDataSourceById(id);
    return (row && row.prompt) ? row.prompt : null;
  }

  getStats(id) {
    return this._db.getDataSourceStats(id);
  }
}

module.exports = DataSourceManager;
