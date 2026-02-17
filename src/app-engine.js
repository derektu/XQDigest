const path = require('path');
const { EventEmitter } = require('events');
const ConfigManager = require('./config');
const Logger = require('./logger');
const { LoggerConfig } = require('./logger');
const DB = require('./database/db');
const Storage = require('./storage');
const DownloadQueue = require('./queue');
const { QueueConfig } = require('./queue');
const YouTubeFetcher = require('./fetchers/youtube');
const RSSFetcher = require('./fetchers/rss');
const LLMService = require('./llm');
const { LLMServiceConfig } = require('./llm');
const Scheduler = require('./scheduler');

const STATES = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
};

class AppEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this._configPath = options.configPath || undefined;
    this._state = STATES.STOPPED;
    this._configManager = null;
    this._logger = null;
    this._db = null;
    this._storage = null;
    this._queue = null;
    this._scheduler = null;
    this._llmService = null;
  }

  getState() {
    return this._state;
  }

  getStatus() {
    return {
      state: this._state,
      dataSources: this._configManager ? this._configManager.getEnabledDataSources().length : 0,
      llmConfigured: !!this._llmService,
    };
  }

  async start() {
    if (this._state !== STATES.STOPPED) {
      throw new Error(`Cannot start: engine is ${this._state}`);
    }

    this._setState(STATES.STARTING);

    try {
      // 1. Load config
      this._configManager = new ConfigManager(this._configPath);
      this._configManager.load();
      const config = this._configManager.get();

      // 2. Init logger
      Logger.init(new LoggerConfig({
        level: this._configManager.getLogLevel(),
        logDir: path.resolve(__dirname, '../logs'),
      }));
      this._logger = Logger.getLogger('AppEngine');
      this._logger.info('XQDigest starting...');
      this._logger.info(`Config loaded: ${this._configManager.getEnabledDataSources().length} data source(s), concurrent limit: ${config.download.concurrentLimit}`);

      // 3. Init database
      const dataPath = this._configManager.getDataPath();
      const dbPath = path.join(dataPath, 'database', 'content.db');
      this._db = new DB(dbPath);
      this._db.open();
      this._logger.info('Database initialized');

      // 4. Init storage
      this._storage = new Storage(this._db, dataPath);

      // 5. Init download queue
      const downloadConfig = this._configManager.getDownloadConfig();
      this._queue = new DownloadQueue(new QueueConfig({
        concurrentLimit: downloadConfig.concurrentLimit,
        retryAttempts: downloadConfig.retryAttempts,
        retryDelay: downloadConfig.retryDelay,
      }));

      this._queue.on('taskAdded', (task, status) => {
        this._logger.debug(`Queue: added "${task.name}" (pending: ${status.pending}, active: ${status.active})`);
      });
      this._queue.on('taskStarted', (task, status) => {
        this._logger.debug(`Queue: started "${task.name}" (active: ${status.active}/${this._queue.concurrentLimit})`);
      });
      this._queue.on('taskCompleted', (task, status) => {
        this._logger.debug(`Queue: completed "${task.name}" (pending: ${status.pending}, active: ${status.active}, completed: ${status.completed})`);
      });

      // 6. Init fetchers
      const youtubeFetcher = new YouTubeFetcher();
      const rssFetcher = new RSSFetcher();

      // 7. Init LLM service
      const llmConfig = this._configManager.getLLMConfig();
      this._llmService = null;
      if (llmConfig && llmConfig.apiKey) {
        this._llmService = new LLMService(new LLMServiceConfig(llmConfig));
        this._logger.info(`LLM configured: ${llmConfig.provider} / ${llmConfig.model}`);
      } else {
        this._logger.warn('No LLM API key configured, summaries will be skipped');
      }

      // 8. Init scheduler
      this._scheduler = new Scheduler({
        configManager: this._configManager,
        queue: this._queue,
        youtubeFetcher,
        rssFetcher,
        llmService: this._llmService,
        storage: this._storage,
        db: this._db,
      });

      // 9. Setup config hot-reload
      this._setupConfigListeners();

      // 10. Start scheduler
      this._scheduler.start();
      this._logger.info('XQDigest is running.');

      this._setState(STATES.RUNNING);
    } catch (err) {
      await this._safeCleanup();
      this._setState(STATES.STOPPED);
      this.emit('error', err);
      throw err;
    }
  }

  async _safeCleanup() {
    try { if (this._scheduler) this._scheduler.stop(); } catch (_) {}
    try { if (this._queue) { this._queue.stop(); await this._queue.drain(); } } catch (_) {}
    try { if (this._configManager) { this._configManager.stopWatching(); this._configManager.removeAllListeners(); } } catch (_) {}
    try { if (this._db) this._db.close(); } catch (_) {}
    try { Logger.close(); } catch (_) {}
    this._configManager = null;
    this._logger = null;
    this._db = null;
    this._storage = null;
    this._queue = null;
    this._scheduler = null;
    this._llmService = null;
  }

  async stop() {
    if (this._state !== STATES.RUNNING) {
      throw new Error(`Cannot stop: engine is ${this._state}`);
    }

    this._setState(STATES.STOPPING);

    try {
      if (this._logger) {
        this._logger.info('Shutting down...');
      }
      if (this._scheduler) {
        this._scheduler.stop();
      }
      if (this._queue) {
        this._queue.stop();
        await this._queue.drain();
      }
      if (this._configManager) {
        this._configManager.stopWatching();
        this._configManager.removeAllListeners();
      }
      if (this._db) {
        this._db.close();
      }
      if (this._logger) {
        this._logger.info('Goodbye!');
      }
      Logger.close();

      this._configManager = null;
      this._logger = null;
      this._db = null;
      this._storage = null;
      this._queue = null;
      this._scheduler = null;
      this._llmService = null;

      this._setState(STATES.STOPPED);
    } catch (err) {
      this._setState(STATES.STOPPED);
      this.emit('error', err);
      throw err;
    }
  }

  async restart() {
    await this.stop();
    await this.start();
    this.emit('configReloaded');
  }

  _setState(newState) {
    const oldState = this._state;
    this._state = newState;
    if (oldState !== newState) {
      this.emit('stateChange', newState, oldState);
    }
  }

  _setupConfigListeners() {
    this._configManager.startWatching();

    this._configManager.on('changed', (newConfig) => {
      this._logger.info('Config file changed, reloading...');

      // Update logger level
      Logger.setLevel(newConfig.app.logLevel || 'info');

      // Update queue concurrent limit
      this._queue.updateConcurrentLimit(newConfig.download.concurrentLimit);

      // Update LLM service
      if (newConfig.llm && newConfig.llm.apiKey) {
        if (this._llmService) {
          this._llmService.updateConfig(newConfig.llm);
        } else {
          this._llmService = new LLMService(new LLMServiceConfig(newConfig.llm));
        }
      }

      // Restart scheduler with new source config
      this._scheduler.restart();
      this._logger.info('Config reloaded successfully');
      this.emit('configReloaded');
    });

    this._configManager.on('error', (err) => {
      this._logger.error(`Config reload error: ${err.message}`);
      this.emit('error', err);
    });
  }
}

AppEngine.STATES = STATES;

module.exports = AppEngine;
