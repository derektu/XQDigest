'use strict';
const path = require('node:path');
const { OAuthClient } = require('../src/llm/openai-oauth-client');

const TOKENS_PATH = path.resolve(__dirname, '../data/oauth_tokens.json');

async function main() {
  const args   = process.argv.slice(2);
  const reuse  = args.includes('--reuse');
  const logout = args.includes('--logout');

  const client = new OAuthClient({ tokensPath: TOKENS_PATH });

  if (logout) {
    await client.logout();
    console.log('✓ Logged out. Token file deleted.');
    return;
  }

  // Step 1: 登入
  if (!reuse) {
    console.log('Opening browser for OpenAI OAuth login...');
    console.log('(Waiting for callback on http://localhost:1455/auth/callback)\n');
    const result = await client.login();
    console.log('✓ Login successful!');
    console.log('  accountId:', result.accountId);
    console.log('  expires  :', new Date(result.expires).toISOString());
    console.log();
  } else {
    const status = client.getStatus();
    if (!status.loggedIn) {
      console.error('No saved token found. Run without --reuse to login first.');
      process.exit(1);
    }
    console.log('✓ Using saved token');
    console.log('  accountId:', status.accountId);
    console.log('  expires  :', new Date(status.expires).toISOString());
    console.log();
  }

  // Step 2: 呼叫 API
  console.log('Calling chatCompletion()...');
  const messages = [
    { role: 'system', content: 'You are a helpful assistant. Reply in one sentence.' },
    { role: 'user',   content: 'What is 1 + 1?' },
  ];

  process.stdout.write('Response: ');
  const result = await client.chatCompletion(messages, {
    onChunk: (delta) => process.stdout.write(delta),
  });
  console.log('\n');
  console.log('✓ chatCompletion() returned:', JSON.stringify({ text: result.text, usage: result.usage }));
}

main().catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
