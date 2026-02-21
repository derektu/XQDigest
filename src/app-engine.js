const path = require('path');
const fs = require('node:fs');
const { EventEmitter } = require('events');
const ConfigManager = require('./config');
const Logger = require('./logger');
const { LoggerConfig } = require('./logger');
const DB = require('./database/db');
const DataSourceManager = require('./datasource-manager');
const Storage = require('./storage');
const DownloadQueue = require('./queue');
const { QueueConfig } = require('./queue');
const LLMQueue = require('./llm-queue');
const LLMLogger = require('./llm-logger');
const YouTubeFetcher = require('./fetchers/youtube');
const RSSFetcher = require('./fetchers/rss');
const LLMService = require('./llm');
const { LLMServiceConfig } = require('./llm');
const Scheduler = require('./scheduler');
const ApiServer = require('./api-server');

/**
 * Resolve the yt-dlp binary path.
 * In a packaged Electron app, process.resourcesPath points to the Resources folder
 * where electron-builder places extraResources. Falls back to system PATH in dev mode.
 */
function resolveYtDlpBin() {
  if (process.resourcesPath) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const bundled = path.join(process.resourcesPath, 'bin', `yt-dlp${ext}`);
    if (fs.existsSync(bundled)) return bundled;
  }
  return 'yt-dlp';
}

