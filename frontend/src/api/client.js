const TOKEN_KEY = 'bb_admin_token';
const SECRET_KEY = 'bb_admin_secret';
const USER_KEY = 'bb_admin_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getAdminSecret() {
  return localStorage.getItem(SECRET_KEY) || '';
}

export function setAdminSecret(secret) {
  if (secret) localStorage.setItem(SECRET_KEY, secret);
  else localStorage.removeItem(SECRET_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function clearSession() {
  setToken('');
  setStoredUser(null);
}

async function request(path, { method = 'GET', body, admin = false, auth = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (admin) {
    const secret = getAdminSecret();
    if (secret) headers['x-admin-secret'] = secret;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message = data?.error || data?.message || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  login: (username, password) =>
    request('https://blueboxx-backend.onrender.com/api/user/login', { method: 'POST', body: { username, password } }),

  listUsers: (params = {}) => {
    const q = new URLSearchParams();
    if (params.site) q.set('site', params.site);
    if (params.q) q.set('q', params.q);
    const qs = q.toString();
    return request(`https://blueboxx-backend.onrender.com/api/user/list${qs ? `?${qs}` : ''}`, { admin: true });
  },

  createUser: (payload) =>
    request('https://blueboxx-backend.onrender.com/api/user/create', {
      method: 'POST',
      admin: true,
      body: { ...payload, secret: getAdminSecret() },
    }),

  updateUser: (payload) =>
    request('https://blueboxx-backend.onrender.com/api/user/update', {
      method: 'PATCH',
      admin: true,
      body: { ...payload, secret: getAdminSecret() },
    }),

  listSites: () => request('https://blueboxx-backend.onrender.com/api/site'),

  ordersByDay: ({ site, date, extraDays = 0 }) => {
    const q = new URLSearchParams({ site, date, extraDays: String(extraDays) });
    return request(`https://blueboxx-backend.onrender.com/api/order/by-site/day?${q}`);
  },

  ordersByRange: ({ site, mode, start, end }) => {
    const q = new URLSearchParams({ site, mode });
    if (mode === 'custom') {
      if (start) q.set('start', start);
      if (end) q.set('end', end);
    }
    return request(`https://blueboxx-backend.onrender.com/api/order/by-site/range?${q}`);
  },

  dashboard: ({ site, mode, start, end }) => {
    const q = new URLSearchParams({ site, mode });
    if (mode === 'custom') {
      if (start) q.set('start', start);
      if (end) q.set('end', end);
    }
    return request(`https://blueboxx-backend.onrender.com/api/order/dashboard?${q}`);
  },

  updateOrderStatus: (id, status) =>
    request(`https://blueboxx-backend.onrender.com/api/order/${id}/status`, {
      method: 'PATCH',
      body: { status },
    }),
};
