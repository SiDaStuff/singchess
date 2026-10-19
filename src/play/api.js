import { consumeSse } from './state.js';

export class PlayApi {
  constructor(app) { this.app = app; }
  async request(path, { method = 'GET', body, signal, stream = false } = {}) {
    const uid = this.app.authState.user?.uid;
    if (!uid) throw new Error('Sign in to your Sing Chess account to connect and play.');
    const headers = await this.app._authHeaders({ ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: stream ? 'text/event-stream' : 'application/json' });
    const response = await window.apiFetch(`/api/play${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: 'no-store', timeoutMs: stream ? 0 : 30000 });
    if (uid !== this.app.authState.user?.uid) throw new Error('Your account changed. Please try again.');
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || (response.status === 429 ? 'Too many requests. Please wait a minute.' : 'Play could not connect. Please try again.'));
      error.status = response.status;
      error.retryAfter = Number(response.headers.get('retry-after')) || 60;
      throw error;
    }
    return stream ? response : response.json();
  }
  post(path, body = {}, options = {}) { return this.request(path, { ...options, method: 'POST', body }); }
  async stream(path, onEvent, { signal, body } = {}) {
    const response = await this.request(path, { signal, stream: true, ...(body ? { method: 'POST', body } : {}) });
    return consumeSse(response, onEvent, signal);
  }
}
