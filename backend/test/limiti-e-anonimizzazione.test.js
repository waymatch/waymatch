// Limiti sul reset password e su /setup, anonimizzazione senza doppia
// elaborazione, header Permissions-Policy.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('limiti');
const PORT = 4992;
const BASE = `http://127.0.0.1:${PORT}`;
const API = BASE + '/api';
const PW = 'Password-Valida-123!';
const PW2 = 'Nuova-Password-456!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
const nuovoIp = () => `10.9.${Math.floor(ip / 250)}.${ip++ % 250}`;
async function call(metodo, p, { token, body, ipFisso } = {}) {
  const headers = { 'X-Forwarded-For': ipFisso || nuovoIp() };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method: metodo, headers, body: payload });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function db() { const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`); return d; }

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
    console.log('\n[Permissions-Policy]');
    for (const p of ['/', '/api/health']) {
      const r = await fetch(BASE + p, { headers: { 'X-Forwarded-For': nuovoIp() } });
      const h = r.headers.get('permissions-policy') || '';
      check(`${p} ha Permissions-Policy`, /camera=\(\)/.test(h) && /microphone=\(\)/.test(h) && /geolocation=\(\)/.test(h), h.slice(0, 60));
    }

    console.log('\n[POST /setup limitato]');
    const IP_SETUP = '10.50.0.1';
    let ultimo;
    for (let i = 0; i < 10; i++) ultimo = await call('POST', '/setup', { body: {}, ipFisso: IP_SETUP });
    check('i primi 10 tentativi arrivano alla validazione (400)', ultimo.status === 400);
    check('l\'11° dallo stesso IP è bloccato', (await call('POST', '/setup', { body: {}, ipFisso: IP_SETUP })).status === 429);
    const setup = await call('POST', '/setup', { body: { company_name: 'T', nome: 'Admin', cognome: 'MM', email: 'mm@test.it', password: PW } });
    check('da un altro IP il setup funziona', setup.status === 200 || setup.status === 201, String(setup.status));
    const mm = setup.data.token;

    console.log('\n[reset password, 3 richieste/ora per email]');
    await call('POST', '/users', { token: mm, body: { nome: 'Ugo', cognome: 'U', email: 'ugo@test.it', password: PW } });
    const stati = [];
    for (const e of ['ugo@test.it', 'UGO@test.it', ' ugo@test.it ', 'ugo@test.it']) {
      stati.push((await call('POST', '/auth/password-dimenticata', { body: { email: e } })).status);
    }
    check('3 richieste passano (anche con maiuscole e spazi), la 4ª dà 429', stati.join() === '200,200,200,429', stati.join());
    check('un altro indirizzo non è toccato', (await call('POST', '/auth/password-dimenticata', { body: { email: 'altro@test.it' } })).status === 200);
    const inesistente = [];
    for (let i = 0; i < 4; i++) inesistente.push((await call('POST', '/auth/password-dimenticata', { body: { email: 'fantasma@test.it' } })).status);
    check('un indirizzo inesistente è limitato allo stesso modo (nessuna differenza osservabile)', inesistente.join() === '200,200,200,429', inesistente.join());

    console.log('\n[POST /auth/reimposta-password limitato per IP]');
    const IP_RESET = '10.50.0.2';
    let r;
    for (let i = 0; i < 10; i++) r = await call('POST', '/auth/reimposta-password', { body: { token: 'x'.repeat(20), password_nuova: PW }, ipFisso: IP_RESET });
    check('i primi 10 tentativi con token errato sono respinti (400)', r.status === 400, String(r.status));
    check('l\'11° è bloccato', (await call('POST', '/auth/reimposta-password', { body: { token: 'x'.repeat(20), password_nuova: PW }, ipFisso: IP_RESET })).status === 429);

    console.log('\n[anonimizzazione una sola volta, senza email nell\'audit]');
    for (const [n, e] of [['Dora', 'dora@test.it'], ['Pino', 'pino@test.it']]) {
      await call('POST', '/users', { token: mm, body: { nome: n, cognome: 'T', email: e, password: PW } });
    }
    const dora = (await call('POST', '/auth/login', { body: { email: 'dora@test.it', password: PW } })).data;
    const pino = (await call('POST', '/auth/login', { body: { email: 'pino@test.it', password: PW } })).data;
    const doraNuova = (await call('PUT', '/auth/me/password', { token: dora.token, body: { password_attuale: PW, password_nuova: PW2 } })).data.token;
    const pinoNuova = (await call('PUT', '/auth/me/password', { token: pino.token, body: { password_attuale: PW, password_nuova: PW2 } })).data.token;
    {
      const d = db();
      const dataFutura = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
      const ride = d.prepare(`INSERT INTO rides (driver_id, tipo, data, ora, punto_partenza, punto_arrivo, posti_totali, posti_disponibili) VALUES (?, 'andata', ?, '08:00', 'A', 'B', 3, 2)`).run(dora.user.id, dataFutura);
      d.prepare(`INSERT INTO bookings (ride_id, passenger_id, stato) VALUES (?, ?, 'confermato')`).run(ride.lastInsertRowid, pino.user.id);
      d.close();
    }
    const rich = await call('POST', '/privacy/cancellazione', { token: doraNuova, body: { motivo: 'prova' } });
    check('Dora chiede la cancellazione', rich.status === 200 || rich.status === 201, String(rich.status));
    const id = (await call('GET', '/privacy/cancellazioni', { token: mm })).data.richieste.find((x) => x.email === 'dora@test.it').id;
    const risposte = await Promise.all([1, 2, 3].map(() => call('POST', `/privacy/cancellazioni/${id}/completa`, { token: mm })));
    const codici = risposte.map((x) => x.status).sort().join();
    check('tre conferme in parallelo: una sola riesce (200,400,400)', codici === '200,400,400', codici);
    const audit = (await call('GET', '/audit-log?limit=100', { token: mm })).data;
    const voci = (audit.log || audit.voci || audit.righe || audit.entries || []).filter((v) => v.azione === 'richiesta_cancellazione_completata');
    check('una sola voce di audit per la cancellazione', voci.length === 1, String(voci.length));
    check('la voce di audit non contiene l\'email originale', voci.length === 1 && !/dora@test\.it/i.test(JSON.stringify(voci[0])), JSON.stringify(voci[0]));
    const notifPino = (await call('GET', '/notifications', { token: pinoNuova })).data;
    const lista = notifPino.notifications || notifPino.notifiche || notifPino;
    check('il passeggero riceve una sola notifica di viaggio annullato', Array.isArray(lista) && lista.filter((n) => n.tipo === 'viaggio_annullato').length === 1, JSON.stringify(lista).slice(0, 120));
    const d = db();
    const u = d.prepare('SELECT nome, cognome, email, attivo FROM users WHERE id = ?').get(dora.user.id);
    const bk = d.prepare(`SELECT stato FROM bookings WHERE passenger_id = ?`).get(pino.user.id);
    d.close();
    check('l\'utente è anonimizzato e disattivato', u.cognome === 'cancellato' && u.attivo === 0 && /^cancellato-/.test(u.email));
    check('la prenotazione del passeggero è annullata', bk.stato === 'annullato');

    check('nessun errore non gestito nel log del server', !/Error|TypeError|unhandledRejection/.test(log), (/.*(Error|unhandledRejection).*/.exec(log) || [''])[0].slice(0, 160));
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
