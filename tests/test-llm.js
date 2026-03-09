const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LLMService = require('../src/llm');
const { LLMServiceConfig } = require('../src/llm');
const { SUMMARY_LENGTH_SPECS } = require('../src/llm/prompts');
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
    assert.equal(config.outputLevel, 'auto');
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
    assert.equal(svc.outputLevel, 'auto');
  });

  it('outputLevel 設定應正確傳遞到 LLMService', () => {
    const config = new LLMServiceConfig({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', outputLevel: 'xl' });
    const svc = new LLMService(config, logger);
    assert.equal(svc.outputLevel, 'xl');
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

describe('OpenAIProvider streaming', () => {
  it('chatCompletion() 應累積所有 delta 回傳完整 text', async () => {
    const provider = new OpenAIProvider({ apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    provider.client.chat.completions.create = async () => (async function*() {
      yield { choices: [{ delta: { content: 'hello ' } }] };
      yield { choices: [{ delta: { content: 'world' } }] };
      yield { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    })();
    const { text } = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.equal(text, 'hello world');
  });

  it('chatCompletion() onChunk 應在每個 delta 呼叫一次', async () => {
    const provider = new OpenAIProvider({ apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    provider.client.chat.completions.create = async () => (async function*() {
      yield { choices: [{ delta: { content: 'hello ' } }] };
      yield { choices: [{ delta: { content: 'world' } }] };
      yield { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    })();
    const chunks = [];
    await provider.chatCompletion([{ role: 'user', content: 'hi' }], { onChunk: (d) => chunks.push(d) });
    assert.deepEqual(chunks, ['hello ', 'world']);
  });

  it('chatCompletion() 無 onChunk 仍正確回傳 text', async () => {
    const provider = new OpenAIProvider({ apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    provider.client.chat.completions.create = async () => (async function*() {
      yield { choices: [{ delta: { content: 'result' } }] };
      yield { choices: [{ delta: {} }], usage: null };
    })();
    const { text } = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.equal(text, 'result');
  });

  it('chatCompletion() usage 應從最後 chunk 正確取得', async () => {
    const provider = new OpenAIProvider({ apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    provider.client.chat.completions.create = async () => (async function*() {
      yield { choices: [{ delta: { content: 'ok' } }] };
      yield { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    })();
    const { usage } = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.deepEqual(usage, { promptTokens: 10, completionTokens: 5 });
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

  it('chatCompletion() 應累積所有 delta 回傳完整 text', async () => {
    const provider = new GeminiProvider({ apiKey: 'fake', model: 'gemini-pro' }, logger);
    provider.genAI.getGenerativeModel = () => ({
      generateContentStream: async () => ({
        stream: (async function*() {
          yield { text: () => 'hello ' };
          yield { text: () => 'world' };
        })(),
        response: Promise.resolve({ usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 } }),
      }),
    });
    const { text } = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.equal(text, 'hello world');
  });

  it('chatCompletion() onChunk 應在每個 delta 呼叫一次', async () => {
    const provider = new GeminiProvider({ apiKey: 'fake', model: 'gemini-pro' }, logger);
    provider.genAI.getGenerativeModel = () => ({
      generateContentStream: async () => ({
        stream: (async function*() {
          yield { text: () => 'hello ' };
          yield { text: () => 'world' };
        })(),
        response: Promise.resolve({ usageMetadata: null }),
      }),
    });
    const chunks = [];
    await provider.chatCompletion([{ role: 'user', content: 'hi' }], { onChunk: (d) => chunks.push(d) });
    assert.deepEqual(chunks, ['hello ', 'world']);
  });

  it('chatCompletion() 無 onChunk 仍正確回傳 text', async () => {
    const provider = new GeminiProvider({ apiKey: 'fake', model: 'gemini-pro' }, logger);
    provider.genAI.getGenerativeModel = () => ({
      generateContentStream: async () => ({
        stream: (async function*() {
          yield { text: () => 'result' };
        })(),
        response: Promise.resolve({ usageMetadata: null }),
      }),
    });
    const { text } = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.equal(text, 'result');
  });

  it('chatCompletion() usage 應從 response 正確取得', async () => {
    const provider = new GeminiProvider({ apiKey: 'fake', model: 'gemini-pro' }, logger);
    provider.genAI.getGenerativeModel = () => ({
      generateContentStream: async () => ({
        stream: (async function*() {
          yield { text: () => 'ok' };
        })(),
        response: Promise.resolve({ usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 } }),
      }),
    });
    const { usage } = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.deepEqual(usage, { promptTokens: 8, completionTokens: 4 });
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

  it('summarize() 應以 system message 傳遞 prompt，直接回傳 raw text', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    let capturedMessages, capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return { text: '整體摘要。\n\n• 要點一\n• 要點二', usage: null };
    };

    const result = await svc.summarize('content', 'Title');
    assert.equal(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages[0].content.length > 0);
    assert.equal(capturedMessages[1].role, 'user');
    assert.equal(capturedOptions.responseFormat, undefined);
    assert.equal(result, '整體摘要。\n\n• 要點一\n• 要點二');
  });

  it('summarize() 無 customPrompt 時應使用 SummarizePromptBuilder（short content → short spec）', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    let capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedOptions = options;
      return { text: '摘要', usage: null };
    };

    await svc.summarize('short content', 'Title', null, null, 'rss');
    assert.equal(capturedOptions.maxTokens, SUMMARY_LENGTH_SPECS.short.maxTokens);
  });

  it('summarize() outputLevel=xl 應使用 xl spec maxTokens', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', outputLevel: 'xl' }, logger);
    let capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedOptions = options;
      return { text: '摘要', usage: null };
    };

    // short content but outputLevel=xl overrides
    await svc.summarize('short content', 'Title', null, null, 'rss');
    assert.equal(capturedOptions.maxTokens, SUMMARY_LENGTH_SPECS.xl.maxTokens);
  });

  it('summarize() 有 customPrompt 時應使用 customPrompt 並直接回傳 raw text', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '' }, logger);
    let capturedMessages;
    svc.provider.chatCompletion = async (messages) => {
      capturedMessages = messages;
      return { text: '## 摘要標題\n\n這是 markdown 格式的摘要', usage: null };
    };

    const result = await svc.summarize('content', 'Title', '自訂 prompt');
    assert.equal(capturedMessages[0].content, '自訂 prompt');
    assert.equal(result, '## 摘要標題\n\n這是 markdown 格式的摘要');
  });

  it('summarize() 有 customPrompt 時 maxTokens 應使用 config.maxTokens（非 hardcoded）', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', maxTokens: 2048 }, logger);
    let capturedOptions;
    svc.provider.chatCompletion = async (messages, options) => {
      capturedOptions = options;
      return { text: '摘要', usage: null };
    };

    await svc.summarize('content', 'Title', '自訂 prompt');
    assert.equal(capturedOptions.maxTokens, 2048);
  });

  it('summarize() config.summarizationPrompt 應作為預設 prompt', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini', summarizationPrompt: '自訂系統 prompt' }, logger);
    let capturedMessages;
    svc.provider.chatCompletion = async (messages) => {
      capturedMessages = messages;
      return { text: '## 摘要結果', usage: null };
    };

    const result = await svc.summarize('content', 'Title');
    assert.equal(capturedMessages[0].content, '自訂系統 prompt');
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

  it('summarize() 應呼叫 llmLogger.log() 記錄成功結果', async () => {
    const loggedCalls = [];
    const llmLogger = {
      log: (params) => loggedCalls.push(params),
    };
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger, llmLogger);
    svc.provider.chatCompletion = async () => ({
      text: '整體摘要。\n\n• 要點一\n• 要點二',
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
    svc.provider.chatCompletion = async () => ({ text: '摘要文字', usage: null });

    await svc.summarize('content', 'Title'); // no itemId
    assert.equal(loggedCalls.length, 0);
  });

  it('summarize() 回傳被 ```markdown 包裹時應自動 strip', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    svc.provider.chatCompletion = async () => ({
      text: '```markdown\n## 標題\n\n內文段落\n```',
      usage: null,
    });
    const result = await svc.summarize('content', 'Title');
    assert.equal(result, '## 標題\n\n內文段落');
  });

  it('summarize() 回傳被 ``` 包裹時應自動 strip', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    svc.provider.chatCompletion = async () => ({
      text: '```\n## 標題\n\n內文段落\n```',
      usage: null,
    });
    const result = await svc.summarize('content', 'Title');
    assert.equal(result, '## 標題\n\n內文段落');
  });

  it('summarize() 回傳正常 Markdown 時不應改變內容', async () => {
    const svc = new LLMService({ provider: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' }, logger);
    const rawText = '## 標題\n\n內文段落\n\n- 項目一\n- 項目二';
    svc.provider.chatCompletion = async () => ({ text: rawText, usage: null });
    const result = await svc.summarize('content', 'Title');
    assert.equal(result, rawText);
  });
});
