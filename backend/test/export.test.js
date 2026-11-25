// Verifica S25: testi malevoli negli export Excel su un'istanza isolata.
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BACKEND, cartellaProva } = require('./ambiente');
const req = require('module').createRequire(BACKEND + '/server.js');
const ExcelJS = req('exceljs');
const Database = req('better-sqlite3-multiple-ciphers');
const { neutralizzaFormula } = require(BACKEND + '/utils/export.js');

const DIR = cartellaProva('export');
const PORT = 4995, BASE = `http://127.0.0.1:${PORT}/api`;
const DB_KEY = crypto.randomBytes(32).toString('hex');
const PW = 'Password-Valida-123!';

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
let ip = 1;
async function api(metodo, p, { token, body } = {}) {
  const headers = { 'X-Forwarded-For': `10.5.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method: metodo, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${metodo} ${p} → ${r.status} ${await r.text()}`);
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : Buffer.from(await r.arrayBuffer());
}
async function leggiXlsx(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const fogli = {};
  wb.eachSheet((ws) => {
    fogli[ws.name] = [];
    ws.eachRow((row) => { const r = []; row.eachCell({ includeEmpty: true }, (c) => r.push({ v: c.value, formula: c.type === ExcelJS.ValueType.Formula })); fogli[ws.name].push(r); });
  });
  return fogli;
}

const MALEVOLI = ['=HYPERLINK("http://evil.example","clic")', '+1+1', '-2+3', '@SUM(1)', '\t=1', '\r=1'];

(async () => {
  console.log('\n[Regola]');
  for (const m of MALEVOLI) check(`neutralizza ${JSON.stringify(m)}`, neutralizzaFormula(m) === `'${m}`);
  for (const ok of ['normale', 'Mario Rossi', '2026-11-16 10:00:00', 'a=b', '', "'già con apice"]) check(`lascia invariato ${JSON.stringify(ok)}`, neutralizzaFormula(ok) === ok);
  check('i numeri restano numeri (anche negativi)', neutralizzaFormula(-5) === -5 && neutralizzaFormula(3.2) === 3.2);
  check('null e undefined invariati', neutralizzaFormula(null) === null && neutralizzaFormula(undefined) === undefined);

  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  try {
    const mm = (await api('POST', '/setup', { body: { company_name: '=Azienda', nome: 'Admin', cognome: 'MM', email: 'mm@test.it', password: PW } })).token;
    // Utente con nome malevolo creato dal Mobility Manager; motivo malevolo scritto dall'utente stesso.
    await api('POST', '/users', { token: mm, body: { nome: '=HYPERLINK("http://evil.example","clic")', cognome: 'X', email: 'x@test.it', password: PW } });
    // Utenti creati dal Mobility Manager: hanno la password provvisoria e le API
    // rispondono solo dopo il cambio. Qui simuliamo che l'abbiano già cambiata.
    { const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`); d.prepare(`UPDATE users SET password_da_cambiare = 0 WHERE email = 'x@test.it'`).run(); d.close(); }
    const ux = (await api('POST', '/auth/login', { body: { email: 'x@test.it', password: PW } })).token;
    await api('POST', '/privacy/cancellazione', { token: ux, body: { motivo: '@SUM(1+1)' } });

    // Sede con nome malevolo e un viaggio completato con un passeggero, per avere righe "Per sede".
    const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
    const sede = d.prepare(`INSERT INTO sedi (nome) VALUES ('+Sede malevola')`).run().lastInsertRowid;
    d.prepare(`UPDATE users SET auto_alimentazione = 'benzina' WHERE id = 1`).run();
    const ride = d.prepare(`INSERT INTO rides (driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo, km_stimati, stato)
      VALUES (1, ?, 'andata', '2026-11-10', '08:00', 'A', 'B', 20, 'completato')`).run(sede).lastInsertRowid;
    d.prepare(`INSERT INTO bookings (ride_id, passenger_id, stato) VALUES (?, 2, 'completato')`).run(ride);
    d.close();

    console.log('\n[Export del log attività]');
    const log = await leggiXlsx(await api('GET', '/audit-log/export/xlsx', { token: mm }));
    const celle = log['Log attività'].flat();
    check('nessuna cella è una formula', celle.every((c) => !c.formula));
    check('il motivo dell\'utente è neutralizzato', celle.some((c) => c.v === "'@SUM(1+1)"), JSON.stringify(celle.find((c) => String(c.v).includes('SUM'))));
    const conNome = celle.filter((c) => String(c.v).includes('HYPERLINK'));
    check('il nome malevolo compare solo neutralizzato o dentro un testo innocuo', conNome.length > 0 && conNome.every((c) => !/^[=+\-@]/.test(c.v)), JSON.stringify(conNome.map((c) => c.v)));
    check('nessuna cella inizia con un carattere di formula', celle.every((c) => typeof c.v !== 'string' || !/^[=+\-@\t\r]/.test(c.v)));
    check('intestazione attesa (con la sede di chi ha agito)', JSON.stringify(log['Log attività'][0].map((c) => c.v)) === JSON.stringify(['Data e ora (UTC)', 'Categoria', 'Azione', 'Utente', 'Sede', 'Dettagli']));

    console.log('\n[Export del report]');
    const rep = await leggiXlsx(await api('GET', '/reports/export/xlsx', { token: mm }));
    const sedi = rep['Per sede'];
    check('riga della sede presente', sedi.length === 2, JSON.stringify(sedi.map((r) => r.map((c) => c.v))));
    check('nome della sede neutralizzato', sedi[1][0].v === "'+Sede malevola", JSON.stringify(sedi[1][0].v));
    check('i valori numerici restano numeri', sedi[1].slice(1).every((c) => typeof c.v === 'number'), JSON.stringify(sedi[1].slice(1).map((c) => c.v)));
    check('titolo con il nome azienda leggibile', rep['Riepilogo'][0][0].v === 'Report carpooling — =Azienda', JSON.stringify(rep['Riepilogo'][0][0].v));
    check('totali del riepilogo numerici', rep['Riepilogo'].slice(4).every((r) => typeof r[1].v === 'number'));
    check('nessuna formula in tutto il report', Object.values(rep).flat(2).every((c) => !c.formula));

    console.log('\n[Prova di apertura con LibreOffice e conversione in CSV]');
    let soffice = null;
    try { soffice = execFileSync('which', ['soffice']).toString().trim(); } catch {}
    if (!soffice) console.log('       LibreOffice non installato: prova saltata');
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
})();
