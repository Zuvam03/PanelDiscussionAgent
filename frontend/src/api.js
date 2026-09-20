const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  getConfig: () => request('/config'),
  listSessions: () => request('/sessions'),
  createSession: (data) =>
    request('/sessions', { method: 'POST', body: JSON.stringify(data) }),
  getSession: (id) => request(`/sessions/${id}`),
  startSession: (id) => request(`/sessions/${id}/start`, { method: 'POST' }),
  sendMessage: (id, text) =>
    request(`/sessions/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  tick: (id) => request(`/sessions/${id}/tick`, { method: 'POST' }),
  endSession: (id) => request(`/sessions/${id}/end`, { method: 'POST' }),
  getReport: (id, regenerate = false) =>
    request(`/sessions/${id}/report${regenerate ? '?regenerate=true' : ''}`),
  deleteSession: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
};
