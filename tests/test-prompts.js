'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SummarizePromptBuilder, buildSummarizePrompt, pickLengthForContent, SUMMARY_LENGTH_SPECS } = require('../src/llm/prompts');

describe('buildSummarizePrompt', () => {
  it('customPrompt 有值時應直接回傳，不走自動邏輯', () => {
    const { systemPrompt, maxTokens } = buildSummarizePrompt({
      content: 'test',
      sourceType: 'youtube',
      customPrompt: '我的自訂 prompt',
    });
    assert.equal(systemPrompt, '我的自訂 prompt');
    assert.equal(maxTokens, 1536);
  });

  it('短內容（< 2000 chars）應選 short spec', () => {
    const content = 'a'.repeat(100);
    const { maxTokens } = buildSummarizePrompt({ content, sourceType: 'rss' });
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.short.maxTokens);
  });

  it('長內容（>= 20000 chars）應選 xl spec', () => {
    const content = 'a'.repeat(20000);
    const { maxTokens } = buildSummarizePrompt({ content, sourceType: 'rss' });
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.xl.maxTokens);
  });

  it('medium 內容（2000-8000 chars）應選 medium spec', () => {
    const content = 'a'.repeat(5000);
    const { maxTokens } = buildSummarizePrompt({ content, sourceType: 'youtube' });
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.medium.maxTokens);
  });

  it('long 內容（8000-20000 chars）應選 long spec', () => {
    const content = 'a'.repeat(10000);
    const { maxTokens } = buildSummarizePrompt({ content, sourceType: 'youtube' });
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.long.maxTokens);
  });
});

describe('pickLengthForContent', () => {
  it('空字串應回傳 short', () => {
    assert.equal(pickLengthForContent(''), 'short');
  });

  it('< 2000 chars 應回傳 short', () => {
    assert.equal(pickLengthForContent('a'.repeat(1999)), 'short');
  });

  it('2000 chars 應回傳 medium', () => {
    assert.equal(pickLengthForContent('a'.repeat(2000)), 'medium');
  });

  it('8000 chars 應回傳 long', () => {
    assert.equal(pickLengthForContent('a'.repeat(8000)), 'long');
  });

  it('>= 20000 chars 應回傳 xl', () => {
    assert.equal(pickLengthForContent('a'.repeat(20000)), 'xl');
  });
});

describe('SummarizePromptBuilder', () => {
  it('無效 outputLevel 應拋出錯誤', () => {
    assert.throws(
      () => new SummarizePromptBuilder({ outputLevel: 'invalid' }),
      /Unknown outputLevel/
    );
  });

  it('build() 回傳值應包含 systemPrompt, maxTokens, length 三個欄位', () => {
    const builder = new SummarizePromptBuilder({ outputLevel: 'medium', sourceType: 'rss' });
    const result = builder.build('some content');
    assert.ok('systemPrompt' in result, '應有 systemPrompt');
    assert.ok('maxTokens' in result, '應有 maxTokens');
    assert.ok('length' in result, '應有 length');
    assert.equal(result.length, 'medium');
  });

  it('outputLevel=auto 短內容應等同 short spec', () => {
    const builder = new SummarizePromptBuilder({ outputLevel: 'auto', sourceType: 'rss' });
    const { maxTokens, length } = builder.build('a'.repeat(100));
    assert.equal(length, 'short');
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.short.maxTokens);
  });

  it('outputLevel=auto 長內容應等同 xl spec', () => {
    const builder = new SummarizePromptBuilder({ outputLevel: 'auto', sourceType: 'rss' });
    const { maxTokens, length } = builder.build('a'.repeat(20000));
    assert.equal(length, 'xl');
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.xl.maxTokens);
  });

  it('outputLevel 明確指定 short 時，無論 content 長短都應用 short spec', () => {
    const builder = new SummarizePromptBuilder({ outputLevel: 'short', sourceType: 'rss' });
    const { maxTokens, length } = builder.build('a'.repeat(50000));
    assert.equal(length, 'short');
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.short.maxTokens);
  });

  it('outputLevel 明確指定 xl 時，無論 content 長短都應用 xl spec', () => {
    const builder = new SummarizePromptBuilder({ outputLevel: 'xl', sourceType: 'rss' });
    const { maxTokens, length } = builder.build('a'.repeat(100));
    assert.equal(length, 'xl');
    assert.equal(maxTokens, SUMMARY_LENGTH_SPECS.xl.maxTokens);
  });
});
