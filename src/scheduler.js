const Logger = require('./logger');
const { PermanentError } = require('./fetchers/youtube');

class Scheduler {
  constructor({ configManager, dataSourceManager, queue, llmQueue, youtubeFetcher, rssFetcher, llmService, storage, db, logger }) {
    this.configManager = configManager;
    this.dataSourceManager = dataSourceManager || null;
    this.queue = queue;
    this.llmQueue = llmQueue || null;
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
    // Download queue listeners
    this.queue.on('taskCompleted', (task) => {
      // NOTE: Don't remove from _pendingItems here.
      // Either _fetchContent() already removed it (no LLM pipeline),
      // or the LLM queue listeners will remove it when summarization is done.
      this.logger.debug(`[DownloadQueue] Completed: "${task.name}" (${task.id})`);
    });

    this.queue.on('taskRetry', (task, retryCount, delay) => {
      this.logger.warn(`Retry #${retryCount} for "${task.name}" in ${delay}ms`);
    });

    this.queue.on('taskFailed', (task, error) => {
      this._pendingItems.delete(task.id);
      if (error instanceof PermanentError) {
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
        this.logger.error(`Failed: "${task.name}" — ${error.message}`);
      }
    });

    // LLM queue listeners (if provided)
    if (this.llmQueue) {
      this.llmQueue.on('taskCompleted', (task) => {
        this._pendingItems.delete(task.id);
        this.logger.debug(`[LLMQueue] Completed: "${task.name}" (${task.id})`);
      });

      this.llmQueue.on('taskRetry', (task, retryCount, delay) => {
        this.logger.warn(`[LLMQueue] Retry #${retryCount} for "${task.name}" in ${delay}ms`);
      });

      this.llmQueue.on('taskFailed', (task, error) => {
        this._pendingItems.delete(task.id);
        this.logger.error(`[LLMQueue] Failed: "${task.name}" — ${error.message}`);
      });
    }
  }

  /**
   * Get enabled data sources from DataSourceManager (DB).
   */
  _getEnabledSources() {
    return this.dataSourceManager.getEnabled();
  }

  /**
   * Get source prompt by ID from DataSourceManager (DB).
   */
  _getSourcePrompt(sourceId) {
    return this.dataSourceManager.getSourcePrompt(sourceId);
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
    const sources = this._getEnabledSources();
    for (const source of sources) {
      await this._checkSource(source);
    }
  }

  /**
   * Manually trigger a check for a specific source.
   */
  async checkSource(sourceId) {
    const sources = this._getEnabledSources();
    const source = sources.find(s => s.id === sourceId);
    if (!source) {
      this.logger.warn(`Source not found: ${sourceId}`);
      return;
    }
    await this._checkSource(source);
  }

  /**
   * Add a scheduled job for a single source (without restarting all jobs).
   */
  addSource(sourceId) {
    if (!this.running) return;
    if (!this.dataSourceManager) return;

    const source = this.dataSourceManager.getById(sourceId);
    if (!source || !source.enabled) return;

    // Don't add duplicate
    if (this.cronJobs.some(j => j.sourceId === sourceId)) return;

    this._addJobForSource(source);
    this.logger.info(`Added schedule for source: ${source.name} (${sourceId})`);
  }

  /**
   * Remove the scheduled job for a single source.
   */
  removeSource(sourceId) {
    const idx = this.cronJobs.findIndex(j => j.sourceId === sourceId);
    if (idx !== -1) {
      this.cronJobs[idx].stop();
      this.cronJobs.splice(idx, 1);
      this.logger.info(`Removed schedule for source: ${sourceId}`);
    }
  }

  updateLLMService(llmService) {
    this.llmService = llmService;
  }

  /**
   * Enqueue a pending summary for an item that is already in DB with status='fetched'.
   * Called by AppEngine on restart to resume unfinished LLM summaries.
   */
  enqueuePendingSummary(source, item) {
    // Skip if already tracked in this session
    if (this._pendingItems.has(item.itemId)) return;
    // Skip if no LLM pipeline available
    if (!this.llmQueue || !this.llmService) return;

    this._pendingItems.add(item.itemId);
    this.llmQueue.addTask({
      id: item.itemId,
      name: item.title,
      meta: { source, item },
      execute: () => this._summarizeItem(source, item),
    });
  }

  _setupJobs() {
    const sources = this._getEnabledSources();
    this.logger.info(`Setting up jobs for ${sources.length} enabled source(s)`);

    for (const source of sources) {
      this._addJobForSource(source);
    }
  }

