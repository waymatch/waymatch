// Verifica di login, bcrypt, blocco e reset contro un'istanza isolata.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { BACKEND, cartellaProva } = require('./ambiente');
const bcrypt = require(path.join(BACKEND, 'node_modules/bcryptjs'));
const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3-multiple-ciphers'));

const DIR = cartellaProva('accesso');

const PORT = 4999;
const BASE = `http://127.0.0.1:${PORT}/api`;
const DB_KEY = crypto.randomBytes(32).toString('hex');
const PW = 'Password-Valida-123!';

let esito = { ok: 0, ko: 0 };
function check(nome, cond, extra = '') {
  if (cond) { esito.ok++; console.log(`  OK   ${nome}${extra ? ' — ' + extra : ''}`); }
  else { esito.ko++; console.log(`  FAIL ${nome}${extra ? ' — ' + extra : ''}`); }
}

let ipCounter = 1;
async function call(metodo, p, { body, token, ip, form } = {}) {
  const headers = { 'X-Forwarded-For': ip || `10.0.0.${ipCounter++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const t = performance.now();
  const r = await fetch(BASE + p, { method: metodo, headers, body: payload });
  const ms = performance.now() - t;
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, ms };
}

function apriDb() {
  const db = new Database(path.join(DIR, 'data', 'carpooling.db'));
  db.pragma(`key='${DB_KEY}'`);
  return db;
}
const rounds = (email) => { const db = apriDb(); const h = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email).password_hash; db.close(); return bcrypt.getRounds(h); };
const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  try {
    console.log('\n[Setup e durata token — S9]');
    const setup = await call('POST', '/setup', { body: { company_name: 'Test', nome: 'Admin', cognome: 'MM', email: 'mm@test.it', password: PW } });
    check('setup riuscito', setup.status === 200, `status ${setup.status}`);
    const mm = setup.data.token;
    const payload = JSON.parse(Buffer.from(mm.split('.')[1], 'base64url').toString());
    check('token valido 8 ore (480 min)', payload.exp - payload.iat === 8 * 3600, `${(payload.exp - payload.iat) / 60} min`);
    check('hash del setup a costo 12', rounds('mm@test.it') === 12);
    const setup2 = await call('POST', '/setup', { body: { company_name: 'X', nome: 'A', cognome: 'B', email: 'altro@test.it', password: PW } });
    check('secondo setup rifiutato', setup2.status === 400);

    console.log('\n[Creazione utenti e costo bcrypt — S2]');
    const crea = await call('POST', '/users', { token: mm, body: { nome: 'Mario', cognome: 'Rossi', email: 'mario@test.it', password: PW } });
    check('creazione utente', crea.status === 200, `status ${crea.status}`);
    check('hash nuovo utente a costo 12', rounds('mario@test.it') === 12);
    const creaDis = await call('POST', '/users', { token: mm, body: { nome: 'Dis', cognome: 'Attivo', email: 'dis@test.it', password: PW } });
    await call('PUT', `/users/${creaDis.data.user.id}`, { token: mm, body: { nome: 'Dis', cognome: 'Attivo', email: 'dis@test.it', ruolo: 'utente', attivo: 0 } });

    console.log('\n[Rigenerazione hash al login — S2]');
    {
      const db = apriDb();
      db.prepare(`INSERT INTO users (nome, cognome, email, password_hash, ruolo) VALUES ('Vec', 'Chio', 'vecchio@test.it', ?, 'utente')`).run(bcrypt.hashSync(PW, 10));
      db.close();
    }
    check('hash di partenza a costo 10', rounds('vecchio@test.it') === 10);
    const l1 = await call('POST', '/auth/login', { body: { email: 'vecchio@test.it', password: PW } });
    check('login con hash a costo 10', l1.status === 200);
    check('hash rigenerato a costo 12', rounds('vecchio@test.it') === 12);
    const meVecchio = await call('GET', '/auth/me', { token: l1.data.token });
    check('il token emesso resta valido dopo la rigenerazione', meVecchio.status === 200);
    const l2 = await call('POST', '/auth/login', { body: { email: 'vecchio@test.it', password: PW } });
    check('login successivo con hash a costo 12', l2.status === 200);

    console.log('\n[Tempi di login — S3]');
    const tInesistente = [], tSbagliata = [], tDisattivato = [], tGiusta = [];
    for (let i = 0; i < 4; i++) {
      tInesistente.push((await call('POST', '/auth/login', { body: { email: `nessuno${i}@test.it`, password: 'qualsiasi' } })).ms);
      const r = await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: 'sbagliata' } });
      tSbagliata.push(r.ms);
      tDisattivato.push((await call('POST', '/auth/login', { body: { email: 'dis@test.it', password: PW } })).ms);
      tGiusta.push((await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: PW } })).ms); // azzera il contatore
    }
    const mI = media(tInesistente), mS = media(tSbagliata), mD = media(tDisattivato);
    console.log(`       medie: inesistente ${mI.toFixed(0)} ms, password sbagliata ${mS.toFixed(0)} ms, disattivato ${mD.toFixed(0)} ms, login riuscito ${media(tGiusta).toFixed(0)} ms`);
    check('email inesistente non più veloce della password sbagliata', Math.abs(mI - mS) / mS < 0.25, `scarto ${(Math.abs(mI - mS) / mS * 100).toFixed(0)}%`);
    check('account disattivato non più veloce della password sbagliata', Math.abs(mD - mS) / mS < 0.25, `scarto ${(Math.abs(mD - mS) / mS * 100).toFixed(0)}%`);
    const rI = await call('POST', '/auth/login', { body: { email: 'nessuno@test.it', password: 'x' } });
    const rS = await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: 'x' } });
    await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: PW } });
    check('stesso status e messaggio', rI.status === rS.status && rI.data.error === rS.data.error, `${rI.status} "${rI.data.error}"`);
    const tipoErr = await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: { a: 1 } } });
    check('password non stringa → 400, non 500', tipoErr.status === 400, `status ${tipoErr.status}`);

    console.log('\n[Blocco dopo 5 errori — S4]');
    await call('POST', '/users', { token: mm, body: { nome: 'Bloc', cognome: 'Co', email: 'blocco@test.it', password: PW } });
    let ultimo;
    for (let i = 0; i < 5; i++) ultimo = await call('POST', '/auth/login', { body: { email: 'blocco@test.it', password: 'sbagliata' } });
    check('5° errore blocca l\'account', ultimo.status === 429);
    const dopo = await call('POST', '/auth/login', { body: { email: 'blocco@test.it', password: PW } });
    check('password giusta rifiutata durante il blocco', dopo.status === 429);
    {
      const db = apriDb();
      const n = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE azione = 'account_bloccato'`).get().n;
      db.close();
      check('voce di audit del blocco', n >= 1);
    }

    console.log('\n[Blocco con tentativi in parallelo — S4]');
    await call('POST', '/users', { token: mm, body: { nome: 'Para', cognome: 'Llelo', email: 'parallelo@test.it', password: PW } });
    const paralleli = await Promise.all(Array.from({ length: 12 }, () => call('POST', '/auth/login', { body: { email: 'parallelo@test.it', password: 'sbagliata' } })));
    const bloccati = paralleli.filter((r) => r.status === 429).length;
    check('12 errori in parallelo bloccano l\'account', bloccati >= 1, `${bloccati} risposte 429 su 12`);
    const dopoPar = await call('POST', '/auth/login', { body: { email: 'parallelo@test.it', password: PW } });
    check('account bloccato anche dopo l\'attacco parallelo', dopoPar.status === 429);
    const misto = await Promise.all([
      ...Array.from({ length: 6 }, () => call('POST', '/auth/login', { body: { email: 'mario@test.it', password: 'sbagliata' } })),
    ]);
    check('6 errori in parallelo su un altro account bloccano', misto.some((r) => r.status === 429));
    {
      const db = apriDb();
      db.prepare(`UPDATE users SET bloccato_fino = NULL, tentativi_falliti = 0 WHERE email = 'mario@test.it'`).run();
      db.close();
    }

    console.log('\n[Server non bloccato durante bcrypt]');
    {
      const t0 = performance.now();
      bcrypt.compareSync('x', bcrypt.hashSync('y', 12));
      const bloccoSincrono = (performance.now() - t0) / 2;
      const loginInCorso = call('POST', '/auth/login', { body: { email: 'mario@test.it', password: PW } });
      let finito = false;
      loginInCorso.then(() => { finito = true; });
      const attese = [];
      await new Promise((r) => setTimeout(r, 20));
      while (!finito) attese.push((await call('GET', '/health')).ms);
      await loginInCorso;
      // Con un bcrypt sincrono le richieste in corso aspettano per intero il blocco, quindi la
      // MEDIANA sarebbe alta. Su macchine condivise (CI) una singola risposta può essere
      // lenta per ragioni estranee: si guarda la mediana, non il caso peggiore.
      const ordinate = [...attese].sort((a, b) => a - b);
      const mediana = ordinate[Math.floor(ordinate.length / 2)];
      const peggiore = ordinate[ordinate.length - 1];
      check('/health risponde durante un login (mediana < un quarto di un bcrypt sincrono)', mediana < bloccoSincrono / 4 + 20 && peggiore < bloccoSincrono * 1.5 && attese.length >= 3,
        `${attese.length} richieste, mediana ${mediana.toFixed(0)} ms, peggiore ${peggiore.toFixed(0)} ms; un bcrypt sincrono a costo 12 bloccherebbe ~${bloccoSincrono.toFixed(0)} ms`);
    }

    console.log('\n[Cambio password]');
    const lm = await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: PW } });
    const nuovaPw = 'Nuova-Password-456!';
    const cambio = await call('PUT', '/auth/me/password', { token: lm.data.token, body: { password_attuale: PW, password_nuova: nuovaPw } });
    check('cambio password riuscito', cambio.status === 200);
    check('vecchio token revocato', (await call('GET', '/auth/me', { token: lm.data.token })).status === 401);
    check('nuovo token valido', (await call('GET', '/auth/me', { token: cambio.data.token })).status === 200);
    check('password attuale errata respinta', (await call('PUT', '/auth/me/password', { token: cambio.data.token, body: { password_attuale: 'no', password_nuova: nuovaPw } })).status === 400);
    check('login con la nuova password', (await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: nuovaPw } })).status === 200);

    console.log('\n[Reset via link, monouso anche in parallelo — S6]');
    {
      const tokenChiaro = crypto.randomBytes(32).toString('hex');
      const db = apriDb();
      const uid = db.prepare(`SELECT id FROM users WHERE email = 'mario@test.it'`).get().id;
      db.prepare(`INSERT INTO password_reset_tokens (user_id, token_hash, scade_il) VALUES (?, ?, datetime('now', '+2 hours'))`)
        .run(uid, crypto.createHash('sha256').update(tokenChiaro).digest('hex'));
      db.close();
      const [a, b] = await Promise.all([
        call('POST', '/auth/reimposta-password', { body: { token: tokenChiaro, password_nuova: 'Reset-Password-AAA1!' } }),
        call('POST', '/auth/reimposta-password', { body: { token: tokenChiaro, password_nuova: 'Reset-Password-BBB2!' } }),
      ]);
      const stati = [a.status, b.status].sort();
      check('un solo reset riuscito con lo stesso link', stati[0] === 200 && stati[1] === 400, `status ${stati.join(', ')}`);
      const pwVincente = a.status === 200 ? 'Reset-Password-AAA1!' : 'Reset-Password-BBB2!';
      check('login con la password del reset', (await call('POST', '/auth/login', { body: { email: 'mario@test.it', password: pwVincente } })).status === 200);
      check('hash del reset a costo 12', rounds('mario@test.it') === 12);
    }

    console.log('\n[Password provvisoria dal Mobility Manager — S7]');
    {
      await call('POST', '/auth/password-dimenticata', { body: { email: 'vecchio@test.it' } });
      const elenco = await call('GET', '/auth/password-reset-richieste', { token: mm });
      const rich = elenco.data.richieste.find((r) => r.email === 'vecchio@test.it' && r.stato === 'in_attesa');
      check('richiesta creata senza SMTP', !!rich);
      const [g1, g2] = await Promise.all([
        call('POST', `/auth/password-reset-richieste/${rich.id}/genera`, { token: mm }),
        call('POST', `/auth/password-reset-richieste/${rich.id}/genera`, { token: mm }),
      ]);
      const stati = [g1.status, g2.status].sort();
      check('doppio click genera una sola password', stati[0] === 200 && stati[1] === 400, `status ${stati.join(', ')}`);
      const temp = (g1.status === 200 ? g1 : g2).data.password_temporanea;
      const lt = await call('POST', '/auth/login', { body: { email: 'vecchio@test.it', password: temp } });
      check('login con la password provvisoria', lt.status === 200 && lt.data.user.password_da_cambiare === 1);
      check('hash provvisorio a costo 12', rounds('vecchio@test.it') === 12);
      const rp = await call('POST', `/users/${lt.data.user.id}/reset-password`, { token: mm, body: { password_nuova: 'Da-Admin-Password-9!' } });
      check('reset da pannello utenti', rp.status === 200);
      check('login dopo reset da pannello', (await call('POST', '/auth/login', { body: { email: 'vecchio@test.it', password: 'Da-Admin-Password-9!' } })).status === 200);
    }

    console.log('\n[Import CSV]');
    {
      const righe = ['nome,cognome,email,password,ruolo,sede'];
      for (let i = 0; i < 4; i++) righe.push(`Csv${i},Utente,csv${i}@test.it,Csv-Password-12345!,utente,`);
      righe.push('Mario,Rossi Aggiornato,mario@test.it,,utente,');
      righe.push('Senza,Password,senzapw@test.it,corta,utente,');
      const form = new FormData();
      form.append('file', new Blob([righe.join('\n')], { type: 'text/csv' }), 'utenti.csv');
      const imp = call('POST', '/users/import-csv', { token: mm, form });
      await new Promise((r) => setTimeout(r, 300));
      const hDurante = await call('GET', '/health');
      const r = await imp;
      check('import: 4 creati, 1 aggiornato, 1 errore', r.status === 200 && r.data.creati === 4 && r.data.aggiornati === 1 && r.data.errori.length === 1,
        JSON.stringify(r.data));
      check('import non blocca il server', hDurante.ms < 150, `/health in ${hDurante.ms.toFixed(0)} ms durante un import di ${r.ms.toFixed(0)} ms`);
      check('hash importati a costo 12', rounds('csv0@test.it') === 12 && rounds('csv3@test.it') === 12);
      check('login utente importato', (await call('POST', '/auth/login', { body: { email: 'csv2@test.it', password: 'Csv-Password-12345!' } })).status === 200);
    }

    console.log('\n[Anonimizzazione GDPR]');
    {
      // Utenti creati dal Mobility Manager: hanno la password provvisoria e le API
      // rispondono solo dopo il cambio. Qui simuliamo che l'abbiano già cambiata.
      { const d = apriDb(); d.prepare(`UPDATE users SET password_da_cambiare = 0 WHERE email = 'csv1@test.it'`).run(); d.close(); }
      const lu = await call('POST', '/auth/login', { body: { email: 'csv1@test.it', password: 'Csv-Password-12345!' } });
      await call('POST', '/privacy/cancellazione', { token: lu.data.token, body: { motivo: 'test' } });
      const el = await call('GET', '/privacy/cancellazioni', { token: mm });
      const rich = (el.data.richieste || []).find((x) => x.stato === 'in_attesa');
      const comp = await call('POST', `/privacy/cancellazioni/${rich.id}/completa`, { token: mm });
      check('anonimizzazione completata', comp.status === 200, `status ${comp.status}`);
      check('login dell\'utente anonimizzato rifiutato', (await call('POST', '/auth/login', { body: { email: 'csv1@test.it', password: 'Csv-Password-12345!' } })).status === 401);
      check('seconda conferma rifiutata', (await call('POST', `/privacy/cancellazioni/${rich.id}/completa`, { token: mm })).status === 400);
    }

    console.log('\n[Stato finale]');
    check('server ancora attivo', (await call('GET', '/health')).status === 200);
    check('nessun unhandled rejection o crash nei log', !/Unhandled|UnhandledPromiseRejection|ERR_/.test(log));
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) { console.log('\n--- log server ---\n' + log.slice(-3000)); process.exitCode = 1; }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
