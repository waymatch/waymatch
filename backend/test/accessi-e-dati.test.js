// Accessi e dati personali: sessioni oltre i limiti, cambio password, accettazione dei
// documenti per versione, import CSV con campi tra virgolette, anonimizzazione dei luoghi.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('accessi-e-dati');
const PORT = 4993;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body, form, ipFisso } = {}) {
  const headers = { 'X-Forwarded-For': ipFisso || `10.23.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method: metodo, headers, body: payload });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function apri() { const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`); return d; }
function sql(q, ...p) { const d = apri(); try { return d.prepare(q)[/^\s*select/i.test(q) ? 'get' : 'run'](...p); } finally { d.close(); } }
async function entra(email, password = PW) { return (await call('POST', '/auth/login', { body: { email, password } })).data?.token; }

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
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'Mo', cognome: 'Ma', email: 'mm@test.it', password: PW,
      sedi: [{ nome: 'Greenwich', indirizzo: 'Londra', lat: 51.48, lon: 0 }] } })).data.token;

    console.log('\n[Sedi]');
    check('una longitudine uguale a zero viene conservata', sql('SELECT lon FROM sedi WHERE nome = ?', 'Greenwich').lon === 0);

    console.log('\n[Import CSV: campi tra virgolette]');
    const f = new FormData();
    f.append('file', new Blob(['nome,cognome,email,password,ruolo,sede\nAnna,Neri,anna@test.it,"Password-Con,Virgola1",utente,Greenwich\n'], { type: 'text/csv' }), 'utenti.csv');
    const imp = await call('POST', '/users/import-csv', { token: mm, form: f });
    check('l\'utente è creato', imp.status === 200 && imp.data.creati === 1, JSON.stringify(imp.data));
    check('può accedere con la password che contiene la virgola', !!(await entra('anna@test.it', 'Password-Con,Virgola1')));
    const f2 = new FormData();
    f2.append('file', new Blob(['nome,cognome,email,password\nBea,Blu,bea@test.it,"Password-Valida-1!\naltro\n'], { type: 'text/csv' }), 'utenti.csv');
    const imp2 = await call('POST', '/users/import-csv', { token: mm, form: f2 });
    check('un campo tra virgolette non chiuso fa rifiutare il file', imp2.status === 400 && !sql("SELECT id FROM users WHERE email = 'bea@test.it'"), `${imp2.status} ${imp2.data?.error}`);
    sql("UPDATE users SET password_da_cambiare = 0 WHERE email = 'anna@test.it'");

    console.log('\n[Cambio password]');
    let anna = await entra('anna@test.it', 'Password-Con,Virgola1');
    const lunga = 'A1!' + 'x'.repeat(70);
    let r = await call('PUT', '/auth/me/password', { token: anna, body: { password_attuale: 'Password-Con,Virgola1', password_nuova: lunga } });
    check('una password oltre i 72 byte è rifiutata', r.status === 400 && /72/.test(r.data.error), `${r.status} ${r.data?.error}`);
    const tentativi = [];
    for (let i = 0; i < 6; i++) tentativi.push((await call('PUT', '/auth/me/password', { token: anna, body: { password_attuale: 'sbagliata', password_nuova: PW } })).status);
    // Il tentativo con la password troppo lunga conta già come fallito: 1 + 4 = 5, poi 429.
    check('dopo 5 tentativi falliti la password attuale non si può più provare', tentativi.slice(0, 4).every((s) => s === 400) && tentativi.slice(4).every((s) => s === 429), tentativi.join(','));

    console.log('\n[Sessioni oltre i limiti]');
    const t = await entra('mm@test.it');
    check('una sessione nuova funziona', (await call('GET', '/auth/me', { token: t })).status === 200);
    sql("UPDATE sessioni SET creata_il = datetime('now', '-31 days') WHERE user_id = (SELECT id FROM users WHERE email = 'mm@test.it') AND revocata = 0 AND creata_il = (SELECT MAX(creata_il) FROM sessioni WHERE user_id = (SELECT id FROM users WHERE email = 'mm@test.it'))");
    const scaduta = await call('GET', '/auth/me', { token: t });
    check('oltre i 30 giorni il token non vale più, anche se non è scaduto', scaduta.status === 401, String(scaduta.status));

    console.log('\n[Registro attività]');
    r = await call('GET', '/audit-log?limit=1.5', { token: mm });
    check('un limite non intero non causa un errore', r.status === 200, String(r.status));

    console.log('\n[Documenti da accettare]');
    const doc = (await call('POST', '/legal-documents', { token: mm, form: (() => { const g = new FormData(); g.append('titolo', 'Informativa'); g.append('contenuto', 'Testo'); g.append('formato', 'testo'); return g; })() })).data.documento;
    r = await call('POST', `/legal-documents/${doc.id}/accept`, { token: mm, body: { versione: doc.versione + 1 } });
    check('accettare una versione diversa da quella attuale dà conflitto', r.status === 409 && r.data.codice === 'VERSIONE_CAMBIATA', `${r.status}`);
    r = await call('POST', `/legal-documents/${doc.id}/accept`, { token: mm, body: {} });
    check('senza versione non si accetta', r.status === 409);
    r = await call('POST', `/legal-documents/${doc.id}/accept`, { token: mm, body: { versione: doc.versione } });
    check('la versione letta si accetta', r.status === 200);
    const fileAntes = require('fs').readdirSync(path.join(DIR, 'uploads', 'legal-documents')).length;
    const g = new FormData(); g.append('titolo', ''); g.append('formato', 'pdf'); g.append('file', new Blob(['%PDF-1.4 prova'], { type: 'application/pdf' }), 'x.pdf');
    r = await call('POST', '/legal-documents', { token: mm, form: g });
    await new Promise((res) => setTimeout(res, 200));
    const fileDopo = require('fs').readdirSync(path.join(DIR, 'uploads', 'legal-documents')).length;
    check('un PDF caricato con una richiesta rifiutata non resta su disco', r.status === 400 && fileDopo === fileAntes, `${r.status}, file ${fileAntes} → ${fileDopo}`);

    console.log('\n[Anonimizzazione: luoghi nei passaggi]');
    const annaId = sql("SELECT id FROM users WHERE email = 'anna@test.it'").id;
    sql(`INSERT INTO rides (driver_id, tipo, data, ora, punto_partenza, punto_arrivo, partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, geometria, note, citta_domicilio, km_stimati)
         VALUES (?, 'andata', '2020-01-01', '08:00', 'Via di Casa 1, Rho', 'Greenwich', 45.5, 9.0, 51.48, 0, '[[45.5,9]]', 'citofono Neri', 'Rho', 12)`, annaId);
    sql(`INSERT INTO recurring_rides (driver_id, tipo, giorni_settimana, ora, punto_partenza, punto_arrivo, arrivo_lat, arrivo_lon, data_inizio)
         VALUES (?, 'ritorno', '1', '18:00', 'Greenwich', 'Via di Casa 1, Rho', 45.5, 9.0, '2020-01-01')`, annaId);
    const rich = sql("INSERT INTO account_deletion_requests (user_id, motivo) VALUES (?, 'prova')", annaId).lastInsertRowid;
    r = await call('POST', `/privacy/cancellazioni/${rich}/completa`, { token: mm });
    check('la cancellazione riesce', r.status === 200, `${r.status} ${r.data?.error || ''}`);
    const ride = sql('SELECT * FROM rides WHERE driver_id = ?', annaId);
    check('passaggio: resta solo la città, senza coordinate, tracciato né note',
      ride.punto_partenza === 'Rho' && ride.partenza_lat === null && ride.geometria === null && ride.note === null, JSON.stringify(ride));
    check('passaggio: sede e km restano per i report', ride.punto_arrivo === 'Greenwich' && ride.km_stimati === 12);
    const turno = sql('SELECT * FROM recurring_rides WHERE driver_id = ?', annaId);
    check('turno fisso di ritorno: l\'arrivo diventa generico', turno.punto_arrivo === 'Indirizzo rimosso' && turno.arrivo_lat === null && turno.punto_partenza === 'Greenwich', JSON.stringify(turno));
  } finally {
    server.kill();
    if (esito.ko) console.log(log.slice(-1500));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
