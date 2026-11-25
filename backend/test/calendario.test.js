// Giorni lavorativi: passaggi e turni fissi solo nei giorni che l'azienda prevede.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('calendario');
const PORT = 4979;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');
const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body } = {}) {
  const headers = { 'X-Forwarded-For': `10.79.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method: metodo, headers, body: payload });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
// Prossima data che cade nel giorno indicato (1 = lunedì ... 7 = domenica), almeno tra 3 giorni.
function prossimo(giorno) {
  const d = new Date(Date.now() + 3 * 864e5);
  while (((d.getDay() + 6) % 7) + 1 !== giorno) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const offerta = (data) => ({ tipo: 'andata', data, ora_andata: '08:00', punto_partenza: 'Via Roma 1', posti_totali: 3 });

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'A', cognome: 'B', email: 'mm@test.it', password: PW,
      sedi: [{ nome: 'Sede', indirizzo: 'Via X', lat: 45.4, lon: 9.1 }] } })).data.token;
    const sedeId = (await call('GET', '/sedi', { token: mm })).data.sedi[0].id;
    await call('PUT', '/auth/me', { token: mm, body: { sede_id: sedeId } });
    const domenica = prossimo(7), lunedi = prossimo(1), sabato = prossimo(6);

    console.log('\n[Predefinito: lunedì-sabato]');
    check('il branding pubblico elenca i giorni lavorativi', JSON.stringify((await call('GET', '/branding')).data.branding.giorni_lavorativi) === '[1,2,3,4,5,6]');
    let r = await call('POST', '/rides', { token: mm, body: offerta(lunedi) });
    check('si può offrire un passaggio di lunedì', r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);
    r = await call('POST', '/rides', { token: mm, body: offerta(sabato) });
    check('e di sabato', r.status === 200, String(r.status));
    r = await call('POST', '/rides', { token: mm, body: offerta(domenica) });
    check('di domenica no, con un messaggio chiaro', r.status === 400 && /non prevede passaggi di domenica/.test(r.data.error), `${r.status} ${r.data && r.data.error}`);
    r = await call('POST', '/recurring-rides', { token: mm, body: { tipo: 'andata', giorni_settimana: [1, 7], ora: '08:00', punto_partenza: 'Via Roma 1', punto_arrivo: 'Sede', sede_id: sedeId, data_inizio: lunedi } });
    check('un turno fisso con la domenica è rifiutato', r.status === 400 && /domenica/.test(r.data.error), `${r.status} ${r.data && r.data.error}`);

    console.log('\n[Impostazione]');
    r = await call('GET', '/settings', { token: mm });
    check('GET /settings elenca i giorni', JSON.stringify(r.data.settings.giorni_lavorativi) === '[1,2,3,4,5,6]');
    check('senza login la modifica è respinta', (await call('PUT', '/settings', { body: { giorni_lavorativi: [1] } })).status === 401);
    r = await call('PUT', '/settings', { token: mm, body: { giorni_lavorativi: [] } });
    check('almeno un giorno è obbligatorio', r.status === 400);
    r = await call('PUT', '/settings', { token: mm, body: { giorni_lavorativi: 'tutti' } });
    check('un valore non valido è rifiutato', r.status === 400);
    r = await call('PUT', '/settings', { token: mm, body: { giorni_lavorativi: [1, 2, 3, 4, 5, 6, 7, 7, 9] } });
    check('i giorni vengono normalizzati e salvati', r.status === 200);
    check('ora la domenica è lavorativa', JSON.stringify((await call('GET', '/branding')).data.branding.giorni_lavorativi) === '[1,2,3,4,5,6,7]');
    r = await call('PUT', '/settings', { token: mm, body: { richiede_approvazione_completamento: true } });
    check('un aggiornamento parziale non azzera i giorni', JSON.stringify((await call('GET', '/settings', { token: mm })).data.settings.giorni_lavorativi) === '[1,2,3,4,5,6,7]');
    r = await call('PUT', '/settings', { token: mm, body: { giorni_lavorativi: [1, 2, 3, 4, 5, 6, 7] } });
    check('e viceversa non cambia l\'approvazione', (await call('GET', '/settings', { token: mm })).data.settings.richiede_approvazione_completamento === 1);

    console.log('\n[Con la domenica attiva]');
    r = await call('POST', '/rides', { token: mm, body: offerta(domenica) });
    check('si può offrire di domenica', r.status === 200, `${r.status} ${r.data && r.data.error}`);
    r = await call('POST', '/recurring-rides', { token: mm, body: { tipo: 'andata', giorni_settimana: [7], ora: '08:00', punto_partenza: 'Via Roma 1', punto_arrivo: 'Sede', sede_id: sedeId, data_inizio: lunedi } });
    check('e creare un turno fisso della domenica', r.status === 200, `${r.status} ${r.data && r.data.error}`);

    console.log('\n[Si toglie un giorno]');
    await call('PUT', '/settings', { token: mm, body: { giorni_lavorativi: [1, 2, 3, 4, 5] } });
    const id = (await call('GET', '/rides?mine=1', { token: mm })).data.rides.find((x) => x.data === lunedi).id;
    r = await call('PUT', `/rides/${id}`, { token: mm, body: { data: sabato } });
    check('spostare un passaggio a un giorno non più lavorativo è rifiutato', r.status === 400 && /sabato/.test(r.data.error), `${r.status} ${r.data && r.data.error}`);
    r = await call('PUT', `/rides/${id}`, { token: mm, body: { ora: '09:00' } });
    check('modificare l\'orario di un passaggio esistente funziona ancora', r.status === 200, String(r.status));
  } finally {
    server.kill();
    if (esito.ko) console.log('--- log server ---\n' + log.slice(-1200));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
