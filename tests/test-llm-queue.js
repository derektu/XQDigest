const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LLMQueue = require('../src/llm-queue');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('LLMQueue', () => {
  it('addTask() 應執行 task 並 emit taskCompleted', async () => {
    const q = new LLMQueue({ retryAttempts: 0, logger });
    let executed = false;
    const events = [];
    q.on('taskCompleted', (task) => events.push(task.id));

    q.addTask({
      id: 'task-1',
      name: 'Test Task',
      execute: async () => { executed = true; return 'result'; },
    });

    await sleep(50);
    assert.ok(executed);
    assert.deepEqual(events, ['task-1']);
  });

  it('task 失敗時應 emit taskFailed（retryAttempts=0）', async () => {
    const q = new LLMQueue({ retryAttempts: 0, logger });
    const failed = [];
    q.on('taskFailed', (task, err) => failed.push({ id: task.id, msg: err.message }));

    q.addTask({
      id: 'fail-1',
      name: 'Fail Task',
      execute: async () => { throw new Error('oops'); },
    });

    await sleep(50);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].id, 'fail-1');
    assert.equal(failed[0].msg, 'oops');
  });

  it('retryAttempts=1 時應重試一次後 emit taskFailed', async () => {
    const q = new LLMQueue({ retryAttempts: 1, retryDelay: 50, logger });
    const retries = [];
    const failed = [];
    q.on('taskRetry', (task, count) => retries.push(count));
    q.on('taskFailed', (task) => failed.push(task.id));

    let callCount = 0;
    q.addTask({
      id: 'retry-1',
      name: 'Retry Task',
      execute: async () => { callCount++; throw new Error('always fail'); },
    });

    await sleep(300);
    assert.equal(callCount, 2);  // 1 initial + 1 retry
    assert.deepEqual(retries, [1]);
    assert.equal(failed.length, 1);
  });

  it('retryAttempts=1 時首次失敗後成功應 emit taskCompleted', async () => {
    const q = new LLMQueue({ retryAttempts: 1, retryDelay: 50, logger });
    const completed = [];
    q.on('taskCompleted', (task) => completed.push(task.id));

    let callCount = 0;
    q.addTask({
      id: 'retry-ok-1',
      name: 'Retry OK',
      execute: async () => {
        callCount++;
        if (callCount === 1) throw new Error('first fail');
        return 'ok';
      },
    });

    await sleep(300);
    assert.equal(callCount, 2);
    assert.deepEqual(completed, ['retry-ok-1']);
  });

  it('應依序（single-thread）執行多個 tasks', async () => {
    const q = new LLMQueue({ retryAttempts: 0, logger });
    const order = [];

    for (let i = 1; i <= 3; i++) {
      const n = i;
      q.addTask({
        id: `task-${n}`,
        name: `Task ${n}`,
        execute: async () => { order.push(n); },
      });
    }

    await sleep(100);
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('stop() 應清空 pending queue 並取消 retryTimer', async () => {
    const q = new LLMQueue({ retryAttempts: 1, retryDelay: 10000, logger });
    let callCount = 0;
    q.addTask({
      id: 'stop-1',
      name: 'Stop Task',
      execute: async () => { callCount++; throw new Error('fail'); },
    });

    await sleep(50); // initial execution starts
    q.stop();

    await sleep(100);
    // Only 1 call (no retry because timer was cancelled)
    assert.equal(callCount, 1);
  });

  it('drain() 應等待 active task 完成', async () => {
    const q = new LLMQueue({ retryAttempts: 0, logger });
    let done = false;

    q.addTask({
      id: 'drain-1',
      name: 'Drain Task',
      execute: async () => { await sleep(100); done = true; },
    });

    await sleep(10); // task has started
    q.stop();
    await q.drain();
    assert.ok(done);
  });

  it('getStatus() 應回傳正確資訊', async () => {
    const q = new LLMQueue({ retryAttempts: 0, requestsPerMinute: 60, logger });
    const status = q.getStatus();
    assert.equal(status.pending, 0);
    assert.equal(status.active, 0);
    assert.equal(status.completed, 0);
    assert.ok(status.rateLimitInfo !== null);
    assert.equal(status.rateLimitInfo.requestsPerMinute, 60);
  });

  it('getStatus() requestsPerMinute=0 時 rateLimitInfo 應為 null', () => {
    const q = new LLMQueue({ requestsPerMinute: 0, logger });
    const status = q.getStatus();
    assert.equal(status.rateLimitInfo, null);
  });

  it('updateRateLimit() 應動態更新 rpm', () => {
    const q = new LLMQueue({ requestsPerMinute: 10, logger });
    assert.equal(q.requestsPerMinute, 10);
    q.updateRateLimit(20);
    assert.equal(q.requestsPerMinute, 20);
    q.updateRateLimit(0);
    assert.equal(q.requestsPerMinute, 0);
  });

  it('isEmpty 應在佇列空且無 active task 時回傳 true', async () => {
    const q = new LLMQueue({ retryAttempts: 0, logger });
    assert.ok(q.isEmpty);

    q.addTask({ id: 'x', name: 'x', execute: async () => sleep(50) });
    assert.ok(!q.isEmpty); // task is running

    await sleep(100);
    assert.ok(q.isEmpty);
  });
});
