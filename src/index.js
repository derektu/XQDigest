const path = require('path');
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

async function main() {
  // 1. Load config
  const configManager = new ConfigManager();
  configManager.load();
  const config = configManager.get();

  // 2. Init logger
  Logger.init(new LoggerConfig({
    level: configManager.getLogLevel(),
    logDir: path.resolve(__dirname, '../logs'),
  }));
  const logger = Logger.getLogger('App');
  logger.info('XQDigest starting...');
  logger.info(`Config loaded: ${configManager.getEnabledDataSources().length} data source(s), concurrent limit: ${config.download.concurrentLimit}`);

  // 3. Init database
  const dataPath = configManager.getDataPath();
  const dbPath = path.join(dataPath, 'database', 'content.db');
  const db = new DB(dbPath);
  db.open();
  logger.info('Database initialized');

  // 4. Init storage
  const storage = new Storage(db, dataPath);

  // 5. Init download queue
  const downloadConfig = configManager.getDownloadConfig();
  const queue = new DownloadQueue(new QueueConfig({
    concurrentLimit: downloadConfig.concurrentLimit,
    retryAttempts: downloadConfig.retryAttempts,
    retryDelay: downloadConfig.retryDelay,
  }));

  // Queue event logging (debug level — scheduler handles contextual logging)
  queue.on('taskAdded', (task, status) => {
    logger.debug(`Queue: added "${task.name}" (pending: ${status.pending}, active: ${status.active})`);
  });
  queue.on('taskStarted', (task, status) => {
    logger.debug(`Queue: started "${task.name}" (active: ${status.active}/${downloadConfig.concurrentLimit})`);
  });
  queue.on('taskCompleted', (task, status) => {
    logger.debug(`Queue: completed "${task.name}" (pending: ${status.pending}, active: ${status.active}, completed: ${status.completed})`);
  });

  // 6. Init fetchers
  const youtubeFetcher = new YouTubeFetcher();
  const rssFetcher = new RSSFetcher();

  // 7. Init LLM service
  const llmConfig = configManager.getLLMConfig();
  let llmService = null;
  if (llmConfig && llmConfig.apiKey) {
    llmService = new LLMService(new LLMServiceConfig(llmConfig));
    logger.info(`LLM configured: ${llmConfig.provider} / ${llmConfig.model}`);
  } else {
    logger.warn('No LLM API key configured, summaries will be skipped');
  }

  // 8. Init scheduler
  const scheduler = new Scheduler({
    configManager,
    queue,
    youtubeFetcher,
    rssFetcher,
    llmService,
    storage,
    db,
  });

  // 9. Watch config changes
  configManager.startWatching();
  configManager.on('changed', (newConfig) => {
    logger.info('Config file changed, reloading...');

    // Update logger level
    Logger.setLevel(newConfig.app.logLevel || 'info');

    // Update queue concurrent limit
    queue.updateConcurrentLimit(newConfig.download.concurrentLimit);

    // Update LLM service
    if (newConfig.llm && newConfig.llm.apiKey) {
      if (llmService) {
        llmService.updateConfig(newConfig.llm);
      } else {
        llmService = new LLMService(new LLMServiceConfig(newConfig.llm));
      }
    }

    // Restart scheduler with new source config
    scheduler.restart();
    logger.info('Config reloaded successfully');
  });

  configManager.on('error', (err) => {
    logger.error(`Config reload error: ${err.message}`);
  });

  // 10. Start scheduler
  scheduler.start();
  logger.info('XQDigest is running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    scheduler.stop();
    configManager.stopWatching();
    db.close();
    logger.info('Goodbye!');
    Logger.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
