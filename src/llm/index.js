const OpenAIProvider = require('./openai');

function _stripMarkdownFence(text) {
  return text.replace(/^```(?:markdown)?\n([\s\S]*?)\n```\s*$/, '$1').trim();
}
const GeminiProvider = require('./gemini');
const Logger = require('../logger');
const { SummarizePromptBuilder } = require('./prompts');

class LLMServiceConfig {
  constructor({ provider, apiKey, model, maxTokens = 1000, temperature = 0.7, baseUrl, systemPrompt = '', summarizationPrompt, oauthClient, outputLevel = 'auto' } = {}) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.baseUrl = baseUrl;
    this.systemPrompt = systemPrompt;
    this.summarizationPrompt = summarizationPrompt;
    this.oauthClient = oauthClient || null;
    this.outputLevel = outputLevel;
  }
}

class LLMService {
  constructor(config, logger, llmLogger) {
    const cfg = config instanceof LLMServiceConfig ? config : new LLMServiceConfig(config);
    this.logger = logger || Logger.getLogger('LLMService');
    this.llmLogger = llmLogger || null;
    this.providerName = cfg.provider;
    this.provider = this._createProvider(cfg, this.logger);
    this.defaultPrompt = cfg.summarizationPrompt || null;
    this.outputLevel = cfg.outputLevel || 'auto';
    this.maxTokens = cfg.maxTokens;
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
        return new OpenAIOAuthProvider(config.oauthClient, logger, config.model);
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
   * @param {string} [sourceType] - 'youtube' | 'rss' | other (used for auto prompt selection)
   * @returns {Promise<string>} Raw LLM response text
   */
  async summarize(content, title, customPrompt, itemId, sourceType) {
    const effectiveCustomPrompt = customPrompt || this.defaultPrompt;
    let systemPrompt, maxTokens;
    if (effectiveCustomPrompt) {
      systemPrompt = effectiveCustomPrompt;
      maxTokens = this.maxTokens;
    } else {
      const builder = new SummarizePromptBuilder({
        outputLevel: this.outputLevel,
        sourceType,
      });
      ({ systemPrompt, maxTokens } = builder.build(content, title));
    }
    const userMessage = `以下是「${title}」的內容：\n\n${content}`;

    this.logger.debug(`Calling LLM for summary: ${title}`);
    const startTime = Date.now();
    try {
      const response = await this.provider.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        { maxTokens }
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
      return _stripMarkdownFence(response.text);
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
    this.defaultPrompt = cfg.summarizationPrompt || null;
    this.outputLevel = cfg.outputLevel || 'auto';
    this.maxTokens = cfg.maxTokens;
  }
}

module.exports = LLMService;
module.exports.LLMServiceConfig = LLMServiceConfig;
