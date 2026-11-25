// Log tecnico (JSON con livelli, segreti oscurati, eventi di sicurezza solo per l'IT) e filtri del
// log attività del Mobility Manager.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('log');
const PORT = 4976;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body } = {}) {
  const headers = { 'X-Forwarded-For': `10.33.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function sql(q, ...p) {
  const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
  try { return /^\s*select/i.test(q) ? d.prepare(q).all(...p) : d.prepare(q).run(...p); } finally { d.close(); }
}

function provaInProcesso() {
  console.log('\n[Modulo di log]');
  const scritte = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const cattura = (s) => { scritte.push(String(s)); return true; };
  delete require.cache[require.resolve(path.join(BACKEND, 'utils/structuredLog'))];
  const { log } = require(path.join(BACKEND, 'utils/structuredLog'));
  const prova = (livelloEnv, fn) => {
    scritte.length = 0;
    process.env.LOG_LEVEL = livelloEnv;
    process.stdout.write = cattura; process.stderr.write = cattura;
    try { fn(); } finally { process.stdout.write = out; process.stderr.write = err; delete process.env.LOG_LEVEL; }
    return scritte.map((r) => JSON.parse(r));
  };
  let righe = prova('', () => { log.info('a'); log.debug('b'); log.error('c', { errore: new Error('boom') }); });
  check('di norma si scrive da info in su (niente debug)', righe.map((r) => r.evento).join() === 'a,c');
  check('ogni riga è JSON con data, livello ed evento', righe.every((r) => r['@timestamp'] && r.livello && r.evento));
  check('un errore porta messaggio e stack', righe[1].errore?.messaggio === 'boom' && /Error: boom/.test(righe[1].errore?.stack || ''));
  righe = prova('warn', () => { log.info('a'); log.warn('b'); });
  check('LOG_LEVEL=warn tiene solo avvisi ed errori', righe.map((r) => r.evento).join() === 'b');
  righe = prova('debug', () => { log.debug('d', { password: 'x', dati: { token: 'y', authorization: 'z', nome: 'ok' } }); });
  check('LOG_LEVEL=debug scrive anche il debug, con i segreti oscurati', righe.length === 1 && righe[0].password === '[oscurato]'
    && righe[0].dati.token === '[oscurato]' && righe[0].dati.authorization === '[oscurato]' && righe[0].dati.nome === 'ok', JSON.stringify(righe[0]));
}

async function main() {
  provaInProcesso();
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const eventi = () => log.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const sicurezza = (evento) => eventi().filter((e) => e.area === 'sicurezza' && e.evento === evento);

  try {
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'Mo', cognome: 'Ma', email: 'mm@test.it', password: PW,
      sedi: [{ nome: 'Milano', indirizzo: 'Milano', lat: 45.46, lon: 9.18 }, { nome: 'Roma', indirizzo: 'Roma', lat: 41.9, lon: 12.5 }] } })).data.token;
    const [milano, roma] = sql('SELECT id FROM sedi ORDER BY id').map((s) => s.id);
    await call('POST', '/users', { token: mm, body: { nome: 'Ugo', cognome: 'Rossi', email: 'ugo@test.it', password: PW, sede_id: roma } });
    sql('UPDATE users SET password_da_cambiare = 0');

    console.log('\n[Eventi di sicurezza, solo nel log tecnico]');
    const sbagliata = 'Sbagliata-Segreta-999!';
    await call('POST', '/auth/login', { body: { email: 'nessuno@test.it', password: sbagliata } });
    await call('POST', '/auth/login', { body: { email: 'ugo@test.it', password: sbagliata } });
    const ugo = (await call('POST', '/auth/login', { body: { email: 'ugo@test.it', password: PW } })).data.token;
    await call('GET', '/audit-log', { token: ugo });
    await call('POST', '/auth/logout', { token: ugo });
    await new Promise((r) => setTimeout(r, 300));
    const fallitiSconosciuto = sicurezza('accesso_fallito').filter((e) => e.motivo === 'utente_sconosciuto');
    check('accesso con un utente sconosciuto: avviso con email e indirizzo', fallitiSconosciuto.length === 1 && fallitiSconosciuto[0].livello === 'warn'
      && fallitiSconosciuto[0].email === 'nessuno@test.it' && !!fallitiSconosciuto[0].ip);
    check('password sbagliata: avviso con l\'utente e il numero di tentativi', sicurezza('accesso_fallito').some((e) => e.motivo === 'password_errata' && e.tentativi === 1));
    check('accesso riuscito registrato (il Mobility Manager è entrato con il setup)', sicurezza('accesso_riuscito').length === 1);
    check('accesso negato a una pagina del Mobility Manager registrato', sicurezza('accesso_negato').some((e) => e.percorso === '/api/audit-log' && e.ruolo === 'utente'));
    check('uscita registrata', sicurezza('uscita').length === 1);
    check('nessuna password nel log, nemmeno quelle sbagliate', !log.includes(sbagliata) && !log.includes(PW));
    const azioniMm = (await call('GET', '/audit-log?limit=500', { token: mm })).data.log.map((l) => l.azione);
    check('il log attività del Mobility Manager non contiene gli accessi dei colleghi', !azioniMm.some((a) => /accesso|uscita|login/.test(a)), azioniMm.join(','));

    console.log('\n[Filtri del log attività]');
    await call('PUT', '/branding', { token: mm, body: { company_name: 'Acme %_ Spa' } });
    await call('POST', '/sedi', { token: mm, body: { nome: 'Torino', indirizzo: 'Torino' } });
    await call('PUT', '/gamification', { token: mm, body: { attiva: true } });
    const ugo2 = (await call('POST', '/auth/login', { body: { email: 'ugo@test.it', password: PW } })).data.token;
    await call('POST', '/privacy/cancellazione', { token: ugo2, body: { motivo: 'prova' } });
    const filtra = async (q) => (await call('GET', `/audit-log?${q}`, { token: mm })).data.log;
    let r = await filtra('area=impostazioni');
    check('area «impostazioni»: solo azioni su impostazioni e sedi', r.length >= 2 && r.every((l) => /^(impostazioni|branding|logo|icona_app|sede|cluster)_/.test(l.azione)), r.map((l) => l.azione).join());
    r = await filtra('area=punti');
    check('area «punti»: l\'accensione della gamification', r.some((l) => l.azione === 'gamification_attivata') && r.every((l) => /^(punti|punteggi|regola_punteggio|gamification)_/.test(l.azione)));
    r = await filtra('area=privacy');
    check('area «privacy»: la richiesta di cancellazione', r.length === 1 && r[0].azione === 'richiesta_cancellazione_creata');
    r = await filtra(`sede_id=${roma}`);
    check('sede: solo azioni di chi lavora in quella sede', r.length >= 1 && r.every((l) => l.sede_nome === 'Roma'), r.map((l) => l.sede_nome).join());
    check('nessun risultato per una sede senza azioni', (await filtra(`sede_id=${milano}`)).length === 0);
    r = await filtra('q=Torino');
    check('ricerca libera nei dettagli', r.length === 1 && r[0].azione === 'sede_creata');
    r = await filtra(`q=${encodeURIComponent('%_')}`);
    check('% e _ si cercano come caratteri, non come jolly', r.length === 1 && r[0].azione === 'branding_modificato', r.map((l) => l.azione).join());
    r = await filtra('q=Rossi');
    check('ricerca per nome di chi ha agito (o nei dettagli)', r.some((l) => l.cognome === 'Rossi') && r.every((l) => l.cognome === 'Rossi' || /Rossi/.test(l.dettagli || '')));
    const oggi = new Date(); const g = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const domani = new Date(oggi); domani.setDate(domani.getDate() + 1);
    check('periodo che comprende oggi: tutto', (await filtra(`dal=${g(oggi)}&al=${g(oggi)}`)).length === (await filtra('')).length);
    check('periodo da domani: niente', (await filtra(`dal=${g(domani)}`)).length === 0);
    check('una data non valida si ignora', (await filtra('dal=ieri')).length === (await filtra('')).length);
    const xlsx = await fetch(`${API}/audit-log/export/xlsx?area=privacy`, { headers: { Authorization: `Bearer ${mm}`, 'X-Forwarded-For': '10.33.1.1' } });
    const ExcelJS = require(path.join(BACKEND, 'node_modules/exceljs'));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
    const righe = []; wb.getWorksheet('Log attività').eachRow((riga) => righe.push(riga.values.slice(1)));
    check('l\'export usa gli stessi filtri', righe.length === 2 && righe[1][2] === 'richiesta_cancellazione_creata' && righe[1][4] === 'Roma', JSON.stringify(righe));
  } finally {
    server.kill();
    if (esito.ko) console.log(log.slice(-3000));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
