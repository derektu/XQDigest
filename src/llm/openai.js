const OpenAI = require('openai');
const BaseLLMProvider = require('./base');
const { LLMProviderConfig } = require('./base');

class OpenAIProvider extends BaseLLMProvider {
  constructor(config, logger) {
    const cfg = config instanceof LLMProviderConfig ? config : new LLMProviderConfig(config);
    super(cfg, logger);
    const options = { apiKey: cfg.apiKey };
    if (cfg.baseUrl) {
      options.baseURL = cfg.baseUrl;
    }
    this.client = new OpenAI(options);
    this.systemPrompt = cfg.systemPrompt;
  }

  async chatCompletion(messages, options = {}) {
    // Only prepend provider-level systemPrompt if caller didn't include a system message
    const hasSystemMessage = messages.some(m => m.role === 'system');
    const allMessages = [];
    if (this.systemPrompt && !hasSystemMessage) {
      allMessages.push({ role: 'system', content: this.systemPrompt });
    }
    allMessages.push(...messages);

    const requestOptions = {
      model: this.model,
      messages: allMessages,
    };

    const isGpt5Family = typeof this.model === 'string' && this.model.startsWith('gpt-5');
    if (isGpt5Family) {
      // GPT-5 family uses max_completion_tokens in Chat Completions API
      requestOptions.max_completion_tokens = this.maxTokens;
      // Some GPT-5 variants may not accept temperature in Chat Completions
    } else {
      requestOptions.max_tokens = this.maxTokens;
      requestOptions.temperature = this.temperature;
    }

    if (options.responseFormat === 'json') {
      requestOptions.response_format = { type: 'json_object' };
    }

    const stream = await this.client.chat.completions.create({
      ...requestOptions,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = '';
    let usage = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        options.onChunk?.(delta);
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };
      }
    }
    return { text, usage };
  }
}

module.exports = OpenAIProvider;
