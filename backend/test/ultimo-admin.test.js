// L'app deve avere sempre almeno un Mobility Manager attivo.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('ultimo-admin');
const PORT = 4991;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body, form } = {}) {
  const headers = { 'X-Forwarded-For': `10.21.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method: metodo, headers, body: payload });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function db() { const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`); return d; }
const conta = () => { const d = db(); const n = d.prepare(`SELECT COUNT(*) n FROM users WHERE ruolo='mobility_manager' AND attivo=1`).get().n; d.close(); return n; };
const csv = (nome, testo) => { const f = new FormData(); f.append('file', new Blob([testo], { type: 'text/csv' }), nome); return f; };

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  try {
    const setup = await call('POST', '/setup', { body: { company_name: 'T', nome: 'Admin', cognome: 'Uno', email: 'mm1@test.it', password: PW } });
    const mm1 = setup.data.token;
    const id1 = (await call('GET', '/auth/me', { token: mm1 })).data.user.id;
    const dati = (u, extra) => ({ nome: u.nome, cognome: u.cognome, email: u.email, ruolo: u.ruolo, sede_id: u.sede_id, attivo: 1, ...extra });
    const me1 = (await call('GET', '/auth/me', { token: mm1 })).data.user;

    console.log('\n[Un solo Mobility Manager]');
    check('stato iniziale: un Mobility Manager attivo', conta() === 1);
    let r = await call('PUT', `/users/${id1}`, { token: mm1, body: dati(me1, { attivo: 0 }) });
    check('non può disattivare sé stesso', r.status === 400 && /tuo stesso account/.test(r.data.error), `${r.status} ${r.data.error}`);
    r = await call('PUT', `/users/${id1}`, { token: mm1, body: dati(me1, { ruolo: 'utente' }) });
    check('non può togliersi il ruolo', r.status === 400 && /almeno un Mobility Manager/.test(r.data.error), `${r.status} ${r.data.error}`);
    r = await call('DELETE', `/users/${id1}`, { token: mm1 });
    check('non può eliminarsi', r.status === 400);
    r = await call('PUT', `/users/${id1}`, { token: mm1, body: dati(me1, { nome: 'Admin2' }) });
    check('una modifica normale del proprio profilo riesce', r.status === 200, String(r.status));
    check('ruolo e stato non sono cambiati', conta() === 1);

    console.log('\n[Due Mobility Manager]');
    await call('POST', '/users', { token: mm1, body: { nome: 'Max', cognome: 'Due', email: 'mm2@test.it', password: PW, ruolo: 'mobility_manager' } });
    { const d = db(); d.prepare('UPDATE users SET password_da_cambiare = 0').run(); d.close(); }
    const mm2 = (await call('POST', '/auth/login', { body: { email: 'mm2@test.it', password: PW } })).data;
    const me2 = (await call('GET', '/auth/me', { token: mm2.token })).data.user;
    check('ora i Mobility Manager attivi sono due', conta() === 2);
    r = await call('PUT', `/users/${me2.id}`, { token: mm1, body: dati(me2, { attivo: 0 }) });
    check('uno può disattivare l\'altro', r.status === 200 && conta() === 1, String(r.status));
    r = await call('PUT', `/users/${me2.id}`, { token: mm1, body: dati(me2, { attivo: 1 }) });
    check('e riattivarlo', r.status === 200 && conta() === 2, String(r.status));
    r = await call('PUT', `/users/${id1}`, { token: mm1, body: dati(me1, { nome: 'Admin2', ruolo: 'utente' }) });
    check('può togliersi il ruolo se ne resta un altro', r.status === 200 && conta() === 1, String(r.status));

    console.log('\n[Ora il solo Mobility Manager è Max]');
    r = await call('PUT', `/users/${me2.id}`, { token: mm2.token, body: dati(me2, { ruolo: 'utente' }) });
    check('non può togliersi il ruolo', r.status === 400 && /almeno un Mobility Manager/.test(r.data.error), `${r.status}`);
    r = await call('DELETE', `/users/${me2.id}`, { token: mm2.token });
    check('non può eliminarsi', r.status === 400);

    console.log('\n[Import CSV]');
    r = await call('POST', '/users/import-csv', { token: mm2.token, form: csv('utenti.csv', `Nome,Cognome,email,passtemporanea,ruolo\nZed,Z,zed@test.it,${PW},utente\nMax,Due,mm2@test.it,,utente\n`) });
    check('un file che toglie il ruolo all\'ultimo admin viene rifiutato', r.status === 400 && /almeno un Mobility Manager/.test(r.data.error), `${r.status} ${JSON.stringify(r.data)}`);
    const d1 = db();
    check('il file non è stato applicato in parte (Zed non esiste)', !d1.prepare("SELECT 1 FROM users WHERE email = 'zed@test.it'").get());
    d1.close();
    check('Max è ancora Mobility Manager attivo', conta() === 1);
    r = await call('POST', '/users/import-csv', { token: mm2.token, form: csv('utenti.csv', `Nome,Cognome,email,passtemporanea,ruolo\nMax,Due,mm2@test.it,,mobility_manager\nZed,Z,zed@test.it,${PW},utente\n`) });
    check('lo stesso file che mantiene il ruolo è accettato', r.status === 200 && r.data.creati === 1, JSON.stringify(r.data));

    console.log('\n[Cancellazione dei dati dell\'ultimo admin]');
    const nuovo = (await call('PUT', '/auth/me/password', { token: mm2.token, body: { password_attuale: PW, password_nuova: 'Nuova-Password-456!' } })).data.token;
    await call('POST', '/privacy/cancellazione', { token: nuovo, body: { motivo: 'prova' } });
    const rich = (await call('GET', '/privacy/cancellazioni', { token: nuovo })).data.richieste[0];
    r = await call('POST', `/privacy/cancellazioni/${rich.id}/completa`, { token: nuovo });
    check('l\'anonimizzazione dell\'ultimo admin è rifiutata', r.status === 400 && /almeno un Mobility Manager/.test(r.data.error), `${r.status} ${JSON.stringify(r.data)}`);
    const d2 = db();
    check('l\'account non è stato anonimizzato', d2.prepare('SELECT email, attivo FROM users WHERE id = ?').get(me2.id).email === 'mm2@test.it');
    check('la richiesta è ancora in attesa', d2.prepare('SELECT stato FROM account_deletion_requests WHERE id = ?').get(rich.id).stato === 'in_attesa');
    d2.close();

    check('nessun errore non gestito nel log del server', !/Error|TypeError|unhandledRejection/.test(log), (/.*(Error|unhandledRejection).*/.exec(log) || [''])[0].slice(0, 160));
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
