// Regole del carpooling: prenotazioni, recapiti, annullamenti, turni fissi, premi e
// rimborsi, validazioni delle impostazioni, endpoint delle notifiche push.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('regole-carpooling');
const PORT = 4986;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body, form } = {}) {
  const headers = { 'X-Forwarded-For': `10.24.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method: metodo, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function apri() { const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`); return d; }
function sql(q, ...p) { const d = apri(); try { return d.prepare(q)[/^\s*select/i.test(q) ? 'get' : 'run'](...p); } finally { d.close(); } }
const entra = async (email) => (await call('POST', '/auth/login', { body: { email, password: PW } })).data?.token;

// Prossimo giorno feriale (lunedì-sabato, i giorni lavorativi predefiniti) a partire da domani.
function prossimoFeriale(daGiorni = 1) {
  const d = new Date(); d.setDate(d.getDate() + daGiorni);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const due = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`; // data locale: toISOString() la sposterebbe in UTC
}

// OSRM finto: ogni percorso misura 10 km.
const http = require('http');
const PORTA_OSRM = 4987;
let ritardoOsrm = 0; // ms: per provare le modifiche concorrenti durante il calcolo dei km
let alPrimoOsrm = null; // risolve la promessa del test alla prima richiesta ricevuta dal finto OSRM
const osrm = http.createServer(async (req, res) => {
  if (alPrimoOsrm) { alPrimoOsrm(); alPrimoOsrm = null; }
  if (ritardoOsrm) await new Promise((r) => setTimeout(r, ritardoOsrm));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 900, geometry: { coordinates: [[9.04, 45.53], [9.18, 45.46]] } }] }));
});

async function main() {
  await new Promise((r) => osrm.listen(PORTA_OSRM, '127.0.0.1', r));
  const ENV = { ...process.env, OSRM_URL: `http://127.0.0.1:${PORTA_OSRM}`, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' };
  const server = spawn('node', ['server.js'], { cwd: BACKEND, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  // Un giro dello scheduler dei turni fissi (generazione e avvisi), sullo stesso database del server.
  const giroScheduler = () => new Promise((ok, ko) => {
    const p = spawn('node', ['-e', `const r = require('./routes/recurring_rides');
      const n = r.generaTutteLeOccorrenze(14);
      require('./utils/turniInPausa').avvisaTurniInPausa().then((a) => { console.log(JSON.stringify({ n, a })); process.exit(0); });`], { cwd: BACKEND, env: ENV });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => { try { ok(JSON.parse(out.trim().split('\n').pop())); } catch { ko(new Error(`scheduler (${c}): ${out}`)); } });
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  try {
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'Mo', cognome: 'Ma', email: 'mm@test.it', password: PW,
      sedi: [{ nome: 'Sede', indirizzo: 'Milano', lat: 45.46, lon: 9.18 }] } })).data.token;
    const sedeId = sql('SELECT id FROM sedi').id;
    for (const n of ['autista', 'anna', 'bruno', 'carla']) {
      await call('POST', '/users', { token: mm, body: { nome: n, cognome: 'Test', email: `${n}@test.it`, password: PW, sede_id: sedeId } });
    }
    sql("UPDATE users SET password_da_cambiare = 0, telefono = '3330000000'");
    const [autista, anna, bruno, carla] = await Promise.all(['autista', 'anna', 'bruno', 'carla'].map((n) => entra(`${n}@test.it`)));
    const id = (email) => sql('SELECT id FROM users WHERE email = ?', email).id;
    const data = prossimoFeriale();
    const offerta = (extra = {}) => ({ tipo: 'andata', data, ora_andata: '08:00', punto_partenza: 'Via Roma 1, Rho',
      partenza_lat: 45.53, partenza_lon: 9.04, km_stimati_andata: 15, posti_totali: 1, ...extra });

    console.log('\n[Modifica parziale di un utente]');
    const idCarla = id('carla@test.it');
    let rp = await call('PUT', `/users/${idCarla}`, { token: mm, body: { ruolo: 'supervisor' } });
    check('si può cambiare solo il ruolo', rp.status === 200 && rp.data.user.ruolo === 'supervisor', String(rp.status));
    rp = await call('PUT', `/users/${idCarla}`, { token: mm, body: { attivo: 0 } });
    check('si può disattivare senza rimandare gli altri campi', rp.status === 200, String(rp.status));
    // Una tabella non aggiornata cambia solo la sede: ruolo e stato scritti nel frattempo restano.
    rp = await call('PUT', `/users/${idCarla}`, { token: mm, body: { sede_id: null } });
    const dopo = sql('SELECT ruolo, attivo, sede_id FROM users WHERE id = ?', idCarla);
    check('cambiare la sede non riporta ruolo e stato a valori superati', dopo.ruolo === 'supervisor' && dopo.attivo === 0 && dopo.sede_id === null, JSON.stringify(dopo));
    await call('PUT', `/users/${idCarla}`, { token: mm, body: { attivo: 1, ruolo: 'utente', sede_id: sedeId } });

    console.log('\n[Pubblicazione di un passaggio]');
    let r = await call('POST', '/rides', { token: autista, body: offerta({ ora_andata: '9:00' }) });
    check('un orario senza zero iniziale è rifiutato', r.status === 400, String(r.status));
    r = await call('POST', '/rides', { token: autista, body: offerta({ tipo: 'boh' }) });
    check('un tipo sconosciuto è rifiutato', r.status === 400);
    const prima = sql('SELECT COUNT(*) n FROM rides').n;
    r = await call('POST', '/rides', { token: autista, body: offerta({ tipo: 'entrambi' }) });
    check('andata e ritorno senza dati del ritorno: rifiutato e nessuna andata pubblicata', r.status === 400 && sql('SELECT COUNT(*) n FROM rides').n === prima);
    r = await call('POST', '/rides', { token: autista, body: offerta({ geometria_andata: [[45.5, 'x']] }) });
    check('un percorso con coordinate non valide è rifiutato', r.status === 400);
    r = await call('POST', '/rides', { token: autista, body: offerta({ posti_totali: 1.5 }) });
    check('posti non interi rifiutati', r.status === 400);
    r = await call('POST', '/rides', { token: autista, body: offerta() });
    const rideId = r.data.ride_ids[0];
    check('un passaggio valido si pubblica', r.status === 200 && !!rideId);
    check('i km del percorso li calcola il server', sql('SELECT km_verificati FROM rides WHERE id = ?', rideId)?.km_verificati === 10);

    r = await call('PUT', `/rides/${rideId}`, { token: autista, body: { km_stimati: '' } });
    check('km vuoti rifiutati in modifica', r.status === 400, String(r.status));
    r = await call('PUT', `/rides/${rideId}`, { token: autista, body: { km_stimati: 'abc' } });
    check('km non numerici rifiutati in modifica', r.status === 400);
    r = await call('PUT', `/rides/${rideId}`, { token: autista, body: { km_stimati: null } });
    check('km null rifiutati in modifica', r.status === 400);
    r = await call('PUT', `/rides/${rideId}`, { token: autista, body: { km_stimati: true } });
    check('km booleani rifiutati in modifica', r.status === 400);
    r = await call('PUT', `/rides/${rideId}`, { token: autista, body: { note: 'solo una nota' } });
    check('senza km nel corpo si conserva il valore salvato', r.status === 200 && sql('SELECT km_stimati FROM rides WHERE id = ?', rideId).km_stimati === 15);

    // Modifica concorrente: mentre il server calcola i km, un'altra modifica cambia l'orario.
    ritardoOsrm = 600;
    const richiestaArrivata = new Promise((res) => { alPrimoOsrm = res; });
    const lenta = call('PUT', `/rides/${rideId}`, { token: autista, body: { partenza_lat: 45.54, partenza_lon: 9.05 } });
    // Il server ha già copiato lo stato del passaggio quando chiede il percorso: la modifica che segue è davvero
    // concorrente. Se la richiesta finisce prima (errore) o non arriva, il test lo dice invece di restare in attesa.
    const attesa = await Promise.race([
      richiestaArrivata.then(() => 'osrm'),
      lenta.then(() => 'conclusa senza chiamare OSRM'),
      new Promise((res) => setTimeout(() => res('timeout'), 5000)),
    ]);
    check('il server chiede il percorso a OSRM prima di rispondere', attesa === 'osrm', attesa);
    if (attesa !== 'osrm') { ritardoOsrm = 0; throw new Error(`scenario concorrente non avvenuto (${attesa}): non si prosegue senza attendere la richiesta`); }
    sql("UPDATE rides SET ora = '09:10' WHERE id = ?", rideId);
    r = await lenta;
    ritardoOsrm = 0;
    check('una modifica concorrente durante il calcolo dei km dà conflitto e non sovrascrive', r.status === 409 && sql('SELECT ora FROM rides WHERE id = ?', rideId).ora === '09:10', `${r.status}`);
    sql("UPDATE rides SET ora = '08:00' WHERE id = ?", rideId);

    console.log('\n[Prenotazioni, capienza e recapiti]');
    r = await call('POST', `/bookings/rides/${rideId}/book`, { token: anna, body: {} });
    const bAnna = r.data.booking_id;
    r = await call('POST', `/bookings/rides/${rideId}/book`, { token: bruno, body: {} });
    const bBruno = r.data.booking_id;
    check('il secondo passeggero va in lista d\'attesa (1 posto)', r.data.lista_attesa === true);
    r = await call('PUT', `/bookings/${bBruno}`, { token: autista, body: { stato: 'confermato' } });
    check('non si conferma dalla lista d\'attesa oltre la capienza', r.status === 400, String(r.status));
    r = await call('GET', `/rides/${rideId}`, { token: anna });
    check('con una richiesta non ancora confermata non si vedono i telefoni', r.status === 200 && r.data.ride.driver_telefono === null);
    r = await call('GET', '/bookings/mie', { token: anna });
    check('nemmeno nell\'elenco delle proprie prenotazioni', r.data.bookings.find((b) => b.ride_id === rideId)?.driver_telefono === null);
    await call('PUT', `/bookings/${bAnna}`, { token: autista, body: { stato: 'confermato' } });
    r = await call('GET', `/rides/${rideId}`, { token: anna });
    check('confermata: vede il telefono dell\'autista', r.data.ride.driver_telefono === '3330000000');
    await call('PUT', `/bookings/${bAnna}/check-in`, { token: autista });
    await call('PUT', `/bookings/${bAnna}`, { token: autista, body: { stato: 'rifiutato' } });
    check('chi perde la conferma perde anche il check-in', sql('SELECT check_in FROM bookings WHERE id = ?', bAnna).check_in === 0);
    check('il posto liberato promuove la lista d\'attesa', sql('SELECT stato FROM bookings WHERE id = ?', bBruno).stato === 'richiesto');
    r = await call('GET', `/rides/${rideId}`, { token: anna });
    check('con la richiesta rifiutata non si accede più al dettaglio', r.status === 403, String(r.status));

    console.log('\n[Passaggi già partiti o conclusi]');
    sql("INSERT INTO rides (driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo, posti_totali, posti_disponibili) VALUES (?, ?, 'andata', '2020-01-01', '08:00', 'A', 'B', 3, 3)", id('autista@test.it'), sedeId);
    const passato = sql("SELECT id FROM rides WHERE data = '2020-01-01'").id;
    r = await call('POST', `/bookings/rides/${passato}/book`, { token: carla, body: {} });
    check('un passaggio già partito non si prenota', r.status === 400, String(r.status));
    sql("UPDATE rides SET stato = 'completato' WHERE id = ?", passato);
    r = await call('DELETE', `/rides/${passato}`, { token: autista });
    check('un passaggio completato non si annulla', r.status === 400 && sql('SELECT stato FROM rides WHERE id = ?', passato).stato === 'completato');

    console.log('\n[Turni fissi]');
    r = await call('POST', '/recurring-rides', { token: autista, body: { tipo: 'andata', giorni_settimana: [1, 2, 3, 4, 5, 6], ora: '07:30',
      punto_partenza: 'Via Roma 1', punto_arrivo: 'Sede', data_inizio: new Date().toISOString().slice(0, 10) } });
    const turno = r.data.recurring_ride?.id;
    // Solo le occorrenze future: quella di oggi, se già partita, resta com'è.
    const attive = () => sql(`SELECT COUNT(*) n FROM rides WHERE recurring_ride_id = ? AND stato = 'attivo'
      AND (data > date('now','localtime') OR (data = date('now','localtime') AND ora >= strftime('%H:%M','now','localtime')))`, turno).n;
    const generate = attive();
    await call('PUT', `/recurring-rides/${turno}/attivo`, { token: autista, body: { attivo: false } });
    check('sospeso: le occorrenze future sono annullate', generate > 0 && attive() === 0, `${generate} → ${attive()}`);
    await call('PUT', `/recurring-rides/${turno}/attivo`, { token: autista, body: { attivo: true } });
    check('riattivato: le occorrenze tornano disponibili', attive() === generate, `${attive()} su ${generate}`);
    const unaData = sql(`SELECT data FROM rides WHERE recurring_ride_id = ? AND stato = 'attivo' AND data > date('now','localtime') ORDER BY data LIMIT 1`, turno).data;
    await call('POST', `/recurring-rides/${turno}/eccezioni`, { token: autista, body: { data: unaData } });
    await call('PUT', `/recurring-rides/${turno}/attivo`, { token: autista, body: { attivo: false } });
    await call('DELETE', `/recurring-rides/${turno}/eccezioni/${unaData}`, { token: autista });
    await call('PUT', `/recurring-rides/${turno}/attivo`, { token: autista, body: { attivo: true } });
    check('una data saltata e ripristinata durante la sospensione torna disponibile alla riattivazione', attive() === generate, `${attive()} su ${generate}`);
    await call('DELETE', `/recurring-rides/${turno}`, { token: autista });
    check('eliminato: le occorrenze future sono annullate', attive() === 0);

    console.log('\n[Premi e rimborsi]');
    r = await call('POST', '/rewards', { token: mm, body: { nome: 'Truffa', punti_richiesti: -100 } });
    check('un premio con punti negativi è rifiutato', r.status === 400);
    const premio = (await call('POST', '/rewards', { token: mm, body: { nome: 'Caffè', punti_richiesti: 100 } })).data.reward;
    await call('POST', '/point-rules/manual-award', { token: mm, body: { user_id: id('carla@test.it'), punti: 150, motivo: 'test' } });
    const saldo = async () => (await call('GET', '/rewards', { token: carla })).data.punti_disponibili;
    // Carla spegne tutti i canali per gli avvisi sui premi: nemmeno la campanella deve riceverli.
    await call('PUT', '/notification-prefs/premi', { token: carla, body: { inapp: false, push: false, email: false } });
    const riscatto = (await call('POST', `/rewards/${premio.id}/redeem`, { token: carla })).data.redemption_id;
    check('il riscatto addebita i punti', await saldo() === 50);
    await call('PUT', `/rewards/${premio.id}`, { token: mm, body: { nome: 'Caffè', punti_richiesti: 200, attivo: 1 } });
    await call('PUT', `/rewards/redemptions/${riscatto}`, { token: mm, body: { stato: 'rifiutato' } });
    check('il rimborso è l\'importo addebitato, non il nuovo prezzo', await saldo() === 150, String(await saldo()));
    check('con tutti i canali spenti non arriva neanche nella campanella', sql("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND tipo = 'riscatto_rifiutato'", id('carla@test.it')).n === 0);
    r = await call('GET', '/notification-prefs', { token: carla });
    check('le preferenze riportano il canale App', r.data.categorie.find((c) => c.chiave === 'premi')?.inapp === false && r.data.categorie.find((c) => c.chiave === 'esito_richieste')?.inapp === true);
    r = await call('PUT', `/rewards/redemptions/${riscatto}`, { token: mm, body: { stato: 'approvato' } });
    await call('PUT', `/rewards/redemptions/${riscatto}`, { token: mm, body: { stato: 'rifiutato' } });
    check('un riscatto rifiutato è definitivo: nessun secondo rimborso', r.status === 400 && await saldo() === 150, String(await saldo()));

    const tpl = sql("INSERT INTO voucher_templates (nome, immagine_path) VALUES ('T', '/uploads/voucher-templates/x.png')").lastInsertRowid;
    const digitale = (await call('POST', '/rewards', { token: mm, body: { nome: 'Buono', punti_richiesti: 10, tipo: 'voucher_digitale', voucher_template_id: tpl } })).data.reward;
    const rd = (await call('POST', `/rewards/${digitale.id}/redeem`, { token: carla })).data.redemption_id;
    r = await call('PUT', `/rewards/redemptions/${rd}`, { token: mm, body: { stato: 'consegnato' } });
    check('un voucher consegnato direttamente ha il suo codice', r.status === 200 && /^[0-9A-F]{4}-/.test(r.data.codice_voucher || ''), JSON.stringify(r.data));

    console.log('\n[Impostazioni]');
    r = await call('POST', '/sedi', { token: mm, body: { nome: 'Mezza', lat: 45, lon: null } });
    check('una sede con una sola coordinata è rifiutata', r.status === 400);
    r = await call('PUT', '/point-rules/offerta_creata', { token: mm, body: { attivo: 1 } });
    check('una regola si attiva senza ripetere il valore', r.status === 200 && r.data.rule.attivo === 1);
    r = await call('PUT', '/point-rules/km_cap_bonus', { token: mm, body: { punti: 20, attivo: false } });
    check('una regola strutturale non si disattiva', r.status === 400);
    // Aggiornamento parziale: cambiare un campo non tocca gli altri della stessa categoria.
    await call('PUT', '/notification-prefs/esito_richieste', { token: carla, body: { email: false } });
    await call('PUT', '/notification-prefs/esito_richieste', { token: carla, body: { push: false } });
    const esito = (await call('GET', '/notification-prefs', { token: carla })).data.categorie.find((c) => c.chiave === 'esito_richieste');
    check('due modifiche della stessa categoria non si sovrascrivono', esito.email === false && esito.push === false && esito.inapp === true, JSON.stringify(esito));
    r = await call('PUT', '/notification-prefs/esito_richieste', { token: carla, body: { push: 'forse' } });
    check('un valore non booleano è rifiutato', r.status === 400);
    r = await call('PUT', '/notification-prefs/esito_richieste', { token: carla, body: { push: 1 } });
    check('anche i numeri 0 e 1 sono rifiutati', r.status === 400);
    r = await call('PUT', '/notification-prefs/promemoria_partenza', { token: carla, body: { push: true, email: false, minuti_anticipo: 240 } });
    check('un anticipo del promemoria oltre 120 minuti è rifiutato', r.status === 400);
    r = await call('POST', '/contests', { token: mm, body: { nome: 'Al contrario', metrica: 'punti', data_inizio: '2026-11-20', data_fine: '2026-11-10' } });
    check('un contest con la fine prima dell\'inizio è rifiutato', r.status === 400);
    r = await call('POST', '/contests', { token: mm, body: { nome: 'Mese 13', metrica: 'punti', data_inizio: '2025-01-01', data_fine: '2025-13-01' } });
    check('un contest con una data inesistente è rifiutato', r.status === 400);
    r = await call('POST', '/contests', { token: mm, body: { nome: 'Bisestile', metrica: 'punti', data_inizio: '2028-02-29', data_fine: '2028-03-01' } });
    check('un giorno bisestile reale è valido', r.status === 200, String(r.status));
    r = await call('POST', '/contests', { token: mm, body: { nome: 'Ok', metrica: 'punti', data_inizio: '2026-11-10', data_fine: '2026-11-20' } });
    check('un contest con un periodo valido si crea', r.status === 200, String(r.status));
    r = await call('PUT', '/sedi/9999', { token: mm, body: { nome: 'X' } });
    check('modificare una sede inesistente dà 404', r.status === 404);
    r = await call('PUT', '/branding', { token: mm, body: { primary_color: '#000000' } });
    check('il branding senza nome dell\'azienda è rifiutato', r.status === 400);

    console.log('\n[Documenti del conducente]');
    const fd = new FormData(); fd.append('titolo', 'Responsabilità del conducente'); fd.append('contenuto', 'Testo'); fd.append('formato', 'testo'); fd.append('tipo', 'conducente');
    const docC = (await call('POST', '/legal-documents', { token: mm, form: fd })).data.documento;
    const nuova = { tipo: 'andata', data: prossimoFeriale(2), ora_andata: '08:30', punto_partenza: 'Via Roma 1, Rho', km_stimati_andata: 10, posti_totali: 2 };
    r = await call('POST', '/rides', { token: autista, body: nuova });
    check('senza i documenti del conducente accettati non si pubblica (API diretta)', r.status === 403 && r.data.codice === 'DOCUMENTI_DA_ACCETTARE', `${r.status}`);
    r = await call('POST', '/recurring-rides', { token: autista, body: { tipo: 'andata', giorni_settimana: [1], ora: '07:30', punto_partenza: 'A', punto_arrivo: 'B', data_inizio: new Date().toISOString().slice(0, 10) } });
    check('nemmeno un turno fisso', r.status === 403);
    await call('POST', `/legal-documents/${docC.id}/accept`, { token: autista, body: { versione: docC.versione } });
    r = await call('POST', '/rides', { token: autista, body: nuova });
    check('dopo l\'accettazione si pubblica', r.status === 200, `${r.status}`);

    console.log('\n[Turni fissi e documenti del conducente aggiornati]');
    r = await call('POST', '/recurring-rides', { token: autista, body: { tipo: 'ritorno', giorni_settimana: [1, 2, 3, 4, 5, 6], ora: '23:59',
      punto_partenza: 'Sede', punto_arrivo: 'Via Roma 1', data_inizio: new Date().toISOString().slice(0, 10) } });
    const turnoD = r.data.recurring_ride?.id;
    const futureD = () => sql(`SELECT COUNT(*) n FROM rides WHERE recurring_ride_id = ? AND stato = 'attivo'
      AND (data > date('now','localtime') OR (data = date('now','localtime') AND ora >= strftime('%H:%M','now','localtime')))`, turnoD).n;
    const primaD = futureD();
    check('con i documenti accettati il turno genera le corse', primaD > 1, String(primaD));
    const fd2 = new FormData(); fd2.append('titolo', 'Responsabilità del conducente'); fd2.append('contenuto', 'Testo aggiornato');
    fd2.append('formato', 'testo'); fd2.append('tipo', 'conducente'); fd2.append('incrementaVersione', 'true');
    await call('PUT', `/legal-documents/${docC.id}`, { token: mm, form: fd2 });
    const versione2 = sql('SELECT versione FROM legal_documents WHERE id = ?', docC.id).versione;
    r = await call('GET', '/recurring-rides/mie', { token: autista });
    check('con una nuova versione da accettare i turni risultano in pausa', versione2 === docC.versione + 1 && r.data.documenti_da_accettare === true);
    check('le corse già create restano', futureD() === primaD);
    // Si toglie l'ultima occorrenza: un giro dello scheduler in pausa non deve ricrearla.
    sql('DELETE FROM rides WHERE id = (SELECT MAX(id) FROM rides WHERE recurring_ride_id = ?)', turnoD);
    const avvisiPausa = () => sql("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND tipo = 'turni_in_pausa'", id('autista@test.it')).n;
    let giro = await giroScheduler();
    check('in pausa lo scheduler non genera nuove corse', giro.n === 0 && futureD() === primaD - 1, `${giro.n}, ${futureD()} su ${primaD - 1}`);
    check('il conducente riceve un avviso', avvisiPausa() === 1, String(avvisiPausa()));
    await giroScheduler();
    check('l\'avviso non si ripete a ogni giro', avvisiPausa() === 1, String(avvisiPausa()));
    const dataSaltata = sql(`SELECT data FROM rides WHERE recurring_ride_id = ? AND stato = 'attivo' AND data > date('now','localtime') ORDER BY data LIMIT 1`, turnoD).data;
    await call('POST', `/recurring-rides/${turnoD}/eccezioni`, { token: autista, body: { data: dataSaltata } });
    r = await call('DELETE', `/recurring-rides/${turnoD}/eccezioni/${dataSaltata}`, { token: autista });
    check('in pausa una data saltata non si rimette in calendario', r.status === 403 && r.data.codice === 'DOCUMENTI_DA_ACCETTARE'
      && sql('SELECT stato FROM rides WHERE recurring_ride_id = ? AND data = ?', turnoD, dataSaltata).stato === 'annullato'
      && sql('SELECT COUNT(*) n FROM recurring_ride_exceptions WHERE recurring_ride_id = ? AND data = ?', turnoD, dataSaltata).n === 1, String(r.status));
    sql('DELETE FROM recurring_ride_exceptions WHERE recurring_ride_id = ?', turnoD); // per i controlli che seguono
    await call('PUT', `/recurring-rides/${turnoD}/attivo`, { token: autista, body: { attivo: false } });
    r = await call('PUT', `/recurring-rides/${turnoD}/attivo`, { token: autista, body: { attivo: true } });
    check('un turno sospeso non si riattiva senza accettare i documenti', r.status === 403 && r.data.codice === 'DOCUMENTI_DA_ACCETTARE'
      && sql('SELECT attivo FROM recurring_rides WHERE id = ?', turnoD).attivo === 0, String(r.status));
    r = await call('PUT', `/recurring-rides/${turnoD}/attivo`, { token: mm, body: { attivo: true } });
    check('nemmeno se a riattivarlo è il mobility manager', r.status === 403, String(r.status));
    // Un turno attivo in pausa riprende appena il conducente accetta, senza aspettare lo scheduler.
    sql('UPDATE recurring_rides SET attivo = 1 WHERE id = ?', turnoD);
    sql("DELETE FROM rides WHERE recurring_ride_id = ? AND stato = 'annullato'", turnoD);
    const inPausa = futureD();
    await call('POST', `/legal-documents/${docC.id}/accept`, { token: autista, body: { versione: versione2 } });
    check('all\'accettazione le corse mancanti si creano subito', inPausa === 0 && futureD() === primaD, `${inPausa} → ${futureD()} su ${primaD}`);
    sql('UPDATE recurring_rides SET attivo = 0 WHERE id = ?', turnoD);
    r = await call('PUT', `/recurring-rides/${turnoD}/attivo`, { token: autista, body: { attivo: true } });
    check('dopo l\'accettazione si riattiva e le corse mancanti tornano', r.status === 200 && futureD() === primaD, `${r.status}, ${futureD()} su ${primaD}`);
    await giroScheduler();
    check('chi ha accettato esce dall\'elenco degli avvisi', sql('SELECT COUNT(*) n FROM avvisi_turni_in_pausa').n === 0);
    await call('DELETE', `/recurring-rides/${turnoD}`, { token: autista });

    console.log('\n[Notifiche push]');
    const chiavi = { p256dh: 'x', auth: 'y' };
    r = await call('POST', '/push/subscribe', { token: carla, body: { endpoint: 'https://127.0.0.1/interno', keys: chiavi } });
    check('un endpoint push interno è rifiutato', r.status === 400);
    r = await call('POST', '/push/subscribe', { token: carla, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: chiavi } });
    check('un endpoint di un servizio push dei browser è accettato', r.status === 200);
  } finally {
    server.kill();
    osrm.close();
    if (esito.ko) console.log(log.slice(-2000));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
