const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LLMService = require('../src/llm');
const { LLMServiceConfig } = require('../src/llm');
const OpenAIProvider = require('../src/llm/openai');
const GeminiProvider = require('../src/llm/gemini');
const BaseLLMProvider = require('../src/llm/base');
const { LLMProviderConfig } = require('../src/llm/base');

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('LLMProviderConfig', () => {
  it('預設值應正確設定', () => {
    const config = new LLMProviderConfig({ model: 'gpt-4o' });
    assert.equal(config.model, 'gpt-4o');
    assert.equal(config.maxTokens, 1000);
    assert.equal(config.temperature, 0.7);
    assert.equal(config.systemPrompt, '');
    assert.equal(config.apiKey, undefined);
    assert.equal(config.baseUrl, undefined);
  });

  it('傳入的值應覆蓋預設值', () => {
    const config = new LLMProviderConfig({ model: 'gpt-4o', maxTokens: 2000, temperature: 0.5, apiKey: 'key', baseUrl: 'http://localhost', systemPrompt: 'hi' });
    assert.equal(config.maxTokens, 2000);
    assert.equal(config.temperature, 0.5);
    assert.equal(config.apiKey, 'key');
    assert.equal(config.baseUrl, 'http://localhost');
    assert.equal(config.systemPrompt, 'hi');
  });
});

describe('LLMServiceConfig', () => {
  it('預設值應正確設定', () => {
    const config = new LLMServiceConfig({ provider: 'openai', apiKey: 'key', model: 'gpt-4o' });
    assert.equal(config.provider, 'openai');
    assert.equal(config.apiKey, 'key');
    assert.equal(config.model, 'gpt-4o');
    assert.equal(config.maxTokens, 1000);
    assert.equal(config.temperature, 0.7);
    assert.equal(config.systemPrompt, '');
    assert.equal(config.summarizationPrompt, undefined);
  });

  it('傳入的值應覆蓋預設值', () => {
    const config = new LLMServiceConfig({ provider: 'gemini', apiKey: 'k', model: 'm', maxTokens: 500, temperature: 0.3, summarizationPrompt: 'custom' });
    assert.equal(config.maxTokens, 500);
    assert.equal(config.temperature, 0.3);
    assert.equal(config.summarizationPrompt, 'custom');
  });

  it('LLMService 傳入 LLMServiceConfig 實例應正常運作', () => {
    const config = new LLMServiceConfig({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '自訂' });
    const svc = new LLMService(config, logger);
    assert.ok(svc.provider instanceof OpenAIProvider);
    assert.equal(svc.defaultPrompt, '自訂');
  });
});

describe('BaseLLMProvider', () => {
  it('chatCompletion() 未實作時應拋出錯誤', async () => {
    const base = new BaseLLMProvider({ model: 'test' }, logger);
    await assert.rejects(
      () => base.chatCompletion([{ role: 'user', content: 'hi' }]),
      /must be implemented by subclass/
    );
  });

});

describe('OpenAIProvider', () => {
  it('應繼承 BaseLLMProvider', () => {
    const provider = new OpenAIProvider({ apiKey: 'fake', model: 'gpt-4o-mini', systemPrompt: '' }, logger);
    assert.ok(provider instanceof BaseLLMProvider);
  });

  it('應正確設定 model 和 systemPrompt', () => {
    const provider = new OpenAIProvider({ apiKey: 'fake', model: 'gpt-4o', systemPrompt: 'test prompt' }, logger);
    assert.equal(provider.model, 'gpt-4o');
    assert.equal(provider.systemPrompt, 'test prompt');
  });

  it('應支援 baseUrl 設定', () => {
    const provider = new OpenAIProvider({
      apiKey: 'fake', model: 'x', baseUrl: 'http://localhost:1234/v1', systemPrompt: '',
    }, logger);
    assert.ok(provider.client);
  });
});