const STATES = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  PAUSING: 'pausing',
  PAUSED: 'paused',
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
    this._dataSourceManager = null;
    this._storage = null;
    this._queue = null;
    this._llmQueue = null;
    this._llmLogger = null;
    this._scheduler = null;
    this._llmService = null;
    this._apiServer = null;
  }

  getState() {
    return this._state;
  }

  getStatus() {
    const dsCount = this._dataSourceManager
      ? this._dataSourceManager.getEnabled().length
      : (this._configManager ? this._configManager.getEnabledDataSources().length : 0);
    return {
      state: this._state,
      dataSources: dsCount,
      llmConfigured: !!this._llmService,
    };
  }

  getDataSourceManager() {
    return this._dataSourceManager;
  }

  getScheduler() {
    return this._scheduler;
  }

  getApiPort() {
    return this._apiServer ? this._apiServer.getPort() : null;
  }

  getDB() {
    return this._db;
  }

  getLLMSettings() {
    if (!this._db) return null;
    return this._db.getAppSetting('llm');
  }

  setLLMSettings(data) {
    if (!this._db) throw new Error('Engine not running');
    this._db.setAppSetting('llm', data);
    // Re-initialize LLM service
    if (data && data.apiKey) {
      this._llmService = new LLMService(new LLMServiceConfig(data), null, this._llmLogger);
      if (this._scheduler) this._scheduler.updateLLMService(this._llmService);
      if (this._llmQueue) this._llmQueue.updateRateLimit(data.requestsPerMinute || 0);
      if (this._logger) this._logger.info(`LLM re-configured: ${data.provider} / ${data.model}`);
    } else {
      this._llmService = null;
      if (this._scheduler) this._scheduler.updateLLMService(null);
      if (this._llmQueue) this._llmQueue.updateRateLimit(0);
      if (this._logger) this._logger.info('LLM configuration removed');
    }
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
      const dataPath = this._configManager.getDataPath();
      const logDir = process.env.XQDIGEST_DATA_PATH
        ? path.join(process.env.XQDIGEST_DATA_PATH, 'logs')
        : path.resolve(__dirname, '../logs');
      Logger.init(new LoggerConfig({
        level: this._configManager.getLogLevel(),
        logDir,
      }));
      this._logger = Logger.getLogger('AppEngine');
      this._logger.info('XQDigest starting...');

      // 3. Init database
      const dbPath = path.join(dataPath, 'database', 'content.db');
      this._db = new DB(dbPath);
      this._db.open();
      this._logger.info('Database initialized');

      // 4. Init DataSourceManager
      this._dataSourceManager = new DataSourceManager(this._db);

      const enabledCount = this._dataSourceManager.getEnabled().length;
      this._logger.info(`DataSourceManager ready: ${enabledCount} enabled source(s)`);

      // 5. Init storage
      this._storage = new Storage(this._db, dataPath);

      // 6. Init download queue
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

      // 7. Init fetchers
      const youtubeFetcher = new YouTubeFetcher({ ytDlpBin: resolveYtDlpBin() });
      const rssFetcher = new RSSFetcher();

      // 8. Init LLM logger
      this._llmLogger = new LLMLogger(logDir);

      // 9. Init LLM service (settings from DB)
      this._llmService = null;
      const llmSettings = this._db.getAppSetting('llm');
      if (llmSettings && llmSettings.apiKey) {
        this._llmService = new LLMService(new LLMServiceConfig(llmSettings), null, this._llmLogger);
        this._logger.info(`LLM configured: ${llmSettings.provider} / ${llmSettings.model}`);
      } else {
        this._logger.warn('No LLM API key configured, summaries will be skipped');
      }

      // 10. Init LLM queue
      const llmConfig = this._configManager.getLLMConfig();
      const rpmFromSettings = (llmSettings && llmSettings.requestsPerMinute) || 0;
      this._llmQueue = new LLMQueue({
        retryAttempts: llmConfig.retryAttempts,
        retryDelay: llmConfig.retryDelay,
        requestsPerMinute: rpmFromSettings || llmConfig.requestsPerMinute,
      });

      this._llmQueue.on('taskAdded', (task, status) => {
        this._logger.debug(`LLMQueue: added "${task.name}" (pending: ${status.pending})`);
      });
      this._llmQueue.on('taskStarted', (task, status) => {
        this._logger.debug(`LLMQueue: started "${task.name}"`);
      });
      this._llmQueue.on('taskCompleted', (task, status) => {
        this._logger.debug(`LLMQueue: completed "${task.name}" (pending: ${status.pending}, completed: ${status.completed})`);
      });

      // 11. Init scheduler (uses DataSourceManager, download queue, and LLM queue)
      this._scheduler = new Scheduler({
        configManager: this._configManager,
        dataSourceManager: this._dataSourceManager,
        queue: this._queue,
        llmQueue: this._llmQueue,
        youtubeFetcher,
        rssFetcher,
        llmService: this._llmService,
        storage: this._storage,
        db: this._db,
      });

      // 12. Setup config hot-reload (for LLM, download, app settings)
      this._setupConfigListeners();

      // 13. Start scheduler
      this._scheduler.start();

      // 14. Resume any items that were fetched but not yet summarized
      await this._resumePendingSummaries();

      // 15. Start API server (if apiPort is configured)
      const apiPort = config.app.apiPort !== undefined ? config.app.apiPort : 3579;
      if (apiPort !== null) {
        this._apiServer = new ApiServer(this);
        const actualPort = await this._apiServer.start(apiPort);
        this._logger.info(`API server listening on http://127.0.0.1:${actualPort}`);
        this.emit('serverReady', actualPort);
      }

      this._logger.info('XQDigest is running.');

      this._setState(STATES.RUNNING);
    } catch (err) {
      await this._safeCleanup();
      this._setState(STATES.STOPPED);
      this.emit('error', err);
      throw err;
    }
  }

  async _resumePendingSummaries() {
    if (!this._llmService || !this._llmQueue) return;
    const pendingItems = this._db.getItemsByStatus('fetched');
    if (pendingItems.length === 0) return;
    this._logger.info(`Resuming ${pendingItems.length} pending summary item(s)...`);
    for (const dbRow of pendingItems) {
      const source = this._dataSourceManager.getById(dbRow.source_id);
      if (!source) continue;
      this._scheduler.enqueuePendingSummary(source, {
        itemId: dbRow.item_id,
        title: dbRow.title,
        sourceId: dbRow.source_id,
        rawContent: dbRow.raw_content,
      });
    }
  }

  async _safeCleanup() {
    try { if (this._scheduler) this._scheduler.stop(); } catch (_) {}
    try { if (this._queue) { this._queue.stop(); await this._queue.drain(); } } catch (_) {}
    try { if (this._llmQueue) { this._llmQueue.stop(); await this._llmQueue.drain(); } } catch (_) {}
    try { if (this._apiServer) await this._apiServer.stop(); } catch (_) {}
    try { if (this._configManager) { this._configManager.stopWatching(); this._configManager.removeAllListeners(); } } catch (_) {}
    try { if (this._db) this._db.close(); } catch (_) {}
    try { if (this._llmLogger) this._llmLogger.close(); } catch (_) {}
    try { Logger.close(); } catch (_) {}
    this._configManager = null;
    this._logger = null;
    this._db = null;
    this._dataSourceManager = null;
    this._storage = null;
    this._queue = null;
    this._llmQueue = null;
    this._llmLogger = null;
    this._scheduler = null;
    this._llmService = null;
    this._apiServer = null;
  }

  pause() {
    if (this._state !== STATES.RUNNING) {
      throw new Error(`Cannot pause: engine is ${this._state}`);
    }
    this._scheduler.stop();
    this._setState(STATES.PAUSED);
  }

  resume() {
    if (this._state !== STATES.PAUSED) {
      throw new Error(`Cannot resume: engine is ${this._state}`);
    }
    this._scheduler.start();
    this._setState(STATES.RUNNING);
  }

  async stop() {
    if (this._state !== STATES.RUNNING && this._state !== STATES.PAUSED) {
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
      if (this._llmQueue) {
        this._llmQueue.stop();
        const drain = this._llmQueue.drain();
        const timeout = new Promise(resolve => setTimeout(resolve, 5000));
        await Promise.race([drain, timeout]);
      }
      if (this._apiServer) {
        await this._apiServer.stop();
      }
      if (this._configManager) {
        this._configManager.stopWatching();
        this._configManager.removeAllListeners();
      }
      if (this._db) {
        this._db.close();
      }
      if (this._llmLogger) {
        this._llmLogger.close();
      }
      if (this._logger) {
        this._logger.info('Goodbye!');
      }
      Logger.close();

      this._configManager = null;
      this._logger = null;
      this._db = null;
      this._dataSourceManager = null;
      this._storage = null;
      this._queue = null;
      this._llmQueue = null;
      this._llmLogger = null;
      this._scheduler = null;
      this._llmService = null;
      this._apiServer = null;

      this._setState(STATES.STOPPED);
    } catch (err) {
      this._setState(STATES.STOPPED);
      this.emit('error', err);
      throw err;
    }
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

      // Note: LLM settings are now in DB (managed via Settings UI).
      // dataSources are also in DB, not config. No scheduler restart needed for config changes.
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
