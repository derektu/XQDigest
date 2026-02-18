const YouTubeFetcher = require('./fetchers/youtube');
const RSSFetcher = require('./fetchers/rss');

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

  return [
    // Literal routes BEFORE parametric routes
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
  ];
}

module.exports = { createRoutes };
