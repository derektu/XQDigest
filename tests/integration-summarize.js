'use strict';
/**
 * Summarize Integration Tests
 *
 * End-to-end: fetch real YouTube transcript → run through new prompt logic → call LLM → print result.
 *
 * 執行方式（不納入 npm test 自動掃描）：
 *   OPENAI_API_KEY=sk-xxx node --test tests/integration-summarize.js
 *   MODEL=gpt-4o OPENAI_API_KEY=sk-xxx node --test tests/integration-summarize.js
 *   MODEL=gemini-2.0-flash GEMINI_API_KEY=xxx node --test tests/integration-summarize.js
 *
 * Ollama (OpenAI-compatible) 範例：
 *   OPENAI_COMPATIBLE_URL=http://localhost:11434/v1 \
 *   OPENAI_COMPATIBLE_KEY=ollama \
 *   MODEL=qwen2.5:7b \
 *   node --test tests/integration-summarize.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const YouTubeFetcher = require('../src/fetchers/youtube');
const LLMService = require('../src/llm');
const { SummarizePromptBuilder } = require('../src/llm/prompts');

// ── helpers ──────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_COMPATIBLE_URL = process.env.OPENAI_COMPATIBLE_URL;
const OPENAI_COMPATIBLE_KEY = process.env.OPENAI_COMPATIBLE_KEY;
const MODEL = process.env.MODEL;
const VIDEO_ID = process.env.VIDEO_ID || 'eh8bcBIAAFo';

function getLLMConfig() {
  if (OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: OPENAI_API_KEY, model: MODEL || 'gpt-4o-mini', maxTokens: 2000 };
  }
  if (GEMINI_API_KEY) {
    return { provider: 'gemini', apiKey: GEMINI_API_KEY, model: MODEL || 'gemini-2.0-flash', maxTokens: 2000 };
  }
  if (OPENAI_COMPATIBLE_URL) {
    return { provider: 'openai-compatible', apiKey: OPENAI_COMPATIBLE_KEY || 'ollama', baseUrl: OPENAI_COMPATIBLE_URL, model: MODEL || 'gpt-3.5-turbo', maxTokens: 2000 };
  }
  return null;
}

function isNetworkError(err) {
  return (
    err.code === 'ENOENT' ||
    err.code === 'ENOTFOUND' ||
    err.message?.includes('network') ||
    err.message?.includes('timed out') ||
    err.message?.includes('No such file')
  );
}

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── tests ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SummarizePromptBuilder outputLevel 各等級比較（同一 input: eh8bcBIAAFo）
// ─────────────────────────────────────────────────────────────────────────────

describe(`Integration: SummarizePromptBuilder — 各 outputLevel 比較（同一 input: ${VIDEO_ID}）`, () => {
  let sharedTranscript = null;
  let sharedLLMConfig = null;
  let skipReason = null;

  before(async () => {
    sharedLLMConfig = getLLMConfig();
    if (!sharedLLMConfig) {
      skipReason = '未設定 OPENAI_API_KEY、GEMINI_API_KEY 或 OPENAI_COMPATIBLE_URL';
      return;
    }

    const fetcher = new YouTubeFetcher();
    try {
      sharedTranscript = await fetcher.fetchTranscript(VIDEO_ID);
    } catch (err) {
      if (isNetworkError(err)) {
        skipReason = '網路不可用';
        return;
      }
      throw err;
    }

    if (!sharedTranscript || sharedTranscript.trim().length === 0) {
      skipReason = '逐字稿為空';
      return;
    }

    console.log(`[OutputLevel] ${VIDEO_ID} 逐字稿長度: ${sharedTranscript.length} chars`);
    console.log(`[OutputLevel] 使用 provider: ${sharedLLMConfig.provider}, model: ${sharedLLMConfig.model}`);
  });

  async function runLevel(outputLevel) {
    if (skipReason) {
      console.log(`[SKIP] ${skipReason}，跳過 ${outputLevel}`);
      return;
    }

    const builder = new SummarizePromptBuilder({ outputLevel, sourceType: 'youtube' });
    const { systemPrompt, maxTokens } = builder.build(sharedTranscript, VIDEO_ID);

    const llm = new LLMService(sharedLLMConfig, logger);
    const userMessage = `以下是「${VIDEO_ID}」的內容：\n\n${sharedTranscript}`;

    const response = await llm.provider.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { maxTokens }
    );

    const summary = response.text;
    assert.ok(typeof summary === 'string' && summary.trim().length > 0, '應回傳非空摘要');
    console.log(`\n=== ${outputLevel.toUpperCase()} 摘要結果（${summary.length} chars）===\n`);
    console.log(summary);
    console.log('\n===================\n');
    return summary;
  }

  it('L01 short level — 應產生精簡摘要（~900 chars）', async () => {
    await runLevel('short');
  });

  it('L02 medium level — 應產生中等摘要（~1800 chars）', async () => {
    await runLevel('medium');
  });

  it('L03 long level — 應產生詳細摘要（~4200 chars）', async () => {
    await runLevel('long');
  });

  it('L04 xl level — 應產生完整分節摘要（含 ## 標題，~9000 chars）', async () => {
    const summary = await runLevel('xl');
    if (summary) {
      assert.ok(summary.includes('## '), 'xl 摘要應包含 ## 標題');
    }
  });

  /*
  it('L05 auto level — 應產生摘要', async () => {
    await runLevel('auto');
  });
  */

});
