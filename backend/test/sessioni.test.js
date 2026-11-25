// Verifica delle sessioni rinnovabili e revocabili su un'istanza isolata.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { BACKEND, cartellaProva } = require('./ambiente');
const jwt = require(path.join(BACKEND, 'node_modules/jsonwebtoken'));
const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3-multiple-ciphers'));

const DIR = cartellaProva('sessioni');

const PORT = 4998;
const BASE = `http://127.0.0.1:${PORT}/api`;
const DB_KEY = crypto.randomBytes(32).toString('hex');
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const PW = 'Password-Valida-123!';
const UA_TEL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

let esito = { ok: 0, ko: 0 };
function check(nome, cond, extra = '') {
  if (cond) { esito.ok++; console.log(`  OK   ${nome}${extra ? ' — ' + extra : ''}`); }
  else { esito.ko++; console.log(`  FAIL ${nome}${extra ? ' — ' + extra : ''}`); }
}

let ip = 1;
async function call(metodo, p, { body, token, cookie, ua, proto } = {}) {
  const headers = { 'X-Forwarded-For': `10.1.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (ua) headers['User-Agent'] = ua;
  if (proto) headers['X-Forwarded-Proto'] = proto;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + p, { method: metodo, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  const setCookie = r.headers.getSetCookie().find((c) => c.startsWith('cp_rinnovo=')) || null;
  return { status: r.status, data, setCookie, cookie: setCookie ? setCookie.split(';')[0] : null };
}
async function accedi(email, password = PW, ua = UA_PC, proto) {
  const r = await call('POST', '/auth/login', { body: { email, password }, ua, proto });
  return { token: r.data && r.data.token, cookie: r.cookie, setCookie: r.setCookie, status: r.status };
}
function db() {
  const d = new Database(path.join(DIR, 'data', 'carpooling.db'));
  d.pragma(`key='${DB_KEY}'`);
  return d;
}
const decodifica = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET, DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
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
    console.log('\n[Login e cookie di rinnovo]');
    const setup = await call('POST', '/setup', { body: { company_name: 'T', nome: 'Admin', cognome: 'MM', email: 'mm@test.it', password: PW } });
    check('il setup crea una sessione e imposta il cookie', setup.status === 200 && !!setup.cookie && !!decodifica(setup.data.token).jti);
    const mm = setup.data.token;
    for (const [n, e] of [['Anna', 'anna@test.it'], ['Bruno', 'bruno@test.it'], ['Carla', 'carla@test.it']]) {
      await call('POST', '/users', { token: mm, body: { nome: n, cognome: 'Test', email: e, password: PW } });
    }
    // Utenti creati dal Mobility Manager: hanno la password provvisoria e le API
    // rispondono solo dopo il cambio. Qui simuliamo che l'abbiano già cambiata.
    { const d = db(); d.prepare('UPDATE users SET password_da_cambiare = 0').run(); d.close(); }

    const a1 = await accedi('anna@test.it', PW, UA_PC);
    const p = decodifica(a1.token);
    check('token con id sessione (jti) e durata 8 ore', !!p.jti && p.exp - p.iat === 28800);
    check('cookie httpOnly, SameSite=Strict, path /api/auth, 30 giorni',
      /HttpOnly/i.test(a1.setCookie) && /SameSite=Strict/i.test(a1.setCookie) && /Path=\/api\/auth/i.test(a1.setCookie) && /Max-Age=2592000/.test(a1.setCookie),
      a1.setCookie.replace(/cp_rinnovo=[^;]+/, 'cp_rinnovo=…'));
    check('cookie senza Secure su HTTP diretto', !/Secure/i.test(a1.setCookie));
    const aHttps = await accedi('anna@test.it', PW, UA_PC, 'https');
    check('cookie Secure dietro proxy HTTPS', /Secure/i.test(aHttps.setCookie));
    {
      const d = db();
      const riga = d.prepare('SELECT * FROM sessioni WHERE id = ?').get(p.jti);
      d.close();
      const segreto = decodeURIComponent(a1.cookie.split('=')[1]);
      check('nel database solo l\'hash del segreto', riga && riga.segreto_hash === crypto.createHash('sha256').update(segreto).digest('hex') && !JSON.stringify(riga).includes(segreto));
    }

    console.log('\n[Rinnovo]');
    const r1 = await call('POST', '/auth/rinnova', { cookie: a1.cookie });
    check('rinnovo con cookie valido', r1.status === 200 && !!r1.data.token);
    check('il nuovo token appartiene alla stessa sessione', decodifica(r1.data.token).jti === p.jti);
    check('il token rinnovato funziona', (await call('GET', '/auth/me', { token: r1.data.token })).status === 200);
    check('rinnovo senza cookie rifiutato', (await call('POST', '/auth/rinnova')).status === 401);
    check('rinnovo con cookie inventato rifiutato', (await call('POST', '/auth/rinnova', { cookie: 'cp_rinnovo=' + 'a'.repeat(64) })).status === 401);
    const scaduto = jwt.sign({ id: p.id, v: 0, jti: p.jti, iat: Math.floor(Date.now() / 1000) - 9 * 3600, exp: Math.floor(Date.now() / 1000) - 3600 }, JWT_SECRET);
    check('token scaduto rifiutato', (await call('GET', '/auth/me', { token: scaduto })).status === 401);
    const dopoScadenza = await call('POST', '/auth/rinnova', { cookie: a1.cookie });
    check('dopo la scadenza del token il cookie lo rinnova (caso "ritorno serale")', dopoScadenza.status === 200 && (await call('GET', '/auth/me', { token: dopoScadenza.data.token })).status === 200);
    const vecchioStile = jwt.sign({ id: p.id, v: 0 }, JWT_SECRET, { expiresIn: '30d' });
    check('token emesso prima delle sessioni (senza jti) rifiutato', (await call('GET', '/auth/me', { token: vecchioStile })).status === 401);

    console.log('\n[Inattività e durata massima]');
    {
      const s = await accedi('anna@test.it');
      const jti = decodifica(s.token).jti;
      let d = db(); d.prepare(`UPDATE sessioni SET ultimo_uso = datetime('now', '-6 days') WHERE id = ?`).run(jti); d.close();
      check('6 giorni di inattività: rinnovo ancora possibile', (await call('POST', '/auth/rinnova', { cookie: s.cookie })).status === 200);
      d = db(); d.prepare(`UPDATE sessioni SET ultimo_uso = datetime('now', '-8 days') WHERE id = ?`).run(jti); d.close();
      check('8 giorni di inattività: rinnovo rifiutato', (await call('POST', '/auth/rinnova', { cookie: s.cookie })).status === 401);
      const s2 = await accedi('anna@test.it');
      const jti2 = decodifica(s2.token).jti;
      d = db(); d.prepare(`UPDATE sessioni SET creata_il = datetime('now', '-31 days') WHERE id = ?`).run(jti2); d.close();
      check('sessione di 31 giorni usata ogni giorno: rinnovo rifiutato', (await call('POST', '/auth/rinnova', { cookie: s2.cookie })).status === 401);
      const rifiutato = await call('POST', '/auth/rinnova', { cookie: s2.cookie });
      check('il rinnovo rifiutato cancella il cookie', rifiutato.setCookie && /Expires=Thu, 01 Jan 1970/i.test(rifiutato.setCookie));
    }

    console.log('\n[Ultimo uso]');
    {
      const s = await accedi('anna@test.it');
      const jti = decodifica(s.token).jti;
      let d = db(); d.prepare(`UPDATE sessioni SET ultimo_uso = datetime('now', '-1 hour') WHERE id = ?`).run(jti); d.close();
      await call('GET', '/auth/me', { token: s.token });
      d = db(); const u = d.prepare(`SELECT ultimo_uso > datetime('now', '-1 minute') AS recente FROM sessioni WHERE id = ?`).get(jti); d.close();
      check('una richiesta aggiorna l\'ultimo uso', u.recente === 1);
    }

    console.log('\n[Elenco e revoca dei dispositivi]');
    const telefono = await accedi('bruno@test.it', PW, UA_TEL);
    const pc = await accedi('bruno@test.it', PW, UA_PC);
    const el = await call('GET', '/auth/sessioni', { token: pc.token });
    check('elenco con 2 dispositivi', el.status === 200 && el.data.sessioni.length === 2, `${el.data.sessioni.length} sessioni`);
    check('dispositivo corrente segnato', el.data.sessioni.filter((s) => s.corrente).length === 1 && el.data.sessioni.find((s) => s.corrente).id === decodifica(pc.token).jti);
    check('elenco senza hash del segreto', !JSON.stringify(el.data).includes('segreto'));
    const idTel = decodifica(telefono.token).jti;
    check('un utente non può revocare la sessione di un altro', (await call('DELETE', `/auth/sessioni/${idTel}`, { token: a1.token && r1.data.token })).status === 404);
    check('revoca del telefono dal PC', (await call('DELETE', `/auth/sessioni/${idTel}`, { token: pc.token })).status === 200);
    check('il token del telefono smette di valere subito', (await call('GET', '/auth/me', { token: telefono.token })).status === 401);
    check('il telefono non può rinnovare', (await call('POST', '/auth/rinnova', { cookie: telefono.cookie })).status === 401);
    check('il PC resta collegato', (await call('GET', '/auth/me', { token: pc.token })).status === 200);

    console.log('\n[Logout]');
    {
      const s = await accedi('carla@test.it');
      const out = await call('POST', '/auth/logout', { token: s.token, cookie: s.cookie });
      check('logout ok e cookie cancellato', out.status === 200 && /Expires=Thu, 01 Jan 1970/i.test(out.setCookie || ''));
      check('dopo il logout il token non vale', (await call('GET', '/auth/me', { token: s.token })).status === 401);
      check('dopo il logout il cookie non rinnova', (await call('POST', '/auth/rinnova', { cookie: s.cookie })).status === 401);
      const s2 = await accedi('carla@test.it');
      const p2 = decodifica(s2.token);
      const tokScaduto = jwt.sign({ id: p2.id, v: p2.v, jti: p2.jti, iat: p2.iat - 9 * 3600, exp: p2.iat - 3600 }, JWT_SECRET);
      await call('POST', '/auth/logout', { token: tokScaduto });
      check('logout con token scaduto e senza cookie chiude la sessione', (await call('POST', '/auth/rinnova', { cookie: s2.cookie })).status === 401);
      const falso = jwt.sign({ id: p2.id, jti: decodifica(pc.token).jti }, 'chiave-sbagliata');
      await call('POST', '/auth/logout', { token: falso });
      check('logout con token di firma falsa non chiude sessioni altrui', (await call('GET', '/auth/me', { token: pc.token })).status === 200);
    }

    console.log('\n[Esci da tutti gli altri dispositivi]');
    {
      const x1 = await accedi('carla@test.it', PW, UA_TEL);
      const x2 = await accedi('carla@test.it', PW, UA_PC);
      const x3 = await accedi('carla@test.it', PW, UA_PC);
      const r = await call('POST', '/auth/esci-ovunque', { token: x3.token });
      check('esci-ovunque ok con nuovo token', r.status === 200 && !!r.data.token);
      check('altri dispositivi: token rifiutati', (await call('GET', '/auth/me', { token: x1.token })).status === 401 && (await call('GET', '/auth/me', { token: x2.token })).status === 401);
      check('altri dispositivi: rinnovo rifiutato', (await call('POST', '/auth/rinnova', { cookie: x1.cookie })).status === 401);
      check('vecchio token di questo dispositivo rifiutato (versione alzata)', (await call('GET', '/auth/me', { token: x3.token })).status === 401);
      check('nuovo token di questo dispositivo valido', (await call('GET', '/auth/me', { token: r.data.token })).status === 200);
      const rinn = await call('POST', '/auth/rinnova', { cookie: x3.cookie });
      check('questo dispositivo continua a rinnovare', rinn.status === 200 && (await call('GET', '/auth/me', { token: rinn.data.token })).status === 200);
      const el2 = await call('GET', '/auth/sessioni', { token: r.data.token });
      check('ora resta una sola sessione', el2.data.sessioni.length === 1);
    }

    console.log('\n[Cambio e reset password]');
    {
      const altro = await accedi('anna@test.it', PW, UA_TEL);
      const qui = await accedi('anna@test.it', PW, UA_PC);
      const nuova = 'Altra-Password-789!';
      const c = await call('PUT', '/auth/me/password', { token: qui.token, body: { password_attuale: PW, password_nuova: nuova } });
      check('cambio password ok', c.status === 200);
      check('cambio password: l\'altro dispositivo non rinnova', (await call('POST', '/auth/rinnova', { cookie: altro.cookie })).status === 401);
      const rq = await call('POST', '/auth/rinnova', { cookie: qui.cookie });
      check('cambio password: questo dispositivo resta collegato e rinnova', (await call('GET', '/auth/me', { token: c.data.token })).status === 200 && rq.status === 200);

      const b = await accedi('bruno@test.it', PW, UA_TEL);
      const idBruno = decodifica(b.token).id;
      check('reset dal Mobility Manager', (await call('POST', `/users/${idBruno}/reset-password`, { token: mm, body: { password_nuova: 'Reset-Admin-Pass-1!' } })).status === 200);
      check('reset: tutte le sessioni chiuse', (await call('POST', '/auth/rinnova', { cookie: b.cookie })).status === 401 && (await call('POST', '/auth/rinnova', { cookie: pc.cookie })).status === 401);

      const tokenChiaro = crypto.randomBytes(32).toString('hex');
      const s = await accedi('anna@test.it', nuova);
      const d = db();
      const uid = d.prepare(`SELECT id FROM users WHERE email = 'anna@test.it'`).get().id;
      d.prepare(`INSERT INTO password_reset_tokens (user_id, token_hash, scade_il) VALUES (?, ?, datetime('now', '+2 hours'))`)
        .run(uid, crypto.createHash('sha256').update(tokenChiaro).digest('hex'));
      d.close();
      check('reset via link', (await call('POST', '/auth/reimposta-password', { body: { token: tokenChiaro, password_nuova: 'Link-Reset-Pass-22!' } })).status === 200);
      check('reset via link: tutte le sessioni chiuse', (await call('POST', '/auth/rinnova', { cookie: s.cookie })).status === 401 && (await call('POST', '/auth/rinnova', { cookie: qui.cookie })).status === 401);
    }

    console.log('\n[Utente disattivato]');
    {
      const s = await accedi('carla@test.it');
      const id = decodifica(s.token).id;
      await call('PUT', `/users/${id}`, { token: mm, body: { nome: 'Carla', cognome: 'Test', email: 'carla@test.it', ruolo: 'utente', attivo: 0 } });
      check('utente disattivato: token rifiutato', (await call('GET', '/auth/me', { token: s.token })).status === 401);
      check('utente disattivato: rinnovo rifiutato', (await call('POST', '/auth/rinnova', { cookie: s.cookie })).status === 401);
    }

    console.log('\n[Stato finale]');
    check('server attivo', (await call('GET', '/health')).status === 200);
    check('nessun crash nei log', !/Unhandled|TypeError|ReferenceError|SqliteError/.test(log));
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\n[Pulizia giornaliera]');
  {
    const d = db();
    const prima = d.prepare('SELECT COUNT(*) n FROM sessioni').get().n;
    const vive = d.prepare(`SELECT COUNT(*) n FROM sessioni WHERE revocata = 0 AND ultimo_uso > datetime('now','-7 days') AND creata_il > datetime('now','-30 days')`).get().n;
    d.close();
    process.env.DATA_DIR = path.join(DIR, 'data');
    process.env.DB_ENCRYPTION_KEY = DB_KEY;
    const { pulisciSessioniScadute } = require(path.join(BACKEND, 'utils/sessioni.js'));
    const rimosse = pulisciSessioniScadute();
    const d2 = db();
    const dopo = d2.prepare('SELECT COUNT(*) n FROM sessioni').get().n;
    d2.close();
    check('restano solo le sessioni vive', dopo === vive && rimosse === prima - vive, `${prima} → ${dopo} (rimosse ${rimosse})`);
  }

  console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
  if (esito.ko) { console.log('\n--- log server ---\n' + log.split('\n').filter((l) => !l.startsWith('{"@timestamp')).join('\n').slice(-3000)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
