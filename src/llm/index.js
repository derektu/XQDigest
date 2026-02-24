const OpenAIProvider = require('./openai');
const GeminiProvider = require('./gemini');
const Logger = require('../logger');

const DEFAULT_SUMMARIZE_PROMPT = `你是一個專業的財經內容摘要助手。請用繁體中文總結以下內容的重點。

輸出格式：
第一段：以 2-3 句話概述整體內容。
關鍵要點（3-5 條，每條以「• 」開頭）：列出最重要的資訊、數據或觀點。`;

class LLMServiceConfig {
  constructor({ provider, apiKey, model, maxTokens = 1000, temperature = 0.7, baseUrl, systemPrompt = '', summarizationPrompt, oauthClient } = {}) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.baseUrl = baseUrl;
    this.systemPrompt = systemPrompt;
    this.summarizationPrompt = summarizationPrompt;
    this.oauthClient = oauthClient || null;
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
      case 'openai-oauth': {
        const { OpenAIOAuthProvider } = require('./openai-oauth');
        if (!config.oauthClient) throw new Error('openai-oauth requires oauthClient');
        return new OpenAIOAuthProvider(config.oauthClient, logger);
      }
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
    const systemContent = customPrompt || this.defaultPrompt;
    const userMessage = `以下是「${title}」的內容：\n\n${content}`;

    this.logger.debug(`Calling LLM for summary: ${title}`);
    const startTime = Date.now();
    try {
      const response = await this.provider.chatCompletion(
        [
          { role: 'system', content: systemContent },
          { role: 'user', content: userMessage },
        ],
        {}
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

      this.logger.debug(`LLM summary completed: ${title}`);
      return response.text;
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

  updateConfig(config) {
    const cfg = config instanceof LLMServiceConfig ? config : new LLMServiceConfig(config);
    this.providerName = cfg.provider;
    this.provider = this._createProvider(cfg, this.logger);
    this.defaultPrompt = cfg.summarizationPrompt || DEFAULT_SUMMARIZE_PROMPT;
  }
}

module.exports = LLMService;
module.exports.LLMServiceConfig = LLMServiceConfig;
