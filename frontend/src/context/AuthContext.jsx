import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, getToken, setToken, getGenerazione, rinnovaSessione, logout as logoutServer } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [punti, setPunti] = useState(0);
  const [loading, setLoading] = useState(true);

  const riprova = useRef(null);
  const inVerifica = useRef(true); // vero finché non sappiamo se l'utente è autenticato
  const fineVerifica = () => { inVerifica.current = false; setLoading(false); };

  const refresh = useCallback(async () => {
    clearTimeout(riprova.current);
    // Le risposte di una sessione superata (uscita o nuovo accesso nel frattempo) si ignorano.
    const gen = getGenerazione();
    const attuale = () => gen === getGenerazione();
    try {
      // Senza token locale può esserci comunque una sessione valida (cookie di rinnovo).
      if (!getToken() && !(await rinnovaSessione())) {
        if (attuale()) { setUser(null); fineVerifica(); }
        return;
      }
      const data = await api.get('/auth/me');
      if (!attuale()) return;
      setUser(data.user);
      setPunti(data.punti);
      fineVerifica();
    } catch (e) {
      if (!attuale()) return;
      if (e.status === 401) {
        // Il server conferma che la sessione non vale più.
        setToken(null);
        setUser(null);
        fineVerifica();
      } else {
        // Guasto temporaneo (rete, server): la sessione resta; se non sappiamo ancora chi è
        // l'utente, si riprova tra poco invece di rimandarlo al login.
        if (inVerifica.current) riprova.current = setTimeout(() => refresh(), 5000);
      }
    }
  }, []);

  useEffect(() => () => clearTimeout(riprova.current), []);

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
