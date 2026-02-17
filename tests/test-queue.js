const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DownloadQueue = require('../src/queue');
const { QueueConfig } = require('../src/queue');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createTask(id, durationMs = 50, shouldFail = false) {
  return {
    id, name: `Task-${id}`,
    execute: async () => {
      await sleep(durationMs);
      if (shouldFail) throw new Error(`Task-${id} failed`);
      return `result-${id}`;
    },
  };
}

describe('QueueConfig', () => {
  it('預設值應正確設定', () => {
    const config = new QueueConfig();
    assert.equal(config.concurrentLimit, 3);
    assert.equal(config.retryAttempts, 3);
    assert.equal(config.retryDelay, 1000);
  });

  it('傳入的值應覆蓋預設值', () => {
    const config = new QueueConfig({ concurrentLimit: 5, retryAttempts: 5, retryDelay: 2000 });
    assert.equal(config.concurrentLimit, 5);
    assert.equal(config.retryAttempts, 5);
    assert.equal(config.retryDelay, 2000);
  });

  it('DownloadQueue 傳入 QueueConfig 實例應正常運作', async () => {
    const config = new QueueConfig({ concurrentLimit: 1 });
    const queue = new DownloadQueue(config);
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    queue.addTask(createTask('qc1'));
    await sleep(200);
    assert.deepEqual(completed, ['qc1']);
  });
});

describe('DownloadQueue', () => {
  it('單一任務應成功執行並觸發 taskCompleted', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3 });
    const completed = [];
    queue.on('taskCompleted', (task) => completed.push(task.id));

    queue.addTask(createTask('t1'));
    await sleep(200);
    assert.deepEqual(completed, ['t1']);
    assert.equal(queue.completed[0].result, 'result-t1');
  });

  it('同時進行的任務不應超過 concurrentLimit', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 2 });
    let maxConcurrent = 0, current = 0;

    const tracked = (id) => ({
      id, name: id,
      execute: async () => { current++; maxConcurrent = Math.max(maxConcurrent, current); await sleep(100); current--; },
    });

    queue.addTask(tracked('a'));
    queue.addTask(tracked('b'));
    queue.addTask(tracked('c'));
    queue.addTask(tracked('d'));
    await sleep(500);

    assert.equal(maxConcurrent, 2);
    assert.equal(queue.completed.length, 4);
  });

  it('失敗任務應自動重試 (指數退避)', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 2, retryDelay: 50 });
    const retries = [];
    queue.on('taskRetry', (task, count) => retries.push(count));

    let attempts = 0;
    queue.addTask({
      id: 'r', name: 'r',
      execute: async () => { attempts++; if (attempts < 3) throw new Error('fail'); return 'ok'; },
    });
    await sleep(500);

    assert.equal(attempts, 3);
    assert.deepEqual(retries, [1, 2]);
    assert.equal(queue.completed.length, 1);
  });

  it('用盡重試次數後應移入 failed', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 3, retryAttempts: 2, retryDelay: 50 });
    queue.addTask(createTask('fail', 10, true));
    await sleep(500);

    assert.equal(queue.failed.length, 1);
    assert.equal(queue.failed[0].id, 'fail');
  });

  it('事件觸發順序: taskAdded → taskStarted → taskCompleted', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 1 });
    const events = [];
    queue.on('taskAdded', () => events.push('added'));
    queue.on('taskStarted', () => events.push('started'));
    queue.on('taskCompleted', () => events.push('completed'));

    queue.addTask(createTask('evt'));
    await sleep(200);
    assert.deepEqual(events, ['added', 'started', 'completed']);
  });

  it('getStatus() 應回傳正確的各狀態計數', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 1 });
    queue.addTask(createTask('s1', 200));
    queue.addTask(createTask('s2', 200));

    await sleep(50);
    const status = queue.getStatus();
    assert.equal(status.active, 1);
    assert.equal(status.pending, 1);

    await sleep(500);
    const final = queue.getStatus();
    assert.equal(final.completed, 2);
    assert.equal(final.active, 0);
  });

  it('updateConcurrentLimit() 應動態調整並發數', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 1 });
    let maxConcurrent = 0, current = 0;

    const tracked = (id) => ({
      id, name: id,
      execute: async () => { current++; maxConcurrent = Math.max(maxConcurrent, current); await sleep(100); current--; },
    });

    queue.addTask(tracked('u1'));
    queue.addTask(tracked('u2'));
    queue.addTask(tracked('u3'));
    queue.updateConcurrentLimit(3);
    await sleep(300);

    assert.ok(maxConcurrent >= 2);
  });

  it('isEmpty 屬性', async () => {
    const queue = new DownloadQueue();
    assert.equal(queue.isEmpty, true);
    queue.addTask(createTask('e1', 50));
    assert.equal(queue.isEmpty, false);
    await sleep(200);
    assert.equal(queue.isEmpty, true);
  });

  it('stop() 應停止接受新任務並取消 pending retries', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 1, retryAttempts: 2, retryDelay: 100 });
    let execCount = 0;
    queue.addTask({ id: 'stop-1', execute: async () => { execCount++; throw new Error('fail'); } });
    // Wait for first attempt + first retry timer to be set
    await sleep(200);
    queue.stop();
    // After stop, no more retries should fire and new tasks are rejected
    queue.addTask({ id: 'stop-2', execute: async () => { execCount = 999; } });
    await sleep(500);
    assert.ok(execCount < 5, 'should not have continued retrying after stop');
    assert.equal(queue.queue.length, 0, 'pending queue should be empty after stop');
  });

  it('drain() 應等待所有 active 任務完成', async () => {
    const queue = new DownloadQueue({ concurrentLimit: 2 });
    const completed = [];
    queue.addTask({ id: 'd1', execute: () => sleep(100).then(() => { completed.push('d1'); }) });
    queue.addTask({ id: 'd2', execute: () => sleep(150).then(() => { completed.push('d2'); }) });
    queue.stop(); // Stop accepting new tasks
    await queue.drain(); // Wait for active tasks to finish
    assert.deepEqual(completed.sort(), ['d1', 'd2']);
  });
});
