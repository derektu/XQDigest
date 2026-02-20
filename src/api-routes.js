const YouTubeFetcher = require('./fetchers/youtube');
const RSSFetcher = require('./fetchers/rss');
const OpenAI = require('openai');

/**
 * Build route table for the API server.
 * Each handler receives (params, body) and returns { status?, data }.
 * Engine must be passed in; handlers throw 503 when engine is not running.
 */
function createRoutes(engine) {
  function requireRunning() {
    if (engine.getState() !== 'running') {
      const err = new Error('Engine not running');
      err.statusCode = 503;
      throw err;
    }
  }

  function getMgr() {
    requireRunning();
    const mgr = engine.getDataSourceManager();
    if (!mgr) {
      const err = new Error('Engine not running');
      err.statusCode = 503;
      throw err;
    }
    return mgr;
  }

  function getScheduler() {
    requireRunning();
    const scheduler = engine.getScheduler();
    if (!scheduler) {
      const err = new Error('Engine not running');
      err.statusCode = 503;
      throw err;
    }
    return scheduler;
  }

  function getDB() {
    const db = engine.getDB();
    if (!db) {
      const err = new Error('Engine not running');
      err.statusCode = 503;
      throw err;
    }
    return db;
  }

  return [
    // Literal routes BEFORE parametric routes
    {
      method: 'GET',
      pattern: '/api/content/unread-counts',
      handler: () => {
        const db = engine.getDB();
        if (!db) return { data: { all: 0, bySource: {} } };
        return { data: db.getUnreadCounts() };
      },
    },
    {
      method: 'GET',
      pattern: '/api/content',
      handler: (params) => {
        const db = engine.getDB();
        if (!db) return { data: [] };
        const sourceId = params.sourceId || undefined;
        const limit = Math.min(parseInt(params.limit) || 20, 100);
        const offset = parseInt(params.offset) || 0;
        const items = db.getContentItems({ status: 'processed', sourceId, limit, offset });
        return {
          data: items.map(item => ({
            id: item.id,
            title: item.title,
            author: item.author,
            published_date: item.published_date,
            source_id: item.source_id,
            source_name: item.source_name,
            source_type: item.source_type,
            summary: item.summary ? item.summary.slice(0, 300) : null,
            is_read: item.is_read,
            url: item.url,
          })),
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/content/:id',
      handler: (params) => {
        const db = getDB();
        const row = db.db.prepare(
          `SELECT ci.*, ds.source_name
           FROM content_items ci
           LEFT JOIN data_sources ds ON ci.source_id = ds.id
           WHERE ci.id = ?`
        ).get(parseInt(params.id));
        if (!row) {
          const err = new Error('Not Found');
          err.statusCode = 404;
          throw err;
        }
        return { data: row };
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/content/:id/read',
      handler: (params, body) => {
        const db = getDB();
        const isRead = (body && body.is_read !== undefined) ? body.is_read : 1;
        db.markContentRead(parseInt(params.id), isRead);
        return { data: { ok: true } };
      },
    },
    {
      method: 'GET',
      pattern: '/api/datasources',
      handler: () => {
        const mgr = engine.getDataSourceManager();
        if (!mgr) return { data: [] };
        return { data: mgr.getAll() };
      },
    },
    {
      method: 'POST',
      pattern: '/api/datasources/validate',
      handler: async (_params, body) => {
        requireRunning();
        const { type, url } = body || {};
        if (type === 'youtube') {
          if (!YouTubeFetcher.validateChannelUrl(url)) {
            return { data: { valid: false, error: 'Invalid YouTube channel URL format' } };
          }
          try {
            const fetcher = new YouTubeFetcher();
            const videos = await fetcher.fetchRecentVideos(url);
            return { data: { valid: true, info: `Found ${videos.length} recent video(s)` } };
          } catch (err) {
            return { data: { valid: false, error: `Connection failed: ${err.message}` } };
          }
        } else if (type === 'rss') {
          if (!RSSFetcher.validateFeedUrl(url)) {
            return { data: { valid: false, error: 'Invalid RSS feed URL format' } };
          }
          try {
            const fetcher = new RSSFetcher();
            const items = await fetcher.fetchItems(url);
            return { data: { valid: true, info: `Found ${items.length} recent item(s)` } };
          } catch (err) {
            return { data: { valid: false, error: `Connection failed: ${err.message}` } };
          }
        }
        return { data: { valid: false, error: `Unknown source type: ${type}` } };
      },
    },
    {
      method: 'POST',
      pattern: '/api/datasources',
      handler: (_params, body) => {
        const mgr = getMgr();
        const result = mgr.add(body);
        const scheduler = engine.getScheduler();
        if (scheduler && result.enabled) {
          scheduler.addSource(result.id);
        }
        return { status: 201, data: result };
      },
    },
    {
      method: 'GET',
      pattern: '/api/datasources/:id/stats',
      handler: (params) => {
        const mgr = engine.getDataSourceManager();
        if (!mgr) return { data: {} };
        return { data: mgr.getStats(params.id) };
      },
    },
    {
      method: 'POST',
      pattern: '/api/datasources/:id/check',
      handler: async (params) => {
        const scheduler = getScheduler();
        await scheduler.checkSource(params.id);
        return { data: { ok: true } };
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/datasources/:id/toggle',
      handler: (params, body) => {
        const mgr = getMgr();
        const scheduler = engine.getScheduler();
        const { enabled } = body || {};
        if (enabled) {
          const result = mgr.toggle(params.id, true);
          if (scheduler) scheduler.addSource(params.id);
          return { data: result };
        } else {
          if (scheduler) scheduler.removeSource(params.id);
          return { data: mgr.toggle(params.id, false) };
        }
      },
    },
    {
      method: 'PUT',
      pattern: '/api/datasources/:id',
      handler: (params, body) => {
        const mgr = getMgr();
        const scheduler = engine.getScheduler();
        if (scheduler) scheduler.removeSource(params.id);
        const result = mgr.update(params.id, body);
        if (scheduler && result.enabled) {
          scheduler.addSource(params.id);
        }
        return { data: result };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/datasources/:id',
      handler: (params) => {
        const mgr = getMgr();
        const scheduler = engine.getScheduler();
        if (scheduler) scheduler.removeSource(params.id);
        mgr.remove(params.id);
        return { data: { ok: true } };
      },
    },
    {
      method: 'GET',
      pattern: '/api/engine/status',
      handler: () => {
        return { data: engine.getStatus() };
      },
    },

    // --- settings/llm ---

    {
      method: 'GET',
      pattern: '/api/settings/llm',
      handler: () => {
        const settings = engine.getLLMSettings ? engine.getLLMSettings() : null;
        if (!settings) return { data: null };
        const masked = { ...settings };
        if (masked.apiKey) {
          masked.apiKey = '****' + masked.apiKey.slice(-4);
        }
        return { data: masked };
      },
    },
    {
      method: 'PUT',
      pattern: '/api/settings/llm',
      handler: (_params, body) => {
        if (!engine.setLLMSettings) {
          const err = new Error('Engine not running');
          err.statusCode = 503;
          throw err;
        }
        const data = { ...body };
        // If apiKey is masked (starts with ****), preserve existing key
        if (data.apiKey && data.apiKey.startsWith('****')) {
          const existing = engine.getLLMSettings();
          data.apiKey = existing ? existing.apiKey : undefined;
        }
        engine.setLLMSettings(data);
        return { data: { ok: true } };
      },
    },
    {
      method: 'POST',
      pattern: '/api/settings/llm/test',
      handler: async (_params, body) => {
        const { provider, apiKey, baseUrl } = body || {};
        if (!provider || !apiKey) {
          return { data: { valid: false, error: 'provider and apiKey are required' } };
        }
        try {
          if (provider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            const res = await fetch(url);
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              return { data: { valid: false, error: err.error?.message || `HTTP ${res.status}` } };
            }
            const json = await res.json();
            const models = (json.models || [])
              .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
              .map(m => m.name.replace('models/', ''));
            return { data: { valid: true, models } };
          } else {
            // openai or openai-compatible
            const options = { apiKey };
            if (baseUrl) options.baseURL = baseUrl;
            const client = new OpenAI(options);
            let models = [];
            try {
              const list = await client.models.list();
              models = list.data
                .map(m => m.id)
                .filter(id => id.includes('gpt-') || (baseUrl ? true : false))
                .sort();
            } catch (_) {
              // openai-compatible may not support model listing
              if (provider === 'openai-compatible') {
                return { data: { valid: true, models: [] } };
              }
              throw _;
            }
            return { data: { valid: true, models } };
          }
        } catch (err) {
          return { data: { valid: false, error: err.message } };
        }
      },
    },
  ];
}

module.exports = { createRoutes };
