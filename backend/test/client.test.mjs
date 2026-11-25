// Esegue frontend/src/api.js in Node contro un'istanza isolata, simulando browser e cookie.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BACKEND, FRONTEND, cartellaProva } = require('./ambiente.js');
const jwt = require(path.join(BACKEND, 'node_modules/jsonwebtoken'));
const DIR = cartellaProva('client');
const PORT = 4997;
const ORIGINE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const PW = 'Password-Valida-123!';

let esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

// Browser simulato: localStorage, redirect, cookie jar per l'origine, contatore chiamate.
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
let redirect = null;
globalThis.window = { location: { replace: (u) => { redirect = u; } }, URL };
let cookieJar = null;
const chiamate = [];
const fetchVero = globalThis.fetch;
globalThis.fetch = async (url, opz = {}) => {
  chiamate.push(`${opz.method || 'GET'} ${url}`);
  const headers = { ...(opz.headers || {}), 'X-Forwarded-For': `10.2.0.${chiamate.length % 250}` };
  if (cookieJar && String(url).startsWith('/api/auth')) headers.Cookie = cookieJar;
  const r = await fetchVero(ORIGINE + url, { ...opz, headers });
  for (const c of r.headers.getSetCookie()) {
    if (!c.startsWith('cp_rinnovo=')) continue;
    cookieJar = /Expires=Thu, 01 Jan 1970/i.test(c) ? null : c.split(';')[0];
  }
  return r;
};

const server = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
    JWT_SECRET, DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), SMTP_HOST: '' },
  stdio: 'ignore',
});
for (let i = 0; i < 100; i++) { try { if ((await fetchVero(ORIGINE + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

try {
  const { api, getToken, setToken, rinnovaSessione, logout } = await import(path.join(FRONTEND, 'src/api.js'));

  await api.post('/setup', { company_name: 'T', nome: 'A', cognome: 'B', email: 'mm@test.it', password: PW });
  cookieJar = null; setToken(null);

  console.log('\n[Login]');
  const login = await api.post('/auth/login', { email: 'mm@test.it', password: PW });
  setToken(login.token);
  check('login salva token e cookie', !!getToken() && !!cookieJar);
  let errore = null;
  try { await api.post('/auth/login', { email: 'mm@test.it', password: 'sbagliata' }); } catch (e) { errore = e.message; }
  check('password sbagliata: errore mostrato, nessun redirect', errore === 'Credenziali non valide' && redirect === null);

  console.log('\n[Token scaduto a pagina aperta]');
  const p = JSON.parse(Buffer.from(getToken().split('.')[1], 'base64url').toString());
  const scaduto = () => jwt.sign({ id: p.id, v: p.v, jti: p.jti, iat: p.iat - 9 * 3600, exp: p.iat - 3600 }, JWT_SECRET);
  setToken(scaduto());
  chiamate.length = 0;
  const me = await api.get('/auth/me');
  check('la chiamata riesce in modo trasparente', me.user.email === 'mm@test.it' && redirect === null);
  check('sequenza: 401 → rinnova → ripetizione', chiamate.join(' | ') === 'GET /api/auth/me | POST /api/auth/rinnova | GET /api/auth/me', chiamate.join(' | '));
  check('token aggiornato in localStorage', getToken() !== null && JSON.parse(Buffer.from(getToken().split('.')[1], 'base64url').toString()).exp > Date.now() / 1000);

  console.log('\n[Più chiamate in parallelo con token scaduto]');
  setToken(scaduto());
  chiamate.length = 0;
  const risultati = await Promise.all([api.get('/auth/me'), api.get('/sedi'), api.get('/notifications'), api.get('/auth/sessioni')]);
  const rinnovi = chiamate.filter((c) => c.includes('/auth/rinnova')).length;
  check('tutte e 4 le chiamate riescono', risultati.every(Boolean) && redirect === null);
  check('un solo rinnovo per 4 chiamate respinte', rinnovi === 1, `${rinnovi} rinnovi`);

  console.log('\n[Download autenticato con token scaduto]');
  setToken(scaduto());
  const { scaricaFile } = await import(path.join(FRONTEND, 'src/api.js'));
  let blobErr = null;
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  window.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  try { await scaricaFile('/privacy/export', 'dati.json'); } catch (e) { blobErr = e.message; }
  check('export GDPR riuscito dopo rinnovo', blobErr === null && redirect === null, blobErr || '');

  console.log('\n[Avvio app senza token in localStorage]');
  setToken(null);
  const t = await rinnovaSessione();
  check('il cookie ricrea il token all\'avvio', !!t && getToken() === t);

  console.log('\n[Sessione chiusa altrove]');
  const altra = await fetchVero(ORIGINE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.9' }, body: JSON.stringify({ email: 'mm@test.it', password: PW }) });
  const tokAltra = (await altra.json()).token;
  await fetchVero(ORIGINE + '/api/auth/esci-ovunque', { method: 'POST', headers: { Authorization: `Bearer ${tokAltra}`, 'X-Forwarded-For': '10.9.9.9' } });
  errore = null;
  try { await api.get('/auth/me'); } catch (e) { errore = e.message; }
  check('sessione revocata da un altro dispositivo: ritorno al login', redirect === '/login' && getToken() === null, `redirect=${redirect}`);

  console.log('\n[Logout]');
  redirect = null;
  const l2 = await api.post('/auth/login', { email: 'mm@test.it', password: PW });
  setToken(l2.token);
  const cookiePrima = cookieJar;
  await logout();
  check('logout cancella token e cookie', getToken() === null && cookieJar === null);
  cookieJar = cookiePrima;
  check('il vecchio cookie non rinnova più', (await rinnovaSessione()) === null);
  check('un utente uscito non viene rediretto in loop', redirect === null);
} finally {
  server.kill();
  console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
  if (esito.ko) process.exitCode = 1;
}
