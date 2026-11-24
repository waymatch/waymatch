const TOKEN_KEY = 'carpooling_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function scriviToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Ogni accesso, uscita o cambio di password apre una nuova "generazione" di sessione: un
// rinnovo partito prima non può più sovrascrivere il token di quella nuova.
let generazione = 0;
export function getGenerazione() {
  return generazione;
}
export function setToken(token) {
  generazione++;
  scriviToken(token);
}

// Il token di accesso dura 8 ore; la sessione (cookie httpOnly) dura di più finché viene
// usata. Una sola richiesta di rinnovo anche se più chiamate ricevono 401 insieme.
// Esito: il nuovo token; null se il server conferma che la sessione non vale più (401/403);
// un'eccezione per i guasti temporanei (rete, server non disponibile), che non devono far
// uscire l'utente.
let rinnovoInCorso = null;
export function rinnovaSessione() {
  if (!rinnovoInCorso) {
    const gen = generazione;
    rinnovoInCorso = fetch('/api/auth/rinnova', { method: 'POST' })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) return null;
        if (!r.ok) throw new Error(`Rinnovo della sessione non riuscito (${r.status})`);
        const { token } = await r.json();
        // Nel frattempo c'è stato un nuovo accesso o un'uscita: vale la sessione nuova.
        if (gen !== generazione) return getToken();
        scriviToken(token);
        return token;
      })
      .finally(() => { rinnovoInCorso = null; });
  }
  return rinnovoInCorso;
}

export async function logout() {
  const token = getToken();
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (e) { /* offline: il token locale si cancella comunque */ }
  setToken(null);
}

function sessioneTerminata() {
  setToken(null);
  window.location.replace('/login');
}

const SENZA_RINNOVO = ['/auth/login', '/auth/rinnova', '/auth/logout'];

async function fetchAutenticato(path, opzioni = {}) {
  const esegui = (token) => fetch(`/api${path}`, {
    ...opzioni,
    headers: { ...opzioni.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const token = getToken();
  const gen = getGenerazione();
  let res = await esegui(token);
  if (res.status !== 401 || !token || SENZA_RINNOVO.includes(path)) return res;

  // Un'altra chiamata può aver già rinnovato il token mentre questa era in volo.
  let nuovo;
  try {
    nuovo = getToken() !== token ? getToken() : await rinnovaSessione();
  } catch (e) {
    return res; // guasto temporaneo: l'utente resta dentro, la chiamata riporta l'errore
  }
  // Nel frattempo c'è stato un accesso o un'uscita: la richiesta apparteneva alla sessione
  // precedente e non va ripetuta con l'identità di quella nuova (né la si deve chiudere).
  if (gen !== getGenerazione()) return res;
  if (!nuovo) {
    sessioneTerminata();
    return res;
  }
  res = await esegui(nuovo);
  if (res.status === 401) sessioneTerminata();
  return res;
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetchAutenticato(path, {
    method,
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (e) { /* risposta vuota */ }

  if (!res.ok) {
    const message = (data && data.error) || `Errore ${res.status}`;
    const errore = new Error(message);
    errore.status = res.status;
    if (data && data.codice) errore.codice = data.codice;
    throw errore;
  }
  return data;
}

async function fetchBlobAutenticato(path) {
  const res = await fetchAutenticato(path);
  if (!res.ok) {
    let msg = `Errore ${res.status}`;
    try { const d = await res.json(); if (d.error) msg = d.error; } catch (e) { /* ignora */ }
    throw new Error(msg);
  }
  return res.blob();
}

// Scarica un file binario autenticato (export, immagini) e lo salva/apre come farebbe un link.
export async function scaricaFile(path, nomeFileSuggerito) {
  const blob = await fetchBlobAutenticato(path);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFileSuggerito || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// Recupera un'immagine autenticata come URL utilizzabile in <img src>.
export async function caricaImmagineAutenticata(path) {
  const blob = await fetchBlobAutenticato(path);
  return window.URL.createObjectURL(blob);
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};
