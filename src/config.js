const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const EventEmitter = require('events');
const DEFAULTS = require('./defaults');

class ConfigManager extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath || path.resolve(__dirname, '../config/settings.json');
    this.config = null;
    this.watcher = null;
  }

  load() {
    // 若檔案不存在，使用純預設值
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      this.config = JSON.parse(JSON.stringify(DEFAULTS));
      return this.config;
    }

    // 讀取使用者設定並深度合併預設值
    const raw = fs.readFileSync(this.configPath, 'utf8');
    const userConfig = JSON.parse(raw);
    this.config = this._mergeConfig(DEFAULTS, userConfig);
    return this.config;
  }

  /**
   * 深度合併設定：userConfig 覆寫 defaults
   * @param {object} defaults - 預設配置
   * @param {object} overrides - 使用者覆寫配置
   * @returns {object} 合併後的配置
   */
  _mergeConfig(defaults, overrides) {
    const result = JSON.parse(JSON.stringify(defaults));
    for (const key in overrides) {
      if (typeof overrides[key] === 'object' && !Array.isArray(overrides[key]) && overrides[key] !== null) {
        // 深度合併物件（但不遞迴處理 null）
        result[key] = this._mergeConfig(result[key] || {}, overrides[key]);
      } else {
        // 直接覆寫（包括 primitive、array、null）
        result[key] = overrides[key];
      }
    }
    return result;
  }

  /**
   * 取得預設配置（靜態方法）
   * @returns {object} 預設配置
   */
  static getDefaults() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  get() {
    if (!this.config) {
      this.load();
    }
    return this.config;
  }

  startWatching() {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', () => {
      try {
        const oldConfig = this.config;
        this.load();
        this.emit('changed', this.config, oldConfig);
      } catch (err) {
        this.emit('error', err);
      }
    });
  }

  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  getDataPath() {
    const dataPath = this.get().app.dataPath || './data';
    return path.resolve(path.dirname(this.configPath), '..', dataPath);
  }

  getDownloadConfig() {
    return this.get().download;
  }

  getLogLevel() {
    return this.get().app.logLevel || 'info';
  }
}

module.exports = ConfigManager;