  _addJobForSource(source) {
    const intervalSec = source.checkInterval || 3600;
    const intervalMs = intervalSec * 1000;

    const initialDelay = setTimeout(() => {
      if (this.running) this._checkSource(source);
    }, 5000);

    const interval = setInterval(() => {
      if (this.running) this._checkSource(source);
    }, intervalMs);

    this.cronJobs.push({
      sourceId: source.id,
      stop: () => {
        clearTimeout(initialDelay);
        clearInterval(interval);
      },
    });

    this.logger.info(`Scheduled: ${source.name} (${source.type}) every ${intervalSec}s`);
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

      // 2. Sort by date (newest first) then keep only maxItems
      items.sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));
      if (source.maxItems && items.length > source.maxItems) {
        items = items.slice(0, source.maxItems);
      }

      // 3. Filter out already-seen items
      const newItems = items.filter(item => {
        if (this.db.itemExists(item.itemId) || this.db.isItemFailed(item.itemId) || this._pendingItems.has(item.itemId)) {
          return false;
        }
        this._pendingItems.add(item.itemId);
        return true;
      });
      if (newItems.length === 0) {
        this.logger.info(`[${source.name}] Fetched ${totalFetched}, ${afterLookback} within lookback, 0 new — nothing to process`);
        return;
      }

      this.logger.info(`[${source.name}] Fetched ${totalFetched}, ${afterLookback} within lookback, ${newItems.length} new, processing ${newItems.length}`);

      for (const item of newItems) {
        this.queue.addTask({
          id: item.itemId,
          name: item.title,
          meta: { source, item },
          execute: () => this._fetchContent(source, item),
        });
      }

      // Update last check time
      if (this.dataSourceManager) {
        this.dataSourceManager.updateLastCheck(source.id);
      }
    } catch (err) {
      this.logger.error(`Error checking source ${source.name}: ${err.message}`);
    }
  }

  async _fetchYouTube(source) {
    const maxFetch = Math.min((source.maxItems || 10) * 5, 50);
    const videos = await this.youtubeFetcher.fetchRecentVideosCombined(source.url, maxFetch);
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

  /**
   * Stage 1: Download raw content and save to DB with status='fetched'.
   * Then enqueue for LLM summarization if available.
   */
  async _fetchContent(source, item) {
    const tag = `[${source.name}]`;
    this.logger.info(`${tag} Processing: "${item.title}" (${item.itemId})`);

    try {
      if (source.type === 'youtube' && !item.content) {
        this.logger.info(`${tag} Downloading transcript: "${item.title}"`);
        item.content = await this.youtubeFetcher.fetchTranscript(item.itemId);
        this.logger.info(`${tag} Transcript downloaded: "${item.title}"`);
      }

      await this.storage.saveContent(item);
      this.logger.info(`${tag} Content saved: "${item.title}"`);

      if (this.llmQueue && this.llmService) {
        // Hand off to LLM queue; LLM queue listeners will remove from _pendingItems when done
        this.llmQueue.addTask({
          id: item.itemId,
          name: item.title,
          meta: { source, item },
          execute: () => this._summarizeItem(source, item),
        });
      } else {
        // No LLM pipeline: item stays at status='fetched', processing is complete for this session
        this._pendingItems.delete(item.itemId);
        this.logger.info(`${tag} Saved: "${item.title}" (no LLM configured)`);
      }

      return item;
    } catch (err) {
      this.logger.error(`${tag} Error fetching content for "${item.title}" (${item.itemId}): ${err.message}`);
      throw err;
    }
  }

  /**
   * Stage 2: Run LLM summarization and update DB with status='summarized'.
   */
  async _summarizeItem(source, item) {
    const tag = `[${source.name}]`;
    this.logger.info(`${tag} Summarizing: "${item.title}" (${item.itemId})`);

    try {
      // Get raw content from item (in-memory) or from DB (resume path)
      let rawContent = item.rawContent || item.content;
      if (!rawContent) {
        const dbRow = this.db.getContentItemByItemId(item.itemId);
        rawContent = dbRow?.raw_content;
      }

      if (!rawContent) {
        throw new Error(`No raw content found for item: ${item.itemId}`);
      }

      const sourcePrompt = this._getSourcePrompt(source.id);
      const summaryText = await this.llmService.summarize(rawContent, item.title, sourcePrompt, item.itemId, item.sourceType);
      this.logger.info(`${tag} Summary generated: "${item.title}"`);

      await this.storage.updateSummary(item, summaryText);
      this.logger.info(`${tag} Summary saved: "${item.title}"`);

      return item;
    } catch (err) {
      this.logger.error(`${tag} Error summarizing "${item.title}" (${item.itemId}): ${err.message}`);
      throw err;
    }
  }
}

module.exports = Scheduler;