describe('GeminiProvider', () => {
  it('應繼承 BaseLLMProvider', () => {
    const provider = new GeminiProvider({ apiKey: 'fake', model: 'gemini-pro', systemPrompt: '' }, logger);
    assert.ok(provider instanceof BaseLLMProvider);
  });

  it('應正確設定 model 和 systemPrompt', () => {
    const provider = new GeminiProvider({ apiKey: 'fake', model: 'gemini-2.0-flash', systemPrompt: 'test' }, logger);
    assert.equal(provider.model, 'gemini-2.0-flash');
    assert.equal(provider.systemPrompt, 'test');
  });
});

describe('LLMService', () => {
  it('provider="openai" 應建立 OpenAIProvider', () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    assert.ok(svc.provider instanceof OpenAIProvider);
  });

  it('provider="openai-compatible" 應使用 OpenAIProvider', () => {
    const svc = new LLMService({ provider: 'openai-compatible', apiKey: 'fake', model: 'x', baseUrl: 'http://localhost:1234/v1' }, logger);
    assert.ok(svc.provider instanceof OpenAIProvider);
  });

  it('provider="gemini" 應建立 GeminiProvider', () => {
    const svc = new LLMService({ provider: 'gemini', apiKey: 'fake', model: 'gemini-pro', summarizationPrompt: '' }, logger);
    assert.ok(svc.provider instanceof GeminiProvider);
  });

  it('無效 provider 應拋出錯誤', () => {
    assert.throws(() => new LLMService({ provider: 'invalid', apiKey: 'x', model: 'x' }, logger), /Unknown LLM provider/);
  });

  it('providerName 應正確記錄', () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    assert.equal(svc.providerName, 'openai');
  });

  it('updateConfig() 應重建 provider 並更新 providerName', () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    svc.updateConfig({ provider: 'gemini', apiKey: 'new', model: 'gemini-pro', summarizationPrompt: '' });
    assert.equal(svc.provider.model, 'gemini-pro');
    assert.equal(svc.providerName, 'gemini');
  });

  it('chat() 應代理到 provider.chatCompletion() 並回傳 text', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    // Mock the provider's chatCompletion to return new format
    let capturedMessages, capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return { text: 'mock response', usage: null };
    };

    const result = await svc.chat(
      [{ role: 'user', content: 'hello' }],
      { responseFormat: 'json' }
    );

    assert.equal(result, 'mock response');
    assert.deepEqual(capturedMessages, [{ role: 'user', content: 'hello' }]);
    assert.deepEqual(capturedOptions, { responseFormat: 'json' });
  });

  it('summarize() 應解析 JSON 回應並回傳 summary 欄位', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    svc.provider.chatCompletion = async () => ({ text: '{"summary":"摘要文字"}', usage: null });

    const result = await svc.summarize('content text', 'Test Title');
    assert.equal(result, '摘要文字');
  });

  it('summarize() JSON 解析失敗時應回傳原始文字', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    svc.provider.chatCompletion = async () => ({ text: 'not json text', usage: null });

    const result = await svc.summarize('content', 'Title');
    assert.equal(result, 'not json text');
  });

  it('summarize() 應使用 JSON responseFormat 並以 system message 傳遞 prompt', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    let capturedMessages, capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return { text: '{}', usage: null };
    };

    await svc.summarize('content', 'Title');
    assert.equal(capturedOptions.responseFormat, 'json');
    // Summarize prompt should be passed as system message, not via provider's systemPrompt
    assert.equal(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages[0].content.length > 0);
    // System message 尾端應包含 JSON 格式指示
    assert.ok(capturedMessages[0].content.endsWith('請以 JSON 格式回應，僅包含一個 "summary" 欄位。'));
    assert.equal(capturedMessages[1].role, 'user');
  });

  it('summarize() 有 customPrompt 時不附加 JSON 指令，直接回傳 raw text', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    let capturedMessages, capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return { text: '## 摘要標題\n\n這是 markdown 格式的摘要', usage: null };
    };

    const result = await svc.summarize('content', 'Title', '自訂 prompt');
    // customPrompt should be used as-is, no JSON instruction appended
    assert.equal(capturedMessages[0].role, 'system');
    assert.equal(capturedMessages[0].content, '自訂 prompt');
    // Should NOT request JSON response format
    assert.equal(capturedOptions.responseFormat, undefined);
    // Should return raw LLM response without JSON parsing
    assert.equal(result, '## 摘要標題\n\n這是 markdown 格式的摘要');
  });

  it('summarize() config.summarizationPrompt 不應附加 JSON 指令，直接回傳 raw text', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '自訂系統 prompt' }, logger);
    let capturedMessages, capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return { text: '## 摘要結果', usage: null };
    };

    const result = await svc.summarize('content', 'Title');
    // Config summarizationPrompt should be used as-is, no JSON instruction
    assert.equal(capturedMessages[0].content, '自訂系統 prompt');
    assert.equal(capturedOptions.responseFormat, undefined);
    assert.equal(result, '## 摘要結果');
  });

  it('summarize() 失敗時應拋出錯誤', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    svc.provider.chatCompletion = async () => { throw new Error('API error'); };

    await assert.rejects(
      () => svc.summarize('content', 'Title'),
      /API error/
    );
  });

  it('summarize() 應處理 markdown code fence 包裹的 JSON', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    svc.provider.chatCompletion = async () => ({ text: '```json\n{"summary":"fenced summary"}\n```', usage: null });

    const result = await svc.summarize('content', 'Title');
    assert.equal(result, 'fenced summary');
  });

  it('summarize() 應呼叫 llmLogger.log() 記錄成功結果', async () => {
    const loggedCalls = [];
    const llmLogger = {
      log: (params) => loggedCalls.push(params),
    };
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger, llmLogger);
    svc.provider.chatCompletion = async () => ({
      text: '{"summary":"test"}',
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    await svc.summarize('content', 'Title', null, 'item-abc');
    assert.equal(loggedCalls.length, 1);
    assert.equal(loggedCalls[0].itemId, 'item-abc');
    assert.equal(loggedCalls[0].provider, 'openai');
    assert.equal(loggedCalls[0].model, 'gpt-4o-mini');
    assert.equal(loggedCalls[0].promptTokens, 100);
    assert.equal(loggedCalls[0].completionTokens, 50);
    assert.equal(loggedCalls[0].status, 'success');
  });

  it('summarize() 失敗時應呼叫 llmLogger.log() 記錄錯誤', async () => {
    const loggedCalls = [];
    const llmLogger = {
      log: (params) => loggedCalls.push(params),
    };
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger, llmLogger);
    svc.provider.chatCompletion = async () => { throw new Error('API error'); };

    await assert.rejects(() => svc.summarize('content', 'Title', null, 'item-xyz'), /API error/);
    assert.equal(loggedCalls.length, 1);
    assert.equal(loggedCalls[0].itemId, 'item-xyz');
    assert.equal(loggedCalls[0].status, 'error');
    assert.ok(loggedCalls[0].error.includes('API error'));
  });

  it('summarize() 無 itemId 時不呼叫 llmLogger.log()', async () => {
    const loggedCalls = [];
    const llmLogger = { log: (p) => loggedCalls.push(p) };
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger, llmLogger);
    svc.provider.chatCompletion = async () => ({ text: '{"summary":"x"}', usage: null });

    await svc.summarize('content', 'Title'); // no itemId
    assert.equal(loggedCalls.length, 0);
  });

  it('_parseJSON() 應正確解析 JSON 字串', () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    const result = svc._parseJSON('{"summary":"hello"}');
    assert.equal(result.summary, 'hello');
  });

  it('_parseJSON() 無效 JSON 應回傳 { raw: text }', () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    const result = svc._parseJSON('not json');
    assert.equal(result.raw, 'not json');
  });
});
