// XQDigest 預設配置值
// 使用者可透過 settings.json 覆寫這些值

module.exports = {
  app: {
    logLevel: 'info',      // 'debug' | 'info' | 'warn' | 'error'
    dataPath: './data',    // 相對於專案根目錄
    apiPort: 3579,         // HTTP server port
  },
  download: {
    concurrentLimit: 3,    // 最大同時下載數
    retryAttempts: 3,      // 重試次數
    retryDelay: 1000,      // 重試間隔（ms）
    timeoutMs: 30000,      // 下載 timeout（ms）
  },
  llm: {
    retryAttempts: 3,      // LLM 呼叫重試次數
    retryDelay: 5000,      // LLM 重試間隔（ms）
    requestsPerMinute: 0,  // LLM rate limit（0 = 無限制）
  },
};
