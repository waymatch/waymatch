// Gamification facoltativa: spenta sulle installazioni nuove, accesa su quelle già in uso, nessun
// punto assegnato e nessun riscatto con l'opzione spenta.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('gamification');
const PORT = 4978;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');
const ENV = { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
  JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' };

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body } = {}) {
  const headers = { 'X-Forwarded-For': `10.31.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function sql(q, ...p) {
  const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
  try { return /^\s*select|^\s*pragma/i.test(q) ? d.prepare(q).all(...p) : d.prepare(q).run(...p); } finally { d.close(); }
}
async function avvia() {
  const server = spawn('node', ['server.js'], { cwd: BACKEND, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  return { server, log: () => log };
}
const ferma = (s) => new Promise((r) => { s.server.on('exit', r); s.server.kill(); });
function domaniFeriale() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  let s = await avvia();
  try {
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'Mo', cognome: 'Ma', email: 'mm@test.it', password: PW,
      sedi: [{ nome: 'Sede', indirizzo: 'Milano', lat: 45.46, lon: 9.18 }] } })).data.token;
    const sedeId = sql('SELECT id FROM sedi')[0].id;
    await call('POST', '/users', { token: mm, body: { nome: 'Ugo', cognome: 'U', email: 'ugo@test.it', password: PW, sede_id: sedeId } });
    sql('UPDATE users SET password_da_cambiare = 0');
    const ugo = (await call('POST', '/auth/login', { body: { email: 'ugo@test.it', password: PW } })).data.token;
    const ugoId = sql("SELECT id FROM users WHERE email = 'ugo@test.it'")[0].id;
    await call('PUT', '/point-rules/offerta_creata', { token: mm, body: { punti: 5, attivo: true } });
    const punti = () => sql('SELECT COALESCE(SUM(punti), 0) n FROM points_log WHERE user_id = ?', ugoId)[0].n;
    const offri = (ora) => call('POST', '/rides', { token: ugo, body: { tipo: 'andata', data: domaniFeriale(), ora_andata: ora,
      punto_partenza: 'Via Roma 1, Rho', km_stimati_andata: 10, posti_totali: 2 } });

    console.log('\n[Installazione nuova: gamification spenta]');
    check('il branding dice che è spenta', (await call('GET', '/branding')).data.branding.gamification === false);
    let r = await offri('08:00');
    check('un passaggio offerto non dà punti', r.status === 200 && punti() === 0, `${r.status}, ${punti()}`);
    r = await call('GET', '/rewards', { token: ugo });
    check('la pagina premi non è disponibile', r.status === 403 && r.data.codice === 'GAMIFICATION_DISATTIVATA', String(r.status));
    const premio = (await call('POST', '/rewards', { token: mm, body: { nome: 'Caffè', punti_richiesti: 1 } })).data.reward;
    r = await call('POST', `/rewards/${premio.id}/redeem`, { token: ugo });
    check('nessun riscatto', r.status === 403, String(r.status));
    r = await call('GET', '/points/classifica', { token: ugo });
    check('nessuna classifica', r.status === 403, String(r.status));
    r = await call('GET', '/contests', { token: ugo });
    check('nessun contest', r.status === 403, String(r.status));
    r = await call('POST', '/point-rules/manual-award', { token: mm, body: { user_id: ugoId, punti: 10, motivo: 'prova' } });
    check('il Mobility Manager non assegna punti a mano', r.status === 403, String(r.status));
    r = await call('GET', '/notification-prefs', { token: ugo });
    const categorie = (r.data.categorie || []).map((c) => c.chiave);
    check('tra le notifiche non c\'è la categoria dei premi', categorie.length > 0 && !categorie.includes('premi'), categorie.join(','));

    console.log('\n[Interruttore]');
    r = await call('PUT', '/gamification', { token: ugo, body: { attiva: true } });
    check('solo il Mobility Manager la cambia', r.status === 403, String(r.status));
    r = await call('PUT', '/gamification', { token: mm, body: { attiva: 'sì' } });
    check('un valore non booleano è rifiutato', r.status === 400, String(r.status));
    r = await call('PUT', '/gamification', { token: mm, body: { attiva: true } });
    check('il Mobility Manager la attiva', r.status === 200 && r.data.attiva === true
      && (await call('GET', '/branding')).data.branding.gamification === true);
    r = await offri('09:00');
    check('attiva, un passaggio offerto dà i punti della regola', r.status === 200 && punti() === 5, `${r.status}, ${punti()}`);
    check('la pagina premi è disponibile', (await call('GET', '/rewards', { token: ugo })).status === 200);
    check('il riscatto funziona', (await call('POST', `/rewards/${premio.id}/redeem`, { token: ugo })).status === 200);
    r = await call('PUT', '/gamification', { token: mm, body: { attiva: false } });
    check('spenta di nuovo, il riscatto in attesa resta da gestire', r.status === 200 && r.data.attiva === false && r.data.riscatti_in_attesa === 1, JSON.stringify(r.data));
    check('i punti già accumulati restano nello storico', punti() === 5);
    r = await call('GET', '/notification-prefs', { token: ugo });
    check('con un riscatto ancora aperto gli avvisi sui premi restano configurabili', (r.data.categorie || []).some((c) => c.chiave === 'premi'));
    r = await offri('10:00');
    check('e i nuovi passaggi non ne danno', r.status === 200 && punti() === 5, `${r.status}, ${punti()}`);
    check('l\'azione è nel log attività', sql("SELECT COUNT(*) n FROM audit_log WHERE azione IN ('gamification_attivata', 'gamification_disattivata')")[0].n === 2);

    console.log('\n[Azzeramento dei punteggi]');
    await call('PUT', '/gamification', { token: mm, body: { attiva: true } });
    const saldo = async () => (await call('GET', '/rewards', { token: ugo })).data.punti_disponibili;
    const riscatto1 = sql('SELECT id FROM reward_redemptions ORDER BY id DESC LIMIT 1')[0].id;
    r = await call('GET', '/gamification', { token: mm });
    check('prima: una persona con punti e un riscatto in attesa', r.data.utenti_con_punti === 1 && r.data.riscatti_in_attesa === 1 && await saldo() === 4,
      JSON.stringify(r.data));
    r = await call('POST', '/gamification/azzera', { token: ugo, body: { premi: 'tieni', conferma: true } });
    check('solo il Mobility Manager azzera', r.status === 403, String(r.status));
    r = await call('POST', '/gamification/azzera', { token: mm, body: { premi: 'tieni' } });
    check('senza conferma esplicita non si azzera', r.status === 400 && await saldo() === 4, String(r.status));
    r = await call('POST', '/gamification/azzera', { token: mm, body: { premi: 'boh', conferma: true } });
    check('una scelta sui premi non valida è rifiutata', r.status === 400, String(r.status));
    r = await call('POST', '/gamification/azzera', { token: mm, body: { premi: 'tieni', conferma: true } });
    check('azzerati: il saldo torna a zero', r.status === 200 && await saldo() === 0 && r.data.utenti_con_punti === 0, JSON.stringify(r.data));
    check('il premio chiesto prima resta da consegnare', sql('SELECT stato FROM reward_redemptions WHERE id = ?', riscatto1)[0].stato === 'in_attesa');
    check('lo storico resta', sql('SELECT COUNT(*) n FROM points_log WHERE user_id = ?', ugoId)[0].n === 1);
    // Un movimento della generazione precedente con la stessa data dell'azzeramento (stesso millisecondo).
    const az = sql('SELECT punti_azzerati_il d, generazione_punti g FROM system_settings')[0];
    sql("INSERT INTO points_log (user_id, tipo_evento, punti, created_at, generazione) VALUES (?, 'prova', 7, ?, ?)", ugoId, az.d, az.g - 1);
    check('un movimento di prima dell\'azzeramento non conta, anche con la stessa data', await saldo() === 0, String(await saldo()));
    sql("DELETE FROM points_log WHERE tipo_evento = 'prova'");
    r = await call('GET', '/points/classifica', { token: ugo });
    check('la classifica riparte da zero', r.data.classifica.every((u) => u.punti === 0), JSON.stringify(r.data.classifica.map((u) => u.punti)));
    await call('PUT', `/rewards/redemptions/${riscatto1}`, { token: mm, body: { stato: 'rifiutato' } });
    check('rifiutare un riscatto chiesto prima dell\'azzeramento non ridà punti', await saldo() === 0);
    check('e l\'avviso lo dice', /azzerati/.test(sql("SELECT messaggio FROM notifications WHERE tipo = 'riscatto_rifiutato' ORDER BY id DESC LIMIT 1")[0]?.messaggio || ''));
    r = await offri('11:00');
    check('i punti guadagnati subito dopo l\'azzeramento contano', r.status === 200 && await saldo() === 5, String(await saldo()));
    const riscatto2 = (await call('POST', `/rewards/${premio.id}/redeem`, { token: ugo })).data.redemption_id;
    await call('PUT', `/rewards/redemptions/${riscatto2}`, { token: mm, body: { stato: 'rifiutato' } });
    check('un riscatto chiesto dopo l\'azzeramento si rimborsa come sempre', await saldo() === 5, String(await saldo()));
    const riscatto3 = (await call('POST', `/rewards/${premio.id}/redeem`, { token: ugo })).data.redemption_id;
    await call('PUT', `/rewards/redemptions/${riscatto3}`, { token: mm, body: { stato: 'approvato' } });
    r = await call('POST', '/gamification/azzera', { token: mm, body: { premi: 'annulla', conferma: true } });
    check('azzerando si possono annullare i premi non consegnati', r.status === 200 && r.data.annullati === 1
      && sql('SELECT stato FROM reward_redemptions WHERE id = ?', riscatto3)[0].stato === 'annullato', JSON.stringify(r.data));
    check('chi l\'aveva chiesto riceve un avviso', sql("SELECT COUNT(*) n FROM notifications WHERE tipo = 'riscatto_annullato' AND user_id = ?", ugoId)[0].n === 1);
    r = await call('PUT', `/rewards/redemptions/${riscatto3}`, { token: mm, body: { stato: 'consegnato' } });
    check('un premio annullato non si consegna più', r.status === 400, String(r.status));
    check('i due azzeramenti sono nel log attività', sql("SELECT COUNT(*) n FROM audit_log WHERE azione = 'punteggi_azzerati'")[0].n === 2);
    const xlsx = await fetch(`${API}/gamification/riscatti.xlsx`, { headers: { Authorization: `Bearer ${mm}`, 'X-Forwarded-For': '10.31.1.1' } });
    const ExcelJS = require(path.join(BACKEND, 'node_modules/exceljs'));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
    const righe = []; wb.getWorksheet('Riscatti').eachRow((riga) => righe.push(riga.values.slice(1)));
    check('l\'elenco dei riscatti si scarica in Excel, con tutti i riscatti e il loro stato', xlsx.status === 200 && righe.length === 4
      && righe.some((x) => x[1] === 'Annullato') && righe.some((x) => x[1] === 'Rifiutato'), `${xlsx.status}, ${righe.length}`);
    r = await fetch(`${API}/gamification/riscatti.xlsx`, { headers: { Authorization: `Bearer ${ugo}`, 'X-Forwarded-For': '10.31.1.2' } });
    check('l\'elenco è solo per il Mobility Manager', r.status === 403, String(r.status));

    console.log('\n[Installazioni già in uso prima di questa opzione]');
    await ferma(s);
    sql('ALTER TABLE system_settings DROP COLUMN gamification_attiva');
    s = await avvia();
    check('un\'installazione già configurata la trova accesa', (await call('GET', '/branding')).data.branding.gamification === true);
  } finally {
    s.server.kill();
    if (esito.ko) console.log(s.log().slice(-2000));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
