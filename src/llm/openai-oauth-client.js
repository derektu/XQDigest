'use strict';

const crypto = require('node:crypto');
const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');

const CLIENT_ID        = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL         = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL        = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI     = 'http://localhost:1455/auth/callback';
const SCOPES           = 'openid profile email offline_access';
const API_URL          = 'https://chatgpt.com/backend-api/codex/responses';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MODEL    = 'gpt-5.2';

class OAuthClient {
  constructor(options = {}) {
    if (options.storage) {
      this._storage = options.storage;
    } else {
      const tokensPath = options.tokensPath
        || path.join(
             process.env.XQDIGEST_DATA_PATH || path.resolve(__dirname, '../../data'),
             'oauth_tokens.json'
           );
      this._storage = {
        load: () => {
          if (!fs.existsSync(tokensPath)) return null;
          try {
            return JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
          } catch {
            return null;
          }
        },
        save: (t) => {
          fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
          fs.writeFileSync(tokensPath, JSON.stringify(t, null, 2));
        },
        delete: () => {
          try {
            fs.unlinkSync(tokensPath);
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
          }
        },
      };
    }
    this._openBrowser = options.openBrowser || null;
  }

  // PKCE: returns { verifier, challenge }
  async _generatePKCE() {
    const verifierBytes = crypto.randomBytes(32);
    const verifier = verifierBytes.toString('base64url');

    const challengeBuffer = await crypto.webcrypto.subtle.digest(
      'SHA-256',
      Buffer.from(verifier)
    );
    const challenge = Buffer.from(challengeBuffer).toString('base64url');

    return { verifier, challenge };
  }

  _decodeJwtPayload(jwt) {
    const parts = jwt.split('.');
    if (parts.length < 2) throw new Error('Invalid JWT');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  }

  async _exchangeCode(code, verifier) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${text}`);
    }

    return response.json();
  }

  async _refreshTokens(tokens) {
    if (!tokens?.refresh) throw new Error('No refresh token available. Please login again.');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh,
      client_id: CLIENT_ID,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }

    const tokenData = await response.json();
    const payload = this._decodeJwtPayload(tokenData.access_token);
    const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id
                   ?? tokens.accountId;

    return {
      access:    tokenData.access_token,
      refresh:   tokenData.refresh_token ?? tokens.refresh,
      expires:   Date.now() + tokenData.expires_in * 1000,
      accountId,
    };
  }

  async _openUrl(url) {
    if (this._openBrowser) return this._openBrowser(url);
    const { default: open } = await import('open');
    await open(url);
  }

  async login() {
    const { verifier, challenge } = await this._generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'pi',
    });

    const authUrl = `${AUTH_URL}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      let server;
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Login timed out after 60 seconds'));
      }, LOGIN_TIMEOUT_MS);

      server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, 'http://localhost:1455');
        if (reqUrl.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code          = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');
        const error         = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Login failed: ${error}</h1><p>You can close this window.</p>`);
          clearTimeout(timeout);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Missing code</h1><p>You can close this window.</p>');
          clearTimeout(timeout);
          server.close();
          reject(new Error('No code in callback'));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>State mismatch</h1><p>You can close this window.</p>');
          clearTimeout(timeout);
          server.close();
          reject(new Error('State mismatch — possible CSRF'));
          return;
        }

        try {
          const tokenData = await this._exchangeCode(code, verifier);
          const payload   = this._decodeJwtPayload(tokenData.access_token);
          const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id ?? '';

          const tokens = {
            access:    tokenData.access_token,
            refresh:   tokenData.refresh_token,
            expires:   Date.now() + tokenData.expires_in * 1000,
            accountId,
          };

          this._storage.save(tokens);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Login successful!</h1><p>You can close this window and return to the app.</p>');

          clearTimeout(timeout);
          server.close();
          resolve({ accountId: tokens.accountId, expires: tokens.expires });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${err.message}</p>`);
          clearTimeout(timeout);
          server.close();
          reject(err);
        }
      });

      server.on('error', (err) => {
        clearTimeout(timeout);
        if (err.code === 'EADDRINUSE') {
          reject(new Error('Port 1455 is already in use. Please close the other application.'));
        } else {
          reject(err);
        }
      });

      server.listen(1455, '127.0.0.1', () => {
        this._openUrl(authUrl).catch(reject);
      });
    });
  }

  async logout() {
    this._storage.delete();
  }

  async getValidToken() {
    const tokens = this._storage.load();
    if (!tokens) throw new Error('Not logged in. Please call login() first.');
    if (Date.now() < tokens.expires - EXPIRY_BUFFER_MS) return tokens.access;
    const fresh = await this._refreshTokens(tokens);
    this._storage.save(fresh);
    return fresh.access;
  }

  getStatus() {
    const tokens = this._storage.load();
    if (!tokens) return { loggedIn: false };
    return {
      loggedIn:  true,
      accountId: tokens.accountId,
      expires:   tokens.expires,
    };
  }

  async chatCompletion(messages, options = {}) {
    const accessToken = await this.getValidToken();
    const payload     = this._decodeJwtPayload(accessToken);
    const accountId   = payload['https://api.openai.com/auth']?.chatgpt_account_id ?? '';

    // Convert Chat Completions messages → Responses API format
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages  = messages.filter(m => m.role !== 'system');

    const instructions = systemMessages.map(m => m.content).join('\n') || undefined;
    const input = otherMessages.map(m => ({ role: m.role, content: m.content }));

    const body = {
      model:  options.model || DEFAULT_MODEL,
      input,
      stream: true,
      store:  false,
    };
    if (instructions) body.instructions = instructions;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization':      `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'Content-Type':       'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed: ${response.status} ${text}`);
    }

    // Parse SSE stream
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'response.output_text.delta') {
            const delta = event.delta ?? '';
            text += delta;
            options.onChunk?.(delta);
          }
          // response.done signals end of stream
        } catch {
          // ignore malformed lines
        }
      }
    }

    return { text, usage: null };
  }
}

module.exports = { OAuthClient };
