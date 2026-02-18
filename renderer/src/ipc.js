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
  remove:   (id)            => _request('DELETE', `/api/datasources/${id}`),
  toggle:   (id, enabled)   => _request('PATCH',  `/api/datasources/${id}/toggle`, { enabled }),
  validate: (type, url)     => _request('POST',   '/api/datasources/validate', { type, url }),
  checkNow: (id)            => _request('POST',   `/api/datasources/${id}/check`),
  stats:    (id)            => _request('GET',    `/api/datasources/${id}/stats`),
};

export const engine = {
  getStatus: () => _request('GET', '/api/engine/status'),
};
