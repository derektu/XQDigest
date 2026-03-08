'use strict';

const SUMMARY_LENGTH_SPECS = {
  short: {
    guidance: 'Write a tight summary that delivers the primary claim plus one high-signal supporting detail.',
    formatting: 'Use 1-2 short paragraphs (a single paragraph is fine). Aim for 2-5 sentences total.',
    targetCharacters: 900,
    minCharacters: 600,
    maxCharacters: 1200,
    maxTokens: 768,
  },
  medium: {
    guidance: 'Write a clear summary that covers the core claim plus the most important supporting evidence or data points.',
    formatting: 'Use 1-3 short paragraphs (2 is typical, but a single paragraph is okay if the content is simple). Aim for 2-3 sentences per paragraph.',
    targetCharacters: 1800,
    minCharacters: 1200,
    maxCharacters: 2500,
    maxTokens: 1536,
  },
  long: {
    guidance: 'Write a detailed summary that prioritizes the most important points first, followed by key supporting facts or events, then secondary details or conclusions stated in the source.',
    formatting: 'Paragraphs are optional; use up to 3 short paragraphs. Aim for 2-4 sentences per paragraph when you split into paragraphs.',
    targetCharacters: 4200,
    minCharacters: 2500,
    maxCharacters: 6000,
    maxTokens: 3072,
  },
  xl: {
    guidance: 'Write a detailed summary that captures the main points, supporting facts, and concrete numbers or quotes when present.',
    formatting: 'Use 2-5 short paragraphs. Aim for 2-4 sentences per paragraph.',
    targetCharacters: 9000,
    minCharacters: 6000,
    maxCharacters: 14000,
    maxTokens: 6144,
  },
  xxl: {
    guidance: 'Write a comprehensive summary that covers background, main points, evidence, and stated outcomes in the source text; avoid adding implications or recommendations unless explicitly stated.',
    formatting: 'Use 3-7 short paragraphs. Aim for 2-4 sentences per paragraph.',
    targetCharacters: 17000,
    minCharacters: 14000,
    maxCharacters: 22000,
    maxTokens: 12288,
  },
};

/**
 * Pick summary length based on input content character count.
 * @param {string} content
 * @returns {'short'|'medium'|'long'|'xl'|'xxl'}
 */
function pickLengthForContent(content) {
  const len = (content || '').length;
  if (len < 2000) return 'short';
  if (len < 8000) return 'medium';
  if (len < 20000) return 'long';
  if (len < 50000) return 'xl';
  return 'xxl';
}

class SummarizePromptBuilder {
  /**
   * @param {Object} opts
   * @param {'auto'|'short'|'medium'|'long'|'xl'|'xxl'} [opts.outputLevel='auto']
   * @param {'youtube'|'rss'|string} [opts.sourceType='rss']
   */
  constructor({ outputLevel = 'auto', sourceType = 'rss' } = {}) {
    if (outputLevel !== 'auto' && !SUMMARY_LENGTH_SPECS[outputLevel]) {
      throw new Error(`Unknown outputLevel: ${outputLevel}`);
    }
    this.outputLevel = outputLevel;
    this.sourceType = sourceType;
  }

  /**
   * Build the system prompt for summarization.
   * @param {string} content
   * @param {string} [title]
   * @returns {{ systemPrompt: string, maxTokens: number, length: string }}
   */
  build(content, title) {
    const length = this.outputLevel === 'auto'
      ? pickLengthForContent(content)
      : this.outputLevel;
    const spec = SUMMARY_LENGTH_SPECS[length];

    const roleDefinition = this.sourceType === 'youtube'
      ? '你是專業財經影片摘要助手。請為繁體中文讀者摘要 YouTube 財經影片的內容。'
      : '你是專業財經文章摘要助手。請為繁體中文讀者摘要財經文章的重要資訊。';

    const sponsorInstruction = this.sourceType === 'youtube'
      ? 'Omit sponsor messages, ads, promos, and calls-to-action (including ad reads). Do not mention or acknowledge them. Treat them as if they do not exist.'
      : null;

    // xl: add heading instruction (mirrors reference link-summary.ts)
    const headingInstruction = (length === 'xl' || length === 'xxl')
      ? 'Use Markdown headings with "## " prefix to break sections. Include at least 3 headings and start with a heading. Do not use bold for headings.'
      : null;

    const formatCount = (n) => n.toLocaleString();
    const lengthGuidance = `Target length: around ${formatCount(spec.targetCharacters)} characters (acceptable range ${formatCount(spec.minCharacters)}-${formatCount(spec.maxCharacters)}). This is a soft guideline; prioritize clarity.`;

    const lines = [
      roleDefinition,
      '',
      'Hard rules: 不提及廣告或贊助商，不臆測或推斷內容以外的資訊，只使用直引號。不在摘要中提及素材類型（如「逐字稿」、「字幕」、「文章」等）。',
      sponsorInstruction,
      spec.guidance,
      spec.formatting,
      headingInstruction,
      '請用繁體中文輸出。',
      'Format the answer in Markdown.',
      'Use short paragraphs; use bullet lists only when they improve scanability; avoid rigid templates.',
      'Do not use emojis, disclaimers, or speculation.',
      'Write in direct, factual language.',
      'Base everything strictly on the provided content and never invent details.',
      lengthGuidance,
    ].filter(line => line != null);

    return {
      systemPrompt: lines.join('\n'),
      maxTokens: spec.maxTokens,
      length,
    };
  }
}

/**
 * Build the system prompt and maxTokens for a summarization request.
 * Backward-compatible wrapper around SummarizePromptBuilder.
 * @param {Object} opts
 * @param {string} opts.content - Raw content to summarize
 * @param {string} [opts.title] - Content title (unused in prompt building, reserved)
 * @param {string} [opts.sourceType] - 'youtube' | 'rss' | other
 * @param {string} [opts.customPrompt] - If provided, use as-is (skip auto logic)
 * @returns {{ systemPrompt: string, maxTokens: number }}
 */
function buildSummarizePrompt({ content, title, sourceType, customPrompt } = {}) {
  if (customPrompt) {
    return { systemPrompt: customPrompt, maxTokens: 1536 };
  }
  const builder = new SummarizePromptBuilder({ outputLevel: 'auto', sourceType });
  return builder.build(content, title);
}

module.exports = { SummarizePromptBuilder, buildSummarizePrompt, pickLengthForContent, SUMMARY_LENGTH_SPECS };
