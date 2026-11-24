import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, rinnovaSessione, logout as logoutServer } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [punti, setPunti] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Senza token locale può esserci comunque una sessione valida (cookie di rinnovo).
    if (!getToken() && !(await rinnovaSessione())) { setUser(null); setLoading(false); return; }
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setPunti(data.punti);
    } catch (e) {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    await refresh();
  };

  const logout = async () => {
    await logoutServer();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, punti, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
