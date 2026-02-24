'use strict';
const BaseLLMProvider = require('./base');

class OpenAIOAuthProvider extends BaseLLMProvider {
  constructor(oauthClient, logger) {
    super({ model: 'gpt-5.2', maxTokens: 0, temperature: 0 }, logger);
    this.oauthClient = oauthClient;
  }

  async chatCompletion(messages, options = {}) {
    // messages 轉換（system → instructions, user → input）已在 OAuthClient 內部完成
    return this.oauthClient.chatCompletion(messages, options);
    // 回傳 {text, usage: null}
  }
}

module.exports = { OpenAIOAuthProvider };
