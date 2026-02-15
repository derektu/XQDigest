const Logger = require('../logger');

class LLMProviderConfig {
  constructor({ model, maxTokens = 1000, temperature = 0.7, apiKey, baseUrl, systemPrompt = '' } = {}) {
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.systemPrompt = systemPrompt;
  }
}

class BaseLLMProvider {
  constructor(config, logger) {
    const cfg = config instanceof LLMProviderConfig ? config : new LLMProviderConfig(config);
    this.logger = logger || Logger.getLogger('LLMProvider');
    this.model = cfg.model;
    this.maxTokens = cfg.maxTokens;
    this.temperature = cfg.temperature;
  }

  /**
   * Generic chat completion API - subclasses must implement.
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} [options]
   * @param {string} [options.responseFormat] - 'json' | 'text' (default: 'text')
   * @returns {Promise<string>} Completion text
   */
  async chatCompletion(messages, options = {}) {
    throw new Error('chatCompletion() must be implemented by subclass');
  }

  /**
   * Safely parse JSON response text.
   * @param {string} text - Raw response text
   * @returns {Object} Parsed JSON or { raw: text } on failure
   */
  _parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      this.logger.warn(`JSON parse failed, returning raw text: ${err.message}`);
      return { raw: text };
    }
  }
}

module.exports = BaseLLMProvider;
module.exports.LLMProviderConfig = LLMProviderConfig;
