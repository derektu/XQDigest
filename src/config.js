const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const EventEmitter = require('events');

class ConfigManager extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath || path.resolve(__dirname, '../config/settings.json');
    this.config = null;
    this.watcher = null;
  }

  load() {
    const raw = fs.readFileSync(this.configPath, 'utf8');
    this.config = JSON.parse(raw);
    return this.config;
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

  getDataSources() {
    return this.get().dataSources || [];
  }

  getEnabledDataSources() {
    return this.getDataSources().filter(s => s.enabled);
  }

  getLLMConfig() {
    return this.get().llm;
  }

  getSourcePrompt(sourceId) {
    const source = this.getDataSources().find(s => s.id === sourceId);
    if (source && source.prompt) {
      return source.prompt;
    }
    return null;
  }

  getDownloadConfig() {
    return this.get().download;
  }

  getLogLevel() {
    return this.get().app.logLevel || 'info';
  }
}

module.exports = ConfigManager;
