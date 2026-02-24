/**
 * LLM Provider 實際 API 測試
 *
 * 需要設定環境變數才能執行：
 *   OPENAI_API_KEY          - OpenAI API key
 *   OPENAI_COMPATIBLE_URL   - OpenAI-compatible API base URL
 *   OPENAI_COMPATIBLE_KEY   - OpenAI-compatible API key
 *   GEMINI_API_KEY          - Google Gemini API key
 *   MODEL                   - 共用 model 名稱（所有 provider）
 *
 * 執行方式：
 *   OPENAI_API_KEY=sk-... node --test tests/test-llm-providers.js
 *   GEMINI_API_KEY=... node --test tests/test-llm-providers.js
 *
 * Ollama (OpenAI-compatible) 範例：
 *   OPENAI_COMPATIBLE_URL=http://localhost:11434/v1 \
 *   OPENAI_COMPATIBLE_KEY=ollama \
 *   MODEL=qwen2.5:7b \
 *   node --test tests/test-llm-providers.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const OpenAIProvider = require('../src/llm/openai');
const GeminiProvider = require('../src/llm/gemini');

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_COMPATIBLE_URL = process.env.OPENAI_COMPATIBLE_URL;
const OPENAI_COMPATIBLE_KEY = process.env.OPENAI_COMPATIBLE_KEY;
const MODEL = process.env.MODEL;

describe('OpenAIProvider (需要 OPENAI_API_KEY)', () => {
  it('chatCompletion() 應回傳文字回應', async () => {
    if (!OPENAI_API_KEY) return; // 無 API key 時跳過

    const provider = new OpenAIProvider({
      apiKey: OPENAI_API_KEY,
      model: MODEL || 'gpt-4o-mini',
      systemPrompt: '你是助手，請簡短回答。',
    }, logger);

    const response = await provider.chatCompletion([
      { role: 'user', content: '請用一句話說明什麼是 Node.js' },
    ]);

    assert.ok(response.text.length > 0, '回應不應為空');
  });

  it('chatCompletion() JSON mode 應回傳可解析的 JSON', async () => {
    if (!OPENAI_API_KEY) return;

    const provider = new OpenAIProvider({
      apiKey: OPENAI_API_KEY,
      model: MODEL || 'gpt-4o-mini',
      systemPrompt: '請以 JSON 格式回應。',
    }, logger);

    const response = await provider.chatCompletion([
      { role: 'user', content: '請回傳 JSON 格式: {"language": "JavaScript", "runtime": "Node.js"}' },
    ], { responseFormat: 'json' });

    const json = JSON.parse(response.text);
    assert.ok(json.language || json.runtime, 'JSON 應包含預期欄位');
  });
});

describe('OpenAI-Compatible Provider (需要 OPENAI_COMPATIBLE_URL)', () => {
  it('chatCompletion() 應能透過自訂 baseUrl 回應', async () => {
    if (!OPENAI_COMPATIBLE_URL) return;

    const provider = new OpenAIProvider({
      apiKey: OPENAI_COMPATIBLE_KEY || 'ollama',
      baseUrl: OPENAI_COMPATIBLE_URL,
      model: MODEL || 'gpt-3.5-turbo',
      systemPrompt: '',
    }, logger);

    const response = await provider.chatCompletion([
      { role: 'user', content: 'Hello, respond with one word.' },
    ]);

    assert.ok(response.text.length > 0, '回應不應為空');
  });
});

describe('GeminiProvider (需要 GEMINI_API_KEY)', () => {
  it('chatCompletion() 應回傳文字回應', async () => {
    if (!GEMINI_API_KEY) return;

    const provider = new GeminiProvider({
      apiKey: GEMINI_API_KEY,
      model: MODEL || 'gemini-2.5-flash',
      systemPrompt: '你是助手，請簡短回答。',
    }, logger);

    const response = await provider.chatCompletion([
      { role: 'user', content: '請用一句話說明什麼是 JavaScript' },
    ]);

    assert.ok(response.text.length > 0, '回應不應為空');
  });

  it('chatCompletion() JSON mode 應回傳可解析的 JSON', async () => {
    if (!GEMINI_API_KEY) return;

    const provider = new GeminiProvider({
      apiKey: GEMINI_API_KEY,
      model: MODEL || 'gemini-2.5-flash',
      systemPrompt: '請以 JSON 格式回應。',
    }, logger);

    const response = await provider.chatCompletion([
      { role: 'user', content: '請回傳 JSON: {"framework": "Express", "type": "web"}' },
    ], { responseFormat: 'json' });

    const json = JSON.parse(response.text);
    assert.ok(json.framework || json.type, 'JSON 應包含預期欄位');
  });
});
