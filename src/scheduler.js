const cron = require('node-cron');
const Logger = require('./logger');
const { PermanentError } = require('./fetchers/youtube');

class Scheduler {
  constructor({ configManager, queue, youtubeFetcher, rssFetcher, llmService, storage, db, logger }) {
    this.configManager = configManager;
    this.queue = queue;
    this.youtubeFetcher = youtubeFetcher;
    this.rssFetcher = rssFetcher;
    this.llmService = llmService;
    this.storage = storage;
    this.db = db;
    this.logger = logger || Logger.getLogger('Scheduler');
    this.cronJobs = [];
    this.running = false;
    this._pendingItems = new Set();
    this._setupQueueListeners();
  }

  _setupQueueListeners() {
    this.queue.on('taskCompleted', (task) => {
      this._pendingItems.delete(task.id);
      this.logger.debug(`[Queue] Completed: "${task.name}" (${task.id})`);
    });

    this.queue.on('taskRetry', (task, retryCount, delay) => {
      this.logger.warn(`Retry #${retryCount} for "${task.name}" in ${delay}ms`);
    });

    this.queue.on('taskFailed', (task, error) => {
      if (error instanceof PermanentError) {
        // Permanent failure: record in DB, remove from pending (DB takes over dedup)
        this._pendingItems.delete(task.id);
        if (task.meta) {
          const { source, item } = task.meta;
          this.db.insertFailedItem({
            source_type: item.sourceType,
            source_id: item.sourceId,
            item_id: item.itemId,
            title: item.title,
            url: item.url,
            error_message: error.message,
          });
        }
        this.logger.error(`Permanent failure: "${task.name}" — ${error.message}`);
      } else {
        // Transient failure: keep in _pendingItems so it won't retry this session
        this.logger.error(`Failed: "${task.name}" — ${error.message}`);
      }
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._setupJobs();
    this.logger.info('Scheduler started');
  }

  stop() {
    this.running = false;
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];
    this.logger.info('Scheduler stopped');
  }

  restart() {
    this.stop();
    this.start();
  }

  /**
   * Manually trigger a check for all enabled sources.
   */
  async checkNow() {
    this.logger.info('Manual check triggered for all sources');
    const sources = this.configManager.getEnabledDataSources();
    for (const source of sources) {
      await this._checkSource(source);
    }
  }

  /**
   * Manually trigger a check for a specific source.
   */
  async checkSource(sourceId) {
    const sources = this.configManager.getEnabledDataSources();
    const source = sources.find(s => s.id === sourceId);
    if (!source) {
      this.logger.warn(`Source not found: ${sourceId}`);
      return;
    }
    await this._checkSource(source);
  }

  _setupJobs() {
    const sources = this.configManager.getEnabledDataSources();
    this.logger.info(`Setting up jobs for ${sources.length} enabled source(s)`);

    for (const source of sources) {
      const intervalSec = source.checkInterval || 3600;
      // Convert seconds to a cron-compatible interval
      // node-cron doesn't support arbitrary seconds, so we use setInterval for flexibility
      const intervalMs = intervalSec * 1000;

      // Run initial check after a short delay
      const initialDelay = setTimeout(() => {
        if (this.running) this._checkSource(source);
      }, 5000);

      // Then run periodically
      const interval = setInterval(() => {
        if (this.running) this._checkSource(source);
      }, intervalMs);

      // Store for cleanup
      this.cronJobs.push({
        stop: () => {
          clearTimeout(initialDelay);
          clearInterval(interval);
        },
      });

      this.logger.info(`Scheduled: ${source.name} (${source.type}) every ${intervalSec}s`);
    }
  }

  async _checkSource(source) {
    this.logger.info(`Checking source: ${source.name} (${source.type})`);
    try {
      let items;
      if (source.type === 'youtube') {
        items = await this._fetchYouTube(source);
      } else if (source.type === 'rss') {
        items = await this._fetchRSS(source);
      } else {
        this.logger.warn(`Unknown source type: ${source.type}`);
        return;
      }

      const totalFetched = items.length;

      // 1. Filter by lookbackDays (if configured)
      if (source.lookbackDays) {
        const cutoff = new Date(Date.now() - source.lookbackDays * 86400000);
        items = items.filter(item => new Date(item.publishedDate) >= cutoff);
      }
      const afterLookback = items.length;

      // 2. Keep only the newest maxItems (before DB dedup, so total never exceeds maxItems)
      if (source.maxItems && items.length > source.maxItems) {
        items = items.slice(0, source.maxItems);
      }

      // 3. Filter out already-seen items (DB) and items still being processed (queue)
      const newItems = items.filter(item => !this.db.itemExists(item.itemId) && !this.db.isItemFailed(item.itemId) && !this._pendingItems.has(item.itemId));
      if (newItems.length === 0) {
        this.logger.info(`[${source.name}] Fetched ${totalFetched}, ${afterLookback} within lookback, 0 new — nothing to process`);
        return;
      }

      this.logger.info(`[${source.name}] Fetched ${totalFetched}, ${afterLookback} within lookback, ${newItems.length} new, processing ${newItems.length}`);

      // Add each new item to the download queue
      for (const item of newItems) {
        this._pendingItems.add(item.itemId);
        this.queue.addTask({
          id: item.itemId,
          name: item.title,
          meta: { source, item },
          execute: () => this._processItem(source, item),
        });
      }
    } catch (err) {
      this.logger.error(`Error checking source ${source.name}: ${err.message}`);
    }
  }

  async _fetchYouTube(source) {
    const videos = await this.youtubeFetcher.fetchRecentVideos(source.url);
    const sourceId = String(source.id || source.url || source.name || 'youtube');
    return videos.map(v => ({
      itemId: v.videoId,
      title: v.title,
      publishedDate: v.publishedDate,
      url: v.url,
      author: v.author,
      sourceType: 'youtube',
      sourceId,
    }));
  }

  async _fetchRSS(source) {
    const items = await this.rssFetcher.fetchItems(source.url);
    const sourceId = String(source.id || source.url || source.name || 'rss');
    return items.map(item => ({
      itemId: item.itemId,
      title: item.title,
      content: item.content,
      publishedDate: item.publishedDate,
      url: item.url,
      author: item.author,
      sourceType: 'rss',
      sourceId,
    }));
  }

  async _processItem(source, item) {
    const tag = `[${source.name}]`;
    this.logger.info(`${tag} Processing: "${item.title}" (${item.itemId})`);

    try {
      // Step 1: Fetch full content if needed
      if (source.type === 'youtube' && !item.content) {
        this.logger.info(`${tag} Downloading transcript: "${item.title}"`);
        item.content = await this.youtubeFetcher.fetchTranscript(item.itemId);
        this.logger.info(`${tag} Transcript downloaded: "${item.title}"`);
      }

      // Step 2: Generate LLM summary (before save — failure prevents DB insert)
      let summaryText = null;
      const llmConfig = this.configManager.getLLMConfig();
      if (llmConfig && llmConfig.apiKey) {
        const sourcePrompt = this.configManager.getSourcePrompt(source.id);
        summaryText = await this.llmService.summarize(item.content, item.title, sourcePrompt);
        this.logger.info(`${tag} Summary generated: "${item.title}"`);
      } else {
        this.logger.warn(`${tag} No LLM API key configured, skipping summary`);
      }

      // Step 3: Save to disk + DB (only reached if all above succeeded)
      await this.storage.saveContent(item);
      if (summaryText) {
        await this.storage.updateSummary(item, summaryText);
      }

      this.logger.info(`${tag} Saved: "${item.title}"`);
      return item;
    } catch (err) {
      this.logger.error(`${tag} Error processing "${item.title}" (${item.itemId}): ${err.message}`);
      throw err; // re-throw so queue handles retry
    }
  }
}

module.exports = Scheduler;
