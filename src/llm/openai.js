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

    const effectiveMaxTokens = options.maxTokens ?? this.maxTokens;

    const requestOptions = {
      model: this.model,
      messages: allMessages,
    };

    const isGpt5Family = typeof this.model === 'string' && this.model.startsWith('gpt-5');
    if (isGpt5Family) {
      // GPT-5 reasoning models use max_completion_tokens which includes internal reasoning tokens.
      // Reasoning tokens consume most of the budget, leaving little for visible output.
      // Multiply by 8 (capped at 32768) to ensure sufficient visible output after reasoning overhead.
      requestOptions.max_completion_tokens = Math.min(effectiveMaxTokens * 8, 32768);
    } else {
      requestOptions.max_tokens = effectiveMaxTokens;
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
