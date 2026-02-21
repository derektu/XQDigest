const EventEmitter = require('events');
const Logger = require('./logger');

/**
 * Single-threaded task queue for LLM calls with sliding window rate limiting.
 * Emits: taskAdded, taskStarted, taskCompleted, taskRetry, taskFailed, rateLimitWait
 */
class LLMQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.retryAttempts = options.retryAttempts ?? 3;
    this.retryDelay = options.retryDelay ?? 5000;
    this.requestsPerMinute = options.requestsPerMinute ?? 0;

    this.logger = options.logger || Logger.getLogger('LLMQueue');

    this._queue = [];
    this._active = false;   // single-threaded: at most one task running at a time
    this._stopped = false;
    this._retryTimer = null;
    this._requestTimestamps = [];  // sliding window for rate limiting

    this.completed = [];
    this.failed = [];
  }

  addTask(task) {
    if (this._stopped) return;
    task.retryCount = task.retryCount || 0;
    task.maxRetries = task.maxRetries ?? this.retryAttempts;
    this._queue.push(task);
    this.emit('taskAdded', task, this.getStatus());
    this._processQueue();
  }

  _processQueue() {
    if (this._stopped || this._active || this._queue.length === 0) return;
    const task = this._queue.shift();
    this._active = true;
    this.emit('taskStarted', task, this.getStatus());
    this._executeTask(task);
  }

  async _executeTask(task) {
    try {
      await this._waitForRateLimit();
      if (this._stopped) {
        this._active = false;
        return;
      }
      this._recordRequest();
      const result = await task.execute();
      this._onComplete(task, result);
    } catch (err) {
      this._onFailed(task, err);
    }
  }

  _recordRequest() {
    this._requestTimestamps.push(Date.now());
  }

  async _waitForRateLimit() {
    if (!this.requestsPerMinute || this.requestsPerMinute <= 0) return;

    while (true) {
      const now = Date.now();
      // Remove timestamps older than 60 seconds
      this._requestTimestamps = this._requestTimestamps.filter(ts => now - ts < 60000);

      if (this._requestTimestamps.length < this.requestsPerMinute) {
        break;
      }

      // Wait until the oldest request falls outside the 60-second window
      const oldest = this._requestTimestamps[0];
      const waitMs = oldest + 60000 - now;
      if (waitMs > 0) {
        this.logger.info(`Rate limit: waiting ${waitMs}ms (${this._requestTimestamps.length}/${this.requestsPerMinute} req/min)`);
        this.emit('rateLimitWait', waitMs, this.getStatus());
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  _onComplete(task, result) {
    this._active = false;
    task.result = result;
    this.completed.push(task);
    if (this.completed.length > 1000) this.completed.splice(0, this.completed.length - 500);
    this.emit('taskCompleted', task, this.getStatus());
    this._processQueue();
  }

  _onFailed(task, error) {
    this._active = false;

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      const delay = this.retryDelay * Math.pow(2, task.retryCount - 1);
      this.emit('taskRetry', task, task.retryCount, delay, this.getStatus());
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this._queue.unshift(task);
        this._processQueue();
      }, delay);
    } else {
      task.error = error;
      this.failed.push(task);
      if (this.failed.length > 1000) this.failed.splice(0, this.failed.length - 500);
      this.emit('taskFailed', task, error, this.getStatus());
      this._processQueue();
    }
  }

  getStatus() {
    const now = Date.now();
    const recentRequests = this._requestTimestamps.filter(ts => now - ts < 60000).length;
    return {
      pending: this._queue.length,
      active: this._active ? 1 : 0,
      completed: this.completed.length,
      failed: this.failed.length,
      rateLimitInfo: this.requestsPerMinute > 0
        ? { requestsPerMinute: this.requestsPerMinute, recentRequests }
        : null,
    };
  }

  /**
   * Stop accepting new tasks and cancel pending retry timer.
   * Active task continues running until completion.
   */
  stop() {
    this._stopped = true;
    this._queue = [];
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  /**
   * Returns a promise that resolves when the active task finishes.
   * Call stop() first to prevent new tasks from being added.
   */
  drain() {
    if (!this._active) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (!this._active) {
          this.removeListener('taskCompleted', check);
          this.removeListener('taskFailed', check);
          resolve();
        }
      };
      this.on('taskCompleted', check);
      this.on('taskFailed', check);
    });
  }

  updateRateLimit(rpm) {
    this.requestsPerMinute = rpm || 0;
  }

  get isEmpty() {
    return this._queue.length === 0 && !this._active;
  }
}

module.exports = LLMQueue;
