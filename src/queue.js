const EventEmitter = require('events');

class QueueConfig {
  constructor({ concurrentLimit = 3, retryAttempts = 3, retryDelay = 1000 } = {}) {
    this.concurrentLimit = concurrentLimit;
    this.retryAttempts = retryAttempts;
    this.retryDelay = retryDelay;
  }
}

class DownloadQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    const config = options instanceof QueueConfig ? options : new QueueConfig(options);
    this.concurrentLimit = config.concurrentLimit;
    this.retryAttempts = config.retryAttempts;
    this.retryDelay = config.retryDelay;

    this.queue = [];       // pending tasks
    this.active = [];      // in-progress tasks
    this.completed = [];   // done tasks
    this.failed = [];      // permanently failed tasks
    this._retryTimers = []; // pending retry setTimeout IDs
    this._stopped = false;
  }

  addTask(task) {
    if (this._stopped) return;
    task.retryCount = task.retryCount || 0;
    task.maxRetries = task.maxRetries ?? this.retryAttempts;
    this.queue.push(task);
    this.emit('taskAdded', task, this.getStatus());
    this._processQueue();
  }

  _processQueue() {
    if (this._stopped) return;
    while (this.queue.length > 0 && this.active.length < this.concurrentLimit) {
      const task = this.queue.shift();
      this.active.push(task);
      this.emit('taskStarted', task, this.getStatus());
      this._executeTask(task);
    }
  }

  async _executeTask(task) {
    try {
      const result = await task.execute();
      this._onComplete(task, result);
    } catch (err) {
      this._onFailed(task, err);
    }
  }

  _onComplete(task, result) {
    const idx = this.active.indexOf(task);
    if (idx !== -1) this.active.splice(idx, 1);
    task.result = result;
    this.completed.push(task);
    if (this.completed.length > 1000) this.completed.splice(0, this.completed.length - 500);
    this.emit('taskCompleted', task, this.getStatus());
    this._processQueue();
  }

  _onFailed(task, error) {
    const idx = this.active.indexOf(task);
    if (idx !== -1) this.active.splice(idx, 1);

    if (!error.permanent && task.retryCount < task.maxRetries) {
      task.retryCount++;
      const delay = this.retryDelay * Math.pow(2, task.retryCount - 1);
      this.emit('taskRetry', task, task.retryCount, delay, this.getStatus());
      const timer = setTimeout(() => {
        const idx = this._retryTimers.indexOf(timer);
        if (idx !== -1) this._retryTimers.splice(idx, 1);
        this.queue.unshift(task);
        this._processQueue();
      }, delay);
      this._retryTimers.push(timer);
    } else {
      task.error = error;
      this.failed.push(task);
      if (this.failed.length > 1000) this.failed.splice(0, this.failed.length - 500);
      this.emit('taskFailed', task, error, this.getStatus());
      this._processQueue();
    }
  }

  getStatus() {
    return {
      pending: this.queue.length,
      active: this.active.length,
      completed: this.completed.length,
      failed: this.failed.length,
    };
  }

  /**
   * Stop accepting new tasks and cancel pending retries.
   * Active tasks continue running until completion.
   */
  stop() {
    this._stopped = true;
    this.queue = [];
    for (const timer of this._retryTimers) {
      clearTimeout(timer);
    }
    this._retryTimers = [];
  }

  /**
   * Returns a promise that resolves when all active tasks finish.
   * Call stop() first to prevent new tasks from being added.
   */
  drain() {
    if (this.active.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.active.length === 0) {
          this.removeListener('taskCompleted', check);
          this.removeListener('taskFailed', check);
          resolve();
        }
      };
      this.on('taskCompleted', check);
      this.on('taskFailed', check);
    });
  }

  updateConcurrentLimit(newLimit) {
    this.concurrentLimit = newLimit;
    this._processQueue();
  }

  get isEmpty() {
    return this.queue.length === 0 && this.active.length === 0;
  }
}

module.exports = DownloadQueue;
module.exports.QueueConfig = QueueConfig;
