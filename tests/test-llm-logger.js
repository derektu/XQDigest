const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LLMLogger = require('../src/llm-logger');

const TMP_DIR = path.join(__dirname, '_tmp_llm_logger');

describe('LLMLogger', () => {
  before(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  });

  it('close() 後應可再次建立 LLMLogger（不應拋出錯誤）', async () => {
    const l = new LLMLogger(TMP_DIR);
    await assert.doesNotReject(() => l.close());
  });

  it('log() 成功呼叫應寫入 llm.log（INFO 格式）', async () => {
    const logDir = path.join(TMP_DIR, 'test-success');
    const logger = new LLMLogger(logDir);
    logger.log({
      itemId: 'abc123',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 1234,
      completionTokens: 456,
      durationMs: 2341,
      status: 'success',
    });
    // Await close() to ensure stream is flushed before reading
    await logger.close();

    const logPath = path.join(logDir, 'llm.log');
    assert.ok(fs.existsSync(logPath), 'llm.log should be created');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('itemId=abc123'));
    assert.ok(content.includes('provider=openai'));
    assert.ok(content.includes('model=gpt-4o-mini'));
    assert.ok(content.includes('in=1234'));
    assert.ok(content.includes('out=456'));
    assert.ok(content.includes('ms=2341'));
    assert.ok(content.includes('status=success'));
    assert.ok(content.includes('[INFO]'));
  });

  it('log() 錯誤呼叫應寫入 ERROR 格式並含 error 欄位', async () => {
    const logDir = path.join(TMP_DIR, 'test-error');
    const logger = new LLMLogger(logDir);
    logger.log({
      itemId: 'err-item',
      provider: 'gemini',
      model: 'gemini-pro',
      durationMs: 500,
      status: 'error',
      error: 'API quota exceeded',
    });
    await logger.close();

    const content = fs.readFileSync(path.join(logDir, 'llm.log'), 'utf8');
    assert.ok(content.includes('itemId=err-item'));
    assert.ok(content.includes('error=API quota exceeded'));
    assert.ok(content.includes('[ERROR]'));
  });

  it('log() 無 token 資訊時不應輸出 in=/out= 欄位', async () => {
    const logDir = path.join(TMP_DIR, 'test-notokens');
    const logger = new LLMLogger(logDir);
    logger.log({
      itemId: 'no-tokens',
      provider: 'openai',
      model: 'gpt-4o',
      durationMs: 100,
      status: 'success',
    });
    await logger.close();

    const content = fs.readFileSync(path.join(logDir, 'llm.log'), 'utf8');
    assert.ok(!content.includes('in='));
    assert.ok(!content.includes('out='));
    assert.ok(content.includes('ms=100'));
  });

  it('log() 寫入的格式應含時間戳與 [LLM] 類別', async () => {
    const logDir = path.join(TMP_DIR, 'test-format');
    const logger = new LLMLogger(logDir);
    logger.log({
      itemId: 'fmt-test',
      provider: 'openai',
      model: 'gpt-4o',
      durationMs: 50,
      status: 'success',
    });
    await logger.close();

    const content = fs.readFileSync(path.join(logDir, 'llm.log'), 'utf8');
    // Logger format: [YYYY-MM-DD HH:mm:ss.xxx] [LLM] [LEVEL] ...
    assert.ok(/\[\d{4}-\d{2}-\d{2}/.test(content));
    assert.ok(content.includes('[LLM]'));
  });
});
