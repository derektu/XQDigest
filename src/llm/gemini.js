const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseLLMProvider = require('./base');
const { LLMProviderConfig } = require('./base');

class GeminiProvider extends BaseLLMProvider {
  constructor(config, logger) {
    const cfg = config instanceof LLMProviderConfig ? config : new LLMProviderConfig(config);
    super(cfg, logger);
    this.genAI = new GoogleGenerativeAI(cfg.apiKey);
    this.systemPrompt = cfg.systemPrompt;
  }

  async chatCompletion(messages, options = {}) {
    const generationConfig = {
      maxOutputTokens: this.maxTokens,
      temperature: this.temperature,
    };

    if (options.responseFormat === 'json') {
      generationConfig.responseMimeType = 'application/json';
    }

    // Extract system messages; use caller-provided system message if present,
    // otherwise fall back to provider-level systemPrompt
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const systemInstruction = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n')
      : this.systemPrompt;

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig,
    });

    // Convert messages to Gemini format (role mapping: assistant → model)
    const contents = nonSystemMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const result = await model.generateContentStream({ contents });

    let text = '';
    let usage = null;

    for await (const chunk of result.stream) {
      const delta = chunk.text();
      if (delta) {
        text += delta;
        options.onChunk?.(delta);
      }
    }

    const response = await result.response;
    const meta = response.usageMetadata;
    if (meta) {
      usage = {
        promptTokens: meta.promptTokenCount,
        completionTokens: meta.candidatesTokenCount,
      };
    }
    return { text, usage };
  }
}

module.exports = GeminiProvider;
