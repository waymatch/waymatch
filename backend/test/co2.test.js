// Metodo di calcolo della CO2 evitata v1 (docs/metodo-calcolo.md): fattori ISPRA, scenario dei
// passeggeri, deviazione dell'autista, qualità dei dati e pannello costi (CO2 non modificabile).
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('co2');
const PORT = 4975;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const vicino = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

let ip = 1;
async function call(metodo, p, { token, body } = {}) {
  const headers = { 'X-Forwarded-For': `10.34.0.${ip++ % 250}` };
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

function provaFunzioni() {
  console.log('\n[Classe Euro e fattori]');
  const unit = cartellaProva('co2-unit');
  Object.assign(process.env, {
    DATA_DIR: path.join(unit, 'data'), UPLOAD_DIR: path.join(unit, 'uploads'), DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), SMTP_HOST: '',
  });
  const m = require(path.join(BACKEND, 'utils/metodoCo2'));
  const classi = [[1992, 'pre_euro'], [1993, 'euro1'], [1996, 'euro1'], [1997, 'euro2'], [2000, 'euro2'], [2001, 'euro3'], [2005, 'euro3'],
    [2006, 'euro4'], [2010, 'euro4'], [2011, 'euro5'], [2014, 'euro5'], [2015, 'euro6'], [2018, 'euro6'], [2019, 'euro6d_temp'], [2020, 'euro6d_temp'], [2021, 'euro6d'], [2025, 'euro6d']];
  check('l\'anno di immatricolazione dà la classe Euro (confini inclusi)', classi.every(([a, c]) => m.classeEuro(a) === c), JSON.stringify(classi.filter(([a, c]) => m.classeEuro(a) !== c)));
  check('un anno impossibile non dà nessuna classe', m.classeEuro(1800) === null && m.classeEuro('boh') === null && m.classeEuro(null) === null && m.classeEuro(2999) === null);
  let f = m.fattore({ alimentazione: 'benzina', segmento: 'piccola', anno: 2012 });
  check('benzina piccola Euro 5 (ISPRA): 148,5 g/km per segmento e classe Euro', f.g_km === 148.5 && f.fonte === 'segmento_euro', JSON.stringify(f));
  f = m.fattore({ alimentazione: 'diesel' });
  check('senza segmento né anno: media per alimentazione (diesel 167,1)', f.g_km === 167.1 && f.fonte === 'alimentazione');
  f = m.fattore({ alimentazione: 'benzina', segmento: 'mini', anno: 1990 });
  check('una combinazione non presente nella tabella ripiega sulla media dell\'alimentazione', f.g_km === 161.3 && f.fonte === 'alimentazione', JSON.stringify(f));
  f = m.fattore({});
  check('senza alimentazione: auto media (161,7)', f.g_km === 161.7 && f.fonte === 'media');
  f = m.fattore({ alimentazione: 'idrogeno', segmento: 'media', anno: 2022 });
  check('un\'alimentazione sconosciuta vale auto media', f.fonte === 'media');
  f = m.fattore({ alimentazione: 'elettrica', segmento: 'media', anno: 2022 });
  check('l\'elettrica vale 0 g/km (solo CO2 allo scarico)', f.g_km === 0);
  f = m.fattore({ alimentazione: 'ibrida_plugin', segmento: 'media', anno: 2022 });
  check('ibrida plug-in distinta dall\'ibrida (128,1 contro 136,9)', f.g_km === 128.1 && m.fattore({ alimentazione: 'ibrida', segmento: 'media', anno: 2022 }).g_km === 136.9, JSON.stringify(f));
  check('scenario: «mezzi», «bici o a piedi» e «altro» escludono il passeggero', ['mezzi', 'bici_piedi', 'altro'].every((s) => m.motivoEsclusione({ senza_passaggio: s, auto_alimentazione: 'benzina' }) === 'scenario'));
  check('scenario: senza risposta conta chi ha un\'auto, non chi non ce l\'ha', m.motivoEsclusione({ auto_marca: 'Fiat' }) === null && m.motivoEsclusione({}) === 'senza_auto');
  check('scenario: «auto propria» conta anche senza auto dichiarata', m.motivoEsclusione({ senza_passaggio: 'auto_propria' }) === null);
  const d = m.descrizioneMetodo();
  check('il metodo dichiara versione, confine e fonte', d.versione === 1 && /scarico/.test(d.confine) && /ISPRA/.test(d.fonte_fattori) && d.fonte_licenza === 'CC BY 4.0' && d.fonte_anno === 2022);
}

