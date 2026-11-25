// Con la password provvisoria le API rispondono solo al profilo e
// al cambio password, finché l'utente non ne sceglie una sua.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('password-provvisoria');
const PORT = 4994;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const PW2 = 'Nuova-Password-456!';

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body, form, cookie } = {}) {
  const headers = { 'X-Forwarded-For': `10.6.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method: metodo, headers, body: payload });
  let data = null; try { data = await r.json(); } catch {}
  const c = r.headers.getSetCookie().find((x) => x.startsWith('cp_rinnovo='));
  return { status: r.status, data, cookie: c ? c.split(';')[0] : null };
}
const accedi = async (email, password) => {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  return { token: r.data && r.data.token, cookie: r.cookie, status: r.status, user: r.data && r.data.user };
};
const bloccata = (r) => r.status === 403 && r.data && r.data.codice === 'PASSWORD_DA_CAMBIARE';

// Rotte che un utente con password provvisoria NON deve poter usare (lettura e scrittura).
const ROTTE_BLOCCATE = [
  ['GET', '/notifications'],
  ['GET', '/rides'],
  ['GET', '/privacy/export'],
  ['GET', '/legal-documents/pending'],
  ['GET', '/auth/sessioni'],
  ['PUT', '/auth/me', {}],
  ['POST', '/privacy/cancellazione', { motivo: 'x' }],
  ['POST', '/auth/esci-ovunque', {}],
];

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  try {
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'Admin', cognome: 'MM', email: 'mm@test.it', password: PW } })).data.token;

    console.log('\n[Admin del primo avvio]');
    check('non ha password provvisoria e usa le API', (await call('GET', '/users', { token: mm })).status === 200);

    console.log('\n[Utente creato dal Mobility Manager]');
    await call('POST', '/users', { token: mm, body: { nome: 'Ugo', cognome: 'U', email: 'ugo@test.it', password: PW } });
    const ugo = await accedi('ugo@test.it', PW);
    check('il login riesce', ugo.status === 200 && !!ugo.token);
    check('il login segnala password_da_cambiare', ugo.user && ugo.user.password_da_cambiare === 1);
    const me = await call('GET', '/auth/me', { token: ugo.token });
    check('GET /auth/me consentito (serve al frontend)', me.status === 200 && me.data.user.password_da_cambiare === 1);
    for (const [m, p, b] of ROTTE_BLOCCATE) {
      const r = await call(m, p, { token: ugo.token, body: b });
      check(`${m} ${p} bloccata con 403`, bloccata(r), `${r.status} ${JSON.stringify(r.data)}`);
    }
    check('nessun messaggio tecnico nella risposta', (await call('GET', '/rides', { token: ugo.token })).data.error === 'Prima di continuare devi scegliere una nuova password.');

    console.log('\n[Rinnovo e logout restano disponibili]');
    const rinnovo = await call('POST', '/auth/rinnova', { cookie: ugo.cookie });
    check('il rinnovo dà un token', rinnovo.status === 200 && !!rinnovo.data.token);
    check('anche il token rinnovato è bloccato', bloccata(await call('GET', '/notifications', { token: rinnovo.data.token })));
    const altra = await accedi('ugo@test.it', PW);
    check('logout consentito', (await call('POST', '/auth/logout', { token: altra.token, cookie: altra.cookie })).status === 200);
    check('dopo il logout il token non vale più', (await call('GET', '/auth/me', { token: altra.token })).status === 401);

    console.log('\n[Cambio password]');
    const sbagliata = await call('PUT', '/auth/me/password', { token: ugo.token, body: { password_attuale: PW, password_nuova: 'corta' } });
    check('password non conforme rifiutata con il messaggio dei requisiti', sbagliata.status === 400 && /14 caratteri/.test(sbagliata.data.error));
    const cambio = await call('PUT', '/auth/me/password', { token: ugo.token, body: { password_attuale: PW, password_nuova: PW2 } });
    check('cambio consentito', cambio.status === 200 && !!cambio.data.token);
    for (const [m, p] of [['GET', '/notifications'], ['GET', '/rides'], ['GET', '/privacy/export'], ['GET', '/auth/sessioni']]) {
      const r = await call(m, p, { token: cambio.data.token });
      check(`dopo il cambio ${m} ${p} risponde`, r.status === 200, String(r.status));
    }
    check('il flag è spento', (await call('GET', '/auth/me', { token: cambio.data.token })).data.user.password_da_cambiare === 0);

    console.log('\n[Reset da parte del Mobility Manager]');
    const ugoId = (await call('GET', '/auth/me', { token: cambio.data.token })).data.user.id;
    await call('POST', `/users/${ugoId}/reset-password`, { token: mm, body: { password_nuova: PW } });
    const dopoReset = await accedi('ugo@test.it', PW);
    check('dopo il reset da admin di nuovo bloccato', bloccata(await call('GET', '/rides', { token: dopoReset.token })));

    console.log('\n[Reset da richiesta senza SMTP]');
    await call('POST', '/users', { token: mm, body: { nome: 'Rita', cognome: 'R', email: 'rita@test.it', password: PW } });
    const rita0 = await accedi('rita@test.it', PW);
    await call('PUT', '/auth/me/password', { token: rita0.token, body: { password_attuale: PW, password_nuova: PW2 } });
    await call('POST', '/auth/password-dimenticata', { body: { email: 'rita@test.it' } });
    const richiesta = (await call('GET', '/auth/password-reset-richieste', { token: mm })).data.richieste.find((r) => r.email === 'rita@test.it');
    const gen = await call('POST', `/auth/password-reset-richieste/${richiesta.id}/genera`, { token: mm });
    const rita = await accedi('rita@test.it', gen.data.password_temporanea);
    check('password generata dal Mobility Manager: login riesce', rita.status === 200);
    check('password generata dal Mobility Manager: bloccato', bloccata(await call('GET', '/rides', { token: rita.token })));

    console.log('\n[Utente importato da CSV]');
    const f = new FormData();
    f.append('file', new Blob([`Nome,Cognome,email,passtemporanea\nIvo,I,ivo@test.it,${PW}\n`], { type: 'text/csv' }), 'utenti.csv');
    const imp = await call('POST', '/users/import-csv', { token: mm, form: f });
    check('import riuscito', imp.status === 200 && imp.data.creati === 1, JSON.stringify(imp.data));
    const ivo = await accedi('ivo@test.it', PW);
    check('utente importato bloccato', bloccata(await call('GET', '/notifications', { token: ivo.token })));

    console.log('\n[Mobility Manager creato con password provvisoria]');
    await call('POST', '/users', { token: mm, body: { nome: 'Max', cognome: 'M', email: 'max@test.it', password: PW, ruolo: 'mobility_manager' } });
    const max = await accedi('max@test.it', PW);
    check('niente funzioni di amministrazione prima del cambio', bloccata(await call('GET', '/users', { token: max.token })));
    check('niente export del log', bloccata(await call('GET', '/audit-log/export/xlsx', { token: max.token })));
    const maxCambio = await call('PUT', '/auth/me/password', { token: max.token, body: { password_attuale: PW, password_nuova: PW2 } });
    check('dopo il cambio le funzioni di amministrazione rispondono', (await call('GET', '/users', { token: maxCambio.data.token })).status === 200);

    check('nessun errore non gestito nel log del server', !/Error|TypeError/.test(log), (/.*Error.*/.exec(log) || [''])[0]);
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
