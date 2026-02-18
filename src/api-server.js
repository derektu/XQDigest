const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createRoutes } = require('./api-routes');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class ApiServer extends EventEmitter {
  constructor(engine) {
    super();
    this._engine = engine;
    this._server = null;
    this._routes = createRoutes(engine);
    this._staticDir = path.resolve(__dirname, '../dist-renderer');
  }

  /**
   * Match a URL path against a route pattern (e.g. '/api/datasources/:id').
   * Returns params object or null if no match.
   */
  _matchPattern(pattern, urlPath) {
    const patternParts = pattern.split('/');
    const urlParts = urlPath.split('/');
    if (patternParts.length !== urlParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
      } else if (patternParts[i] !== urlParts[i]) {
        return null;
      }
    }
    return params;
  }

  /**
   * Read request body as JSON.
   */
  _readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        if (!data) return resolve(null);
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Serve a static file from dist-renderer/.
   */
  _serveStatic(res, urlPath) {
    // Sanitize path to prevent directory traversal
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(this._staticDir, safePath);

    // If directory or no extension, serve index.html (SPA fallback)
    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.join(this._staticDir, 'index.html');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        // SPA fallback: serve index.html for any missing file
        const indexPath = path.join(this._staticDir, 'index.html');
        fs.readFile(indexPath, (err2, indexContent) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent);
        });
        return;
      }
      const fileExt = path.extname(filePath);
      const contentType = MIME_TYPES[fileExt] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  }

  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const urlPath = url.pathname;
    const method = req.method.toUpperCase();

    // API routes
    if (urlPath.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      for (const route of this._routes) {
        if (route.method !== method) continue;
        const params = this._matchPattern(route.pattern, urlPath);
        if (!params) continue;

        try {
          const body = await this._readBody(req);
          const result = await route.handler(params, body);
          const status = result.status || 200;
          res.writeHead(status);
          res.end(JSON.stringify(result.data));
        } catch (err) {
          const status = err.statusCode || 500;
          res.writeHead(status);
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // No matching API route
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    // Static files
    this._serveStatic(res, urlPath);
  }

  /**
   * Start the HTTP server.
   * @param {number} port - Port number (0 for OS-assigned random port)
   * @returns {Promise<number>} Actual port the server is listening on
   */
  start(port) {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        this._handleRequest(req, res).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      });

      this._server.on('error', reject);

      this._server.listen(port, '127.0.0.1', () => {
        const actualPort = this._server.address().port;
        this.emit('listening', actualPort);
        resolve(actualPort);
      });
    });
  }

  /**
   * Stop the HTTP server.
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this._server) return resolve();
      this._server.close((err) => {
        this._server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getPort() {
    if (!this._server) return null;
    const addr = this._server.address();
    return addr ? addr.port : null;
  }
}

module.exports = ApiServer;
