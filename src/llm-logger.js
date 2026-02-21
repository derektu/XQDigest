const Logger = require('./logger');

/**
 * LLM 呼叫日誌，使用與主 logger 相同的架構（daily rotation）。
 * 寫入 logs/llm.log，格式為可讀文字，含 token 計數。
 */
class LLMLogger {
  constructor(logDir) {
    this._logger = new Logger({ logDir, logFile: 'llm.log', category: 'LLM' });
  }

  /**
   * 記錄一次 LLM 呼叫
   * @param {Object} params
   * @param {string} params.itemId
   * @param {string} params.provider
   * @param {string} params.model
   * @param {number|null} [params.promptTokens]
   * @param {number|null} [params.completionTokens]
   * @param {number} params.durationMs
   * @param {'success'|'error'} params.status
   * @param {string} [params.error]
   */
  log({ itemId, provider, model, promptTokens, completionTokens, durationMs, status, error }) {
    const parts = [
      `itemId=${itemId}`,
      `provider=${provider}`,
      `model=${model}`,
    ];
    if (promptTokens != null) parts.push(`in=${promptTokens}`);
    if (completionTokens != null) parts.push(`out=${completionTokens}`);
    parts.push(`ms=${durationMs}`);
    parts.push(`status=${status}`);
    if (error) parts.push(`error=${error}`);

    const msg = parts.join(' ');
    if (status === 'success') {
      this._logger.info(msg);
    } else {
      this._logger.error(msg);
    }
  }

  close() {
    return this._logger.close();
  }
}

module.exports = LLMLogger;
