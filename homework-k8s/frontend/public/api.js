export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || data?.code || `HTTP ${status}`);
    this.status = status;
    this.data = data;
  }
}

export function createApi(onRequest = () => {}, onUnauthorized = () => {}) {
  return async function api(path, { method = 'GET', body, key, signal, expected = [] } = {}) {
    const started = performance.now();
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    let status = 0;
    let data;
    try {
      const response = await fetch(`/api${path}`, {
        method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(22000)]) : AbortSignal.timeout(22000),
      });
      status = response.status;
      const raw = await response.text();
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw }; }
      if (status === 401 && !expected.includes(status)) onUnauthorized();
      if (!response.ok && !expected.includes(status)) throw new ApiError(status, data);
      return { status, data };
    } catch (error) {
      if (!data) data = { message: error.name === 'TimeoutError' ? 'API не ответил за 22 секунды' : error.message };
      throw error;
    } finally {
      // Credentials and session cookies never enter the visible request history.
      const safeBody = body && Object.fromEntries(Object.entries(body).map(([name, value]) => [name, name === 'password' ? '••••••••' : value]));
      onRequest({ id: crypto.randomUUID(), time: new Date().toISOString(), path, method, body: safeBody, key, status, data, duration: Math.round(performance.now() - started) });
    }
  };
}
