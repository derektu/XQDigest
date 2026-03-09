'use strict';

const SUMMARY_LENGTH_SPECS = {
  short: {
    guidance: '撰寫精簡摘要，點出核心論點及一個重要佐證。',
    formatting: '使用 1-2 個短段落（單一段落亦可）。全文約 2-5 句。',
    targetCharacters: 900,
    minCharacters: 600,
    maxCharacters: 1200,
    maxTokens: 2048,
  },
  medium: {
    guidance: '撰寫清晰摘要，涵蓋核心論點及最重要的佐證或數據。',
    formatting: '使用 1-3 個短段落（2 段為典型，內容簡單時單段亦可）。每段約 2-3 句。',
    targetCharacters: 1800,
    minCharacters: 1200,
    maxCharacters: 2500,
    maxTokens: 4096,
  },
  long: {
    guidance: '撰寫詳細摘要，依重要性排序：最重要的觀點優先，其次是關鍵佐證或事件，最後是次要細節或原文結論。',
    formatting: '段落為選用；最多 3 個短段落。分段時每段約 2-4 句。',
    targetCharacters: 4200,
    minCharacters: 2500,
    maxCharacters: 6000,
    maxTokens: 10240,
  },
  xl: {
    guidance: '撰寫詳盡摘要，涵蓋主要論點、佐證事實，以及原文中出現的具體數字或引述。',
    formatting: '使用 2-5 個短段落。每段約 2-4 句。',
    targetCharacters: 6000,
    minCharacters: 4000,
    maxCharacters: 9000,
    maxTokens: 10240,
  },
};

/**
 * Pick summary length based on input content character count.
 * @param {string} content
 * @returns {'short'|'medium'|'long'|'xl'}
 */
function pickLengthForContent(content) {
  const len = (content || '').length;
  if (len < 2000) return 'short';
  if (len < 8000) return 'medium';
  if (len < 20000) return 'long';
  return 'xl';
}

class SummarizePromptBuilder {
  /**
   * @param {Object} opts
   * @param {'auto'|'short'|'medium'|'long'|'xl'} [opts.outputLevel='auto']
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
      ? '你是專業財經摘要助理。摘要 YouTube 財經內容給繁體中文讀者。'
      : '你是專業財經摘要助理。摘要財經文章給繁體中文讀者。';

    const sponsorInstruction = this.sourceType === 'youtube'
      ? '忽略所有贊助訊息、廣告、置入性行銷及行動呼籲（包括口播廣告）。不要提及或承認其存在，視同不存在。'
      : null;

    const headingInstruction = length === 'xl'
      ? '使用 Markdown「## 」標題分節。標題數量控制在 3-6 個，以第一個標題開頭。標題請勿使用粗體。'
      : null;

    const formatCount = (n) => n.toLocaleString();
    const lengthGuidance = `目標字數：約 ${formatCount(spec.targetCharacters)} 字（可接受範圍 ${formatCount(spec.minCharacters)}-${formatCount(spec.maxCharacters)} 字）。此為參考值，以清晰表達為優先。`;

    const lines = [
      roleDefinition,
      '',
      '硬性規則：不提及廣告或贊助商，不臆測或推斷內容以外的資訊，只使用直引號。不在摘要中提及素材類型（如「逐字稿」、「字幕」、「文章」等）。',
      sponsorInstruction,
      spec.guidance,
      spec.formatting,
      headingInstruction,
      '請用繁體中文輸出。英文專有名詞、人名、機構名稱請翻譯為中文，必要時可在首次出現時括號附註英文原文。金額請轉換為中文表達方式（如「150 億美元」而非「$15 billion」）。',
      '以 Markdown 格式直接輸出內容，禁止用程式碼區塊（``` 反引號）包裹整個回答。',
      '段落宜短；適當使用條列式提高可讀性，但避免死板的固定模板。',
      '不使用表情符號、免責聲明或臆測。',
      '以直述、客觀的語氣撰寫。',
      '嚴格根據所提供的內容，不捏造細節。',
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