async function main() {
  provaFunzioni();
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
      sedi: [{ nome: 'Sede', indirizzo: 'Milano', lat: 45.46, lon: 9.18 }] } })).data.token;
    const sedeId = sql('SELECT id FROM sedi')[0].id;
    const utente = (nome, extra = {}) => {
      const r = sql(`INSERT INTO users (nome, cognome, email, password_hash, ruolo, sede_id, auto_alimentazione, auto_segmento, auto_anno, auto_marca, senza_passaggio)
        VALUES (?, 'T', ?, 'x', 'utente', ?, ?, ?, ?, ?, ?)`, nome, `${nome}@test.it`, sedeId, extra.alim ?? null, extra.seg ?? null, extra.anno ?? null, extra.marca ?? null, extra.senza ?? null);
      return Number(r.lastInsertRowid);
    };
    const autista = utente('autista', { alim: 'diesel', seg: 'media', anno: 2019, marca: 'Audi' });
    const p1 = utente('p1', { alim: 'benzina', seg: 'piccola', anno: 2012, marca: 'Fiat' });
    const p2 = utente('p2', { alim: 'diesel', marca: 'Opel' });
    const p3 = utente('p3', { alim: 'benzina', senza: 'mezzi' });
    const p4 = utente('p4');
    const p5 = utente('p5', { senza: 'auto_propria' });
    const p6 = utente('p6', { alim: 'elettrica', marca: 'Tesla' });
    const viaggio = (km, kmVer, kmDir, soste, passeggeri) => {
      const r = sql(`INSERT INTO rides (driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo, km_stimati, km_verificati, km_diretti, posti_totali, posti_disponibili, stato)
        VALUES (?, ?, 'andata', date('now','-1 day'), '08:00', 'A', 'B', ?, ?, ?, 4, 4, 'completato')`, autista, sedeId, km, kmVer, kmDir);
      const id = Number(r.lastInsertRowid);
      for (let i = 0; i < soste; i++) sql("INSERT INTO ride_stops (ride_id, luogo) VALUES (?, 'Sosta')", id);
      for (const p of passeggeri) sql("INSERT INTO bookings (ride_id, passenger_id, stato) VALUES (?, ?, 'completato')", id, p);
      return id;
    };
    viaggio(20, 20, 20, 0, [p1, p2, p3, p4, p5, p6]); // 1: sei passeggeri, quattro contano
    viaggio(25, 25, 20, 1, [p1]);                      // 2: deviazione di 5 km
    viaggio(10, 10, null, 1, [p2]);                    // 3: viaggio precedente, senza km del percorso diretto
    viaggio(10, null, null, 0, []);                    // 4: nessun passeggero
    viaggio(10, 30, 5, 1, [p2]);                       // 5: la deviazione supera il risparmio

    console.log('\n[Report con il metodo v1]');
    const r = await call('GET', '/reports/summary', { token: mm });
    const t = r.data?.totali || {};
    const q = r.data?.qualita || {};
    // 1: 20 x (148,5 + 167,1 + 161,7 + 0) = 9546 g · 2: 25 x 148,5 - 5 x 153,9 = 2943 g · 3: 10 x 167,1 = 1671 g · 5: 0 (non negativo)
    check('CO2 evitata: 14,2 kg (9546 + 2943 + 1671 g)', vicino(t.co2_kg_risparmiata, 14.2, 0.05), String(t.co2_kg_risparmiata));
    check('km evitati: 110 (80 + 20 + 10)', t.km_risparmiati === 110, String(t.km_risparmiati));
    check('costo evitato: € 22,75 (con il costo al km di ogni auto)', vicino(t.costo_risparmiato_eur, 22.75), String(t.costo_risparmiato_eur));
    check('viaggi e passeggeri trasportati', t.viaggi_completati === 5 && t.passeggeri_trasportati_totali === 9, JSON.stringify(t));
    check('un viaggio con deviazione maggiore del risparmio non lo rende negativo', t.co2_kg_risparmiata >= 14.1);
    check('il metodo è dichiarato nel report', r.data?.metodo?.versione === 1 && /ISPRA/.test(r.data.metodo.fonte_fattori));
    check('qualità: viaggi e km verificati', q.viaggi_completati === 5 && q.viaggi_con_km_verificati === 4, JSON.stringify(q));
    check('qualità: passeggeri conteggiati ed esclusi', q.passeggeri_completati === 9 && q.passeggeri_conteggiati === 7 && q.esclusi_scenario === 1 && q.esclusi_senza_auto === 1, JSON.stringify(q));
    check('qualità: da dove viene il fattore di ogni passeggero', q.fattori?.segmento_euro === 2 && q.fattori?.alimentazione === 4 && q.fattori?.media === 1 && q.fattori?.modello === 0, JSON.stringify(q.fattori));
    check('qualità: deviazione non calcolabile per il viaggio senza km diretti', q.viaggi_con_deviazione_non_calcolabile === 1, String(q.viaggi_con_deviazione_non_calcolabile));
    r.data && check('per sede e per mese hanno la stessa CO2 del totale', vicino(Object.values(r.data.per_sede).reduce((s, g) => s + g.co2_kg, 0), 14.16, 0.01)
      && vicino(Object.values(r.data.per_mese).reduce((s, g) => s + g.co2_kg, 0), 14.16, 0.01));

    console.log('\n[Pannello costi: la CO2 non si modifica]');
    let c = await call('GET', '/reports/cost-co2-clusters', { token: mm });
    const benzina = c.data.clusters.find((x) => x.alimentazione === 'benzina');
    check('il pannello mostra la CO2 media ISPRA in sola lettura', benzina?.co2_g_km === 161.3 && !('co2_g_km_default' in benzina), JSON.stringify(benzina));
    check('c\'è anche l\'ibrida plug-in', c.data.clusters.some((x) => x.alimentazione === 'ibrida_plugin' && x.co2_g_km === 123.1));
    c = await call('PUT', '/reports/cost-co2-clusters/benzina', { token: mm, body: { costo_km_eur: 0.3, co2_g_km: 1 } });
    check('il costo si modifica e la CO2 mandata si ignora', c.status === 200 && c.data.clusters.find((x) => x.alimentazione === 'benzina').costo_km_eur === 0.3
      && c.data.clusters.find((x) => x.alimentazione === 'benzina').co2_g_km === 161.3);
    check('un costo vuoto, negativo o non numerico è rifiutato', (await call('PUT', '/reports/cost-co2-clusters/benzina', { token: mm, body: { costo_km_eur: '' } })).status === 400
      && (await call('PUT', '/reports/cost-co2-clusters/benzina', { token: mm, body: { costo_km_eur: -1 } })).status === 400
      && (await call('PUT', '/reports/cost-co2-clusters/benzina', { token: mm, body: { costo_km_eur: 'tanto' } })).status === 400);
    const dopo = await call('GET', '/reports/summary', { token: mm });
    check('cambiare il costo cambia il costo evitato ma non la CO2', dopo.data.totali.costo_risparmiato_eur > t.costo_risparmiato_eur && dopo.data.totali.co2_kg_risparmiata === t.co2_kg_risparmiata);
    check('un valore di CO2 personalizzato da una versione precedente non conta più', (() => {
      sql("INSERT INTO cost_co2_clusters (alimentazione, costo_km_eur, co2_g_km) VALUES ('diesel', 0.22, 9999) ON CONFLICT(alimentazione) DO UPDATE SET co2_g_km = 9999");
      return true;
    })());
    const vecchio = await call('GET', '/reports/summary', { token: mm });
    check('...e il report resta quello del metodo', vecchio.data.totali.co2_kg_risparmiata === t.co2_kg_risparmiata);
    c = await call('GET', '/reports/cost-co2-clusters', { token: mm });
    check('...e il pannello continua a mostrare il valore ISPRA', c.data.clusters.find((x) => x.alimentazione === 'diesel').co2_g_km === 167.1);
  } finally {
    server.kill();
    if (esito.ko) console.log(log.slice(-2500));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
