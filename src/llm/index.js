const OpenAIProvider = require('./openai');
const GeminiProvider = require('./gemini');
const Logger = require('../logger');

const DEFAULT_SUMMARIZE_PROMPT = '你是一個專業的內容摘要助手。請用繁體中文總結以下內容的重點，並列出 3-5 個關鍵要點。';
const JSON_FORMAT_INSTRUCTION = '\n\n請以 JSON 格式回應，僅包含一個 "summary" 欄位。';

class LLMServiceConfig {
  constructor({ provider, apiKey, model, maxTokens = 1000, temperature = 0.7, baseUrl, systemPrompt = '', summarizationPrompt } = {}) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.baseUrl = baseUrl;
    this.systemPrompt = systemPrompt;
    this.summarizationPrompt = summarizationPrompt;
  }
}

class LLMService {
  constructor(config, logger, llmLogger) {
    const cfg = config instanceof LLMServiceConfig ? config : new LLMServiceConfig(config);
    this.logger = logger || Logger.getLogger('LLMService');
    this.llmLogger = llmLogger || null;
    this.providerName = cfg.provider;
    this.provider = this._createProvider(cfg, this.logger);
    this.defaultPrompt = cfg.summarizationPrompt || DEFAULT_SUMMARIZE_PROMPT;
  }

  _createProvider(config, logger) {
    switch (config.provider) {
      case 'openai':
      case 'openai-compatible':
        return new OpenAIProvider(config, logger);
      case 'gemini':
        return new GeminiProvider(config, logger);
      default:
        throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  }

  /**
   * Generic chat completion - delegates to provider.
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options]
   * @param {string} [options.responseFormat] - 'json' | 'text'
   * @returns {Promise<string>} Raw response text
   */
  async chat(messages, options = {}) {
    const result = await this.provider.chatCompletion(messages, options);
    return result.text;
  }

  /**
   * Application-level summarize API.
   * Returns raw LLM response text (format is determined by prompt).
   * @param {string} content - Content to summarize
   * @param {string} title - Content title
   * @param {string} [customPrompt] - Optional custom system prompt override
   * @param {string} [itemId] - Item ID for LLM logging
   * @returns {Promise<string>} Raw LLM response text
   */
  async summarize(content, title, customPrompt, itemId) {
    const prompt = customPrompt || this.defaultPrompt;
    const useJsonFormat = (prompt === DEFAULT_SUMMARIZE_PROMPT);
    const systemContent = useJsonFormat ? (prompt + JSON_FORMAT_INSTRUCTION) : prompt;
    const userMessage = `以下是「${title}」的內容：\n\n${content}`;

    this.logger.debug(`Calling LLM for summary: ${title}`);
    const startTime = Date.now();
    try {
      const response = await this.provider.chatCompletion(
        [
          { role: 'system', content: systemContent },
          { role: 'user', content: userMessage },
        ],
        useJsonFormat ? { responseFormat: 'json' } : {}
      );

      const durationMs = Date.now() - startTime;
      if (this.llmLogger && itemId) {
        this.llmLogger.log({
          itemId,
          provider: this.providerName,
          model: this.provider.model,
          promptTokens: response.usage?.promptTokens ?? null,
          completionTokens: response.usage?.completionTokens ?? null,
          durationMs,
          status: 'success',
        });
      }

      const text = response.text;
      if (!useJsonFormat) {
        this.logger.debug(`LLM summary completed: ${title}`);
        return text;
      }

      // Built-in default prompt uses JSON wrapper — extract summary field
      const parsed = this._parseJSON(text);
      const extracted = parsed.summary || parsed.raw || text;
      const summaryText = typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2);

      this.logger.debug(`LLM summary completed: ${title}`);
      return summaryText;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (this.llmLogger && itemId) {
        this.llmLogger.log({
          itemId,
          provider: this.providerName,
          model: this.provider.model,
          durationMs,
          status: 'error',
          error: err.message,
        });
      }
      this.logger.error(`LLM summarize failed for "${title}": ${err.message}`);
      throw err;
    }
  }

  _parseJSON(text) {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      this.logger.warn(`JSON parse failed, returning raw text: ${err.message}`);
      return { raw: text };
    }
  }

  updateConfig(config) {
    const cfg = config instanceof LLMServiceConfig ? config : new LLMServiceConfig(config);
    this.providerName = cfg.provider;
    this.provider = this._createProvider(cfg, this.logger);
    this.defaultPrompt = cfg.summarizationPrompt || DEFAULT_SUMMARIZE_PROMPT;
  }
}

module.exports = LLMService;
module.exports.LLMServiceConfig = LLMServiceConfig;
