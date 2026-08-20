import { createContext, useContext, useMemo, useState } from 'react';
import {
  api,
  clearSession,
  getAdminSecret,
  getStoredUser,
  getToken,
  setAdminSecret as persistSecret,
  setStoredUser,
  setToken,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(() => getStoredUser());
  const [adminSecret, setAdminSecretState] = useState(() => getAdminSecret());

  const value = useMemo(() => ({
    token,
    user,
    adminSecret,
    isAuthenticated: Boolean(token),

    async login(username, password) {
      const data = await api.login(username, password);
      setToken(data.token);
      setTokenState(data.token);
      const profile = { username, premium: data.premium, tempPassword: data.tempPassword };
      setStoredUser(profile);
      setUser(profile);
      return data;
    },

    logout() {
      clearSession();
      setTokenState('');
      setUser(null);
    },

    saveAdminSecret(secret) {
      persistSecret(secret);
      setAdminSecretState(secret || '');
    },
  }), [token, user, adminSecret]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
