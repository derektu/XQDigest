'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseLLMProvider = require('../src/llm/base');
const { OpenAIOAuthProvider } = require('../src/llm/openai-oauth');
const LLMService = require('../src/llm');
const { LLMServiceConfig } = require('../src/llm');

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// Helper: create a simple mock oauthClient
function makeMockOAuthClient(overrides = {}) {
  return {
    chatCompletion: async (messages, options) => {
      options.onChunk?.('mock chunk');
      return { text: 'mock summary', usage: null };
    },
    ...overrides,
  };
}

describe('OpenAIOAuthProvider', () => {
  it('應繼承 BaseLLMProvider', () => {
    const provider = new OpenAIOAuthProvider(makeMockOAuthClient(), logger);
    assert.ok(provider instanceof BaseLLMProvider);
  });

  it('model 預設應為 gpt-5-codex-mini', () => {
    const provider = new OpenAIOAuthProvider(makeMockOAuthClient(), logger);
    assert.equal(provider.model, 'gpt-5-codex-mini');
  });

  it('chatCompletion() 應將 messages 和 options 轉發給 oauthClient，並帶入 model', async () => {
    let capturedMessages, capturedOptions;
    const mockClient = {
      chatCompletion: async (messages, options) => {
        capturedMessages = messages;
        capturedOptions = options;
        return { text: 'result', usage: null };
      },
    };

    const provider = new OpenAIOAuthProvider(mockClient, logger);
    const messages = [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hello' },
    ];
    const options = { responseFormat: 'text' };
    await provider.chatCompletion(messages, options);

    assert.deepEqual(capturedMessages, messages);
    assert.equal(capturedOptions.model, 'gpt-5-codex-mini');
    assert.equal(capturedOptions.responseFormat, 'text');
  });

  it('onChunk callback 應正確傳遞', async () => {
    const receivedChunks = [];
    const mockClient = {
      chatCompletion: async (messages, options) => {
        options.onChunk?.('delta1');
        options.onChunk?.('delta2');
        return { text: 'delta1delta2', usage: null };
      },
    };

    const provider = new OpenAIOAuthProvider(mockClient, logger);
    await provider.chatCompletion([], {
      onChunk: (delta) => receivedChunks.push(delta),
    });

    assert.deepEqual(receivedChunks, ['delta1', 'delta2']);
  });

  it('回傳值應包含 text 且 usage 為 null', async () => {
    const provider = new OpenAIOAuthProvider(makeMockOAuthClient(), logger);
    const result = await provider.chatCompletion([{ role: 'user', content: 'hi' }]);
    assert.equal(result.text, 'mock summary');
    assert.equal(result.usage, null);
  });
});

describe('LLMService with openai-oauth', () => {
  it('provider="openai-oauth" 應以 mockOAuthClient 建立成功', () => {
    const svc = new LLMService(
      { provider: 'openai-oauth', oauthClient: makeMockOAuthClient() },
      logger
    );
    assert.ok(svc.provider instanceof OpenAIOAuthProvider);
  });

  it('無 oauthClient 時應拋出錯誤', () => {
    assert.throws(
      () => new LLMService({ provider: 'openai-oauth' }, logger),
      /openai-oauth requires oauthClient/
    );
  });

  it('LLMServiceConfig 應保存 oauthClient', () => {
    const mockClient = makeMockOAuthClient();
    const cfg = new LLMServiceConfig({ provider: 'openai-oauth', oauthClient: mockClient });
    assert.equal(cfg.oauthClient, mockClient);
  });

  it('LLMServiceConfig 無 oauthClient 時預設為 null', () => {
    const cfg = new LLMServiceConfig({ provider: 'openai', apiKey: 'k', model: 'm' });
    assert.equal(cfg.oauthClient, null);
  });

  it('summarize() 應將 content/title 包成正確 messages 並回傳 text', async () => {
    let capturedMessages;
    const mockClient = {
      chatCompletion: async (messages, options) => {
        capturedMessages = messages;
        return { text: 'summarized result', usage: null };
      },
    };

    const svc = new LLMService(
      { provider: 'openai-oauth', oauthClient: mockClient },
      logger
    );

    const result = await svc.summarize('test content', 'Test Title', null, 'item-001');

    // 第一條應為 system message（包含 prompt）
    assert.equal(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages[0].content.length > 0);

    // 第二條應為 user message，包含 title 和 content
    assert.equal(capturedMessages[1].role, 'user');
    assert.ok(capturedMessages[1].content.includes('Test Title'));
    assert.ok(capturedMessages[1].content.includes('test content'));

    assert.equal(result, 'summarized result');
  });
});
