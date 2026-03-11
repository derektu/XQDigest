async function _request(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const dataSources = {
  list:     ()              => _request('GET',    '/api/datasources'),
  add:      (ds)            => _request('POST',   '/api/datasources', ds),
  update:   (id, fields)    => _request('PUT',    `/api/datasources/${id}`, fields),
  remove:   (id, deleteData = false) => _request('DELETE', `/api/datasources/${id}`, { deleteData }),
  toggle:   (id, enabled)   => _request('PATCH',  `/api/datasources/${id}/toggle`, { enabled }),
  validate: (type, url)     => _request('POST',   '/api/datasources/validate', { type, url }),
  checkNow: (id)            => _request('POST',   `/api/datasources/${id}/check`),
  stats:    (id)            => _request('GET',    `/api/datasources/${id}/stats`),
  exportAll: ()            => _request('GET',    '/api/datasources/export'),
  importSources: (sources) => _request('POST',   '/api/datasources/import', { sources }),
};

export const engine = {
  getStatus: () => _request('GET', '/api/engine/status'),
};

export const content = {
  list: ({ sourceId, limit = 20, offset = 0 } = {}) => {
    const params = new URLSearchParams({ limit, offset });
    if (sourceId) params.set('sourceId', sourceId);
    return _request('GET', `/api/content?${params}`);
  },
  get: (id) => _request('GET', `/api/content/${id}`),
  markRead: (id, isRead) => _request('PATCH', `/api/content/${id}/read`, { is_read: isRead ? 1 : 0 }),
  unreadCounts: () => _request('GET', '/api/content/unread-counts'),
};

export const settings = {
  getLLM:         ()     => _request('GET',    '/api/settings/llm'),
  updateLLM:      (data) => _request('PUT',    '/api/settings/llm', data),
  testLLM:        (p)    => _request('POST',   '/api/settings/llm/test', p),
  getOAuthStatus: ()     => _request('GET',    '/api/settings/llm/oauth/status'),
  loginOAuth:     ()     => _request('POST',   '/api/settings/llm/oauth/login'),
  logoutOAuth:    ()     => _request('DELETE', '/api/settings/llm/oauth/logout'),
};

export const app = {
  getVersion: () => _request('GET', '/api/version'),
};
