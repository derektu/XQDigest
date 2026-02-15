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
  }

  addTask(task) {
    task.retryCount = task.retryCount || 0;
    task.maxRetries = task.maxRetries ?? this.retryAttempts;
    this.queue.push(task);
    this.emit('taskAdded', task, this.getStatus());
    this._processQueue();
  }

  _processQueue() {
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
    this.emit('taskCompleted', task, this.getStatus());
    this._processQueue();
  }

  _onFailed(task, error) {
    const idx = this.active.indexOf(task);
    if (idx !== -1) this.active.splice(idx, 1);

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      const delay = this.retryDelay * Math.pow(2, task.retryCount - 1);
      this.emit('taskRetry', task, task.retryCount, delay, this.getStatus());
      setTimeout(() => {
        this.queue.unshift(task);
        this._processQueue();
      }, delay);
    } else {
      task.error = error;
      this.failed.push(task);
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
