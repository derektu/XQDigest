const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

class LoggerConfig {
  constructor({ level = 'info', category = 'App', logDir, logFile = 'app.log', retentionDays = 7 } = {}) {
    this.level = level;
    this.category = category;
    this.logDir = logDir || path.resolve(__dirname, '../logs');
    this.logFile = logFile;
    this.retentionDays = retentionDays;
  }
}

class Logger {
  constructor(options = {}) {
    const config = options instanceof LoggerConfig ? options : new LoggerConfig(options);
    this.level = config.level;
    this.category = config.category;
    this.logDir = config.logDir;
    this.logFile = config.logFile;
    this.retentionDays = config.retentionDays;
    this.stream = null;
    this.currentDate = this._getCurrentDate();
  }

  _getCurrentDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _ensureStream() {
    if (this.stream) return;
    fs.mkdirSync(this.logDir, { recursive: true });
    const filePath = path.join(this.logDir, this.logFile);
    // 啟動時檢查：若現有 log 檔的最後修改日期不是今天，先 rotate
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const mtime = stat.mtime;
      const fileDate = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;
      if (fileDate !== this.currentDate) {
        const rotatedPath = path.join(this.logDir, `${this.logFile}.${fileDate}`);
        fs.renameSync(filePath, rotatedPath);
        this._cleanOldLogs();
      }
    }
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  _shouldLog(level) {
    return LEVELS[level] <= LEVELS[this.level];
  }

  _format(level, message, category) {
    const cat = category || this.category;
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const ts = `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
    return `[${ts}] [${cat}] [${level.toUpperCase()}] ${message}`;
  }

  _checkRotation() {
    const today = this._getCurrentDate();
    if (today !== this.currentDate) {
      this._rotateLog();
      this.currentDate = today;
    }
  }

  _rotateLog() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    const currentPath = path.join(this.logDir, this.logFile);
    if (fs.existsSync(currentPath)) {
      const rotatedPath = path.join(this.logDir, `${this.logFile}.${this.currentDate}`);
      fs.renameSync(currentPath, rotatedPath);
    }
    this._cleanOldLogs();
  }

  _cleanOldLogs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    let files;
    try {
      files = fs.readdirSync(this.logDir);
    } catch {
      return;
    }

    const prefix = this.logFile + '.';
    for (const file of files) {
      if (!file.startsWith(prefix)) continue;
      const datePart = file.slice(prefix.length);
      const match = datePart.match(/^\d{4}-\d{2}-\d{2}$/);
      if (match) {
        const fileDate = new Date(datePart + 'T00:00:00');
        if (fileDate < cutoffDate) {
          try {
            fs.unlinkSync(path.join(this.logDir, file));
          } catch (_) {}
        }
      }
    }
  }

  _write(level, message, category) {
    if (!this._shouldLog(level)) return;
    this._checkRotation();
    const line = this._format(level, message, category);
    console.log(line);
    this._ensureStream();
    this.stream.write(line + '\n');
  }

  info(message) { this._write('info', message); }
  warn(message) { this._write('warn', message); }
  error(message) { this._write('error', message); }
  debug(message) { this._write('debug', message); }

  setLevel(level) {
    if (LEVELS[level] !== undefined) {
      this.level = level;
    }
  }

  close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  // --- Singleton API ---

  static _instance = null;

  static init(options = {}) {
    const config = options instanceof LoggerConfig ? options : new LoggerConfig(options);
    Logger._instance = new Logger(config);
    return Logger._instance;
  }

  static getLogger(category) {
    return {
      info: (msg) => Logger._instance?._write('info', msg, category),
      warn: (msg) => Logger._instance?._write('warn', msg, category),
      error: (msg) => Logger._instance?._write('error', msg, category),
      debug: (msg) => Logger._instance?._write('debug', msg, category),
    };
  }

  static setLevel(level) {
    Logger._instance?.setLevel(level);
  }

  static close() {
    Logger._instance?.close();
  }

  static reset() {
    Logger._instance?.close();
    Logger._instance = null;
  }
}

module.exports = Logger;
module.exports.LoggerConfig = LoggerConfig;
