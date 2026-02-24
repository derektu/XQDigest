'use strict';
const path = require('node:path');
const { OAuthClient } = require('../src/llm/openai-oauth-client');
const LLMService = require('../src/llm');

const TOKENS_PATH = path.resolve(__dirname, '../data/oauth_tokens.json');

const TEST_CONTENT = `
[00:00] Host: Welcome to today's show. We'll discuss the Fed's interest rate decision.
[00:30] The Federal Reserve kept rates unchanged at 5.25-5.5%.
[01:00] Analysts expect no cuts until at least Q2 2025.
[01:30] Markets reacted positively, S&P 500 up 0.8%.
`;
const TEST_TITLE = 'Fed Rate Decision Discussion';

async function main() {
  // Step 1: 建立 OAuthClient（使用已存的 token）
  const oauthClient = new OAuthClient({ tokensPath: TOKENS_PATH });
  const status = oauthClient.getStatus();
  if (!status.loggedIn) {
    console.error('✗ Not logged in. Please run smoke-test-oauth.js first.');
    process.exit(1);
  }
  console.log('✓ OAuthClient ready');
  console.log('  accountId:', status.accountId);
  console.log('  expires  :', new Date(status.expires).toISOString());
  console.log();

  // Step 2: 建立 LLMService with openai-oauth provider
  const llmService = new LLMService({ provider: 'openai-oauth', oauthClient });

  // Step 3: 呼叫 summarize()
  console.log('Calling LLMService.summarize()...');
  process.stdout.write('Streaming: ');

  const summary = await llmService.summarize(TEST_CONTENT, TEST_TITLE, null, 'smoke-test');
  console.log('\n');
  console.log(`✓ Summary (${summary.length} chars):`);
  console.log(summary);
}

main().catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
