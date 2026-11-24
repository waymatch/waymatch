const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { assegnaPunti, getRule, calcolaBonusKm } = require('../utils/points');
const { dataLavorativa, messaggioGiornoNonLavorativo } = require('../utils/calendario');
const { notifica, notificaMassiva } = require('../utils/notify');
const { registraAzione } = require('../utils/audit');
const { notificaMatchProattivo, notificaPreferiti } = require('../utils/matching');
const { promuoviListaAttesa, notificaPromossi } = require('../utils/waitlist');
const { distanzaPuntoDaPercorso } = require('../utils/geoDistance');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Filtro SQL riutilizzabile: solo passaggi non ancora partiti (data futura, o oggi con
// orario non ancora passato). Usa 'localtime' così rispetta il fuso orario del server
// (impostare TZ nel docker-compose, es. Europe/Rome).
const UPCOMING_SQL = `(r.data > date('now','localtime') OR (r.data = date('now','localtime') AND r.ora >= strftime('%H:%M','now','localtime')))`;

function isPastDateTime(dataStr, oraStr) {
  if (!dataStr || !oraStr) return false;
  const target = new Date(`${dataStr}T${oraStr}:00`);
  return target.getTime() < Date.now();
}

function getRideFull(id) {
  const ride = db.prepare(`
    SELECT r.*, u.nome as driver_nome, u.cognome as driver_cognome, u.telefono as driver_telefono,
           u.auto_marca, u.auto_modello, u.auto_colore, u.auto_alimentazione, s.nome as sede_nome
    FROM rides r
    JOIN users u ON u.id = r.driver_id
    LEFT JOIN sedi s ON s.id = r.sede_id
    WHERE r.id = ?
  `).get(id);
  if (!ride) return null;
  ride.soste = db.prepare('SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY orario').all(id);
  ride.prenotazioni = db.prepare(`
    SELECT b.*, u.nome, u.cognome, u.telefono FROM bookings b JOIN users u ON u.id = b.passenger_id
    WHERE b.ride_id = ? ORDER BY b.created_at
  `).all(id);
  ride.geometria = ride.geometria ? JSON.parse(ride.geometria) : null;
  return ride;
}

// Esegue l'assegnazione punti effettiva a completamento viaggio (usata sia in modalità
// "conferma diretta" che dopo l'approvazione di un Mobility Manager).
function eseguiCompletamento(ride) {
  // LIMIT esplicito e verificabile: un viaggio ha al massimo 8 posti, 50 è un margine ampio.
  const confermate = db.prepare(`SELECT * FROM bookings WHERE ride_id = ? AND stato = 'confermato' LIMIT 50`).all(ride.id).slice(0, 50);
  const aBordo = confermate.filter((b) => b.check_in === 1);
  const assenti = confermate.filter((b) => b.check_in !== 1);

  db.prepare(`UPDATE rides SET stato = 'completato' WHERE id = ?`).run(ride.id);

  for (const b of aBordo) {
    db.prepare(`UPDATE bookings SET stato = 'completato' WHERE id = ?`).run(b.id);
    assegnaPunti(b.passenger_id, 'viaggio_completato_passeggero', getRule('viaggio_completato_passeggero'), ride.id);
  }
  for (const b of assenti) {
    db.prepare(`UPDATE bookings SET stato = 'no_show' WHERE id = ?`).run(b.id);
  }
  // Richieste ancora in sospeso o in lista d'attesa quando il viaggio si conclude non hanno
  // più senso: il viaggio è già avvenuto, non c'è più nessun posto da promuovere.
  db.prepare(`UPDATE bookings SET stato = 'annullato' WHERE ride_id = ? AND stato IN ('richiesto','lista_attesa')`).run(ride.id);
  if (aBordo.length > 0) {
    const bonusKm = calcolaBonusKm(ride.km_stimati, aBordo.length);
    assegnaPunti(ride.driver_id, 'viaggio_completato_autista', getRule('viaggio_completato_autista') + bonusKm, ride.id);
  }
  if (aBordo.length > 0 && aBordo.length >= ride.posti_totali) {
    assegnaPunti(ride.driver_id, 'bonus_macchina_piena_autista', getRule('bonus_macchina_piena_autista'), ride.id, 'Macchina piena');
    for (const b of aBordo) {
      assegnaPunti(b.passenger_id, 'bonus_macchina_piena_passeggero', getRule('bonus_macchina_piena_passeggero'), ride.id, 'Macchina piena');
    }
  }
  return { passeggeri_a_bordo: aBordo.length, passeggeri_assenti: assenti.length };
}

// Crea un'offerta di passaggio (andata e/o ritorno -> se "entrambi", crea due rides)
router.post('/', requireAuth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const {
    tipo, data, ora_andata, ora_ritorno,
    punto_partenza, punto_arrivo, punto_partenza_ritorno, punto_arrivo_ritorno,
    citta_andata, citta_ritorno,
    sede_id_andata, sede_id_ritorno,
    partenza_lat, partenza_lon,
    partenza_ritorno_lat, partenza_ritorno_lon,
    geometria_andata, geometria_ritorno,
    km_stimati_andata, km_stimati_ritorno, km_calcolati_auto,
    posti_totali, note, soste_andata, soste_ritorno,
  } = req.body;

  if (!data || !tipo) return res.status(400).json({ error: 'Dati mancanti' });
  if (!me.sede_id) return res.status(400).json({ error: 'Imposta prima la tua sede nel profilo' });
  if (!dataLavorativa(data)) return res.status(400).json({ error: messaggioGiornoNonLavorativo(data) });

  // Non è possibile offrire passaggi per data/ora già passate.
  if ((tipo === 'andata' || tipo === 'entrambi') && isPastDateTime(data, ora_andata)) {
    return res.status(400).json({ error: 'Non puoi offrire un passaggio di andata per un orario già passato.' });
  }
  if ((tipo === 'ritorno' || tipo === 'entrambi') && isPastDateTime(data, ora_ritorno)) {
    return res.status(400).json({ error: 'Non puoi offrire un passaggio di ritorno per un orario già passato.' });
  }

  const posti = Math.max(1, Math.min(8, Number(posti_totali) || me.auto_posti || 3));
  const created = [];

  const insertOne = (t, ora, partenza, arrivo, soste, pLat, pLon, aLat, aLon, km, geometria, citta) => {
    const sedeRide = t === 'andata' ? (sede_id_andata || me.sede_id) : (sede_id_ritorno || me.sede_id);
    const info = db.prepare(`
      INSERT INTO rides (driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo,
        partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, km_stimati, km_calcolati_auto, geometria,
        posti_totali, posti_disponibili, note, citta_domicilio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      me.id, sedeRide, t, data, ora, partenza, arrivo,
      pLat || null, pLon || null, aLat || null, aLon || null,
      Number(km) || 0, km_calcolati_auto ? 1 : 0,
      geometria ? JSON.stringify(geometria) : null,
      posti, posti, note || null, citta || null
    );
    const rideId = info.lastInsertRowid;
    if (Array.isArray(soste)) {
      const ins = db.prepare('INSERT INTO ride_stops (ride_id, orario, luogo, descrizione, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
      for (const s of soste) {
        if (s && s.luogo) ins.run(rideId, s.orario || null, s.luogo, s.descrizione || null, s.lat || null, s.lon || null);
      }
    }
    assegnaPunti(me.id, 'offerta_creata', getRule('offerta_creata'), rideId, `Passaggio ${t} del ${data}`);
    registraAzione(me.id, 'passaggio_offerto', `${t} del ${data} alle ${ora}`, 'utente');
    created.push(rideId);
    const rideAppenaCreato = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    notificaMatchProattivo(rideAppenaCreato).catch((e) => console.error('Errore matching proattivo:', e.message));
    notificaPreferiti(rideAppenaCreato).catch((e) => console.error('Errore notifica preferiti:', e.message));
  };

  const sedeInfo = (id) => db.prepare('SELECT * FROM sedi WHERE id = ?').get(id || me.sede_id);

  if (tipo === 'andata' || tipo === 'entrambi') {
    if (!ora_andata || !punto_partenza) return res.status(400).json({ error: 'Dati andata mancanti' });
    const sede = sedeInfo(sede_id_andata);
    insertOne('andata', ora_andata, punto_partenza, sede?.nome || punto_arrivo || 'Sede aziendale', soste_andata,
      partenza_lat, partenza_lon, sede?.lat, sede?.lon, km_stimati_andata, geometria_andata, citta_andata);
  }
  if (tipo === 'ritorno' || tipo === 'entrambi') {
    if (!ora_ritorno || !punto_arrivo_ritorno) return res.status(400).json({ error: 'Dati ritorno mancanti' });
    const sede = sedeInfo(sede_id_ritorno);
    insertOne('ritorno', ora_ritorno, sede?.nome || punto_partenza_ritorno || 'Sede aziendale', punto_arrivo_ritorno, soste_ritorno,
      sede?.lat, sede?.lon, partenza_ritorno_lat, partenza_ritorno_lon, km_stimati_ritorno, geometria_ritorno, citta_ritorno);
  }

  res.json({ ride_ids: created });
});

// Ricerca passaggi.
// Filtri: sede_id, data, tipo, mine=1 (i miei offerti), home=1 (feed home: prossimi N giorni), storico=1 (con mine=1: passaggi passati/completati/annullati).
router.get('/', requireAuth, (req, res) => {
  const { sede_id, data, tipo, mine, home, storico } = req.query;
  let query = `
    SELECT r.*, u.nome as driver_nome, u.cognome as driver_cognome,
           u.auto_marca, u.auto_modello, u.auto_colore, s.nome as sede_nome
    FROM rides r JOIN users u ON u.id = r.driver_id LEFT JOIN sedi s ON s.id = r.sede_id
    WHERE 1=1
  `;
  const params = [];

  if (mine === '1') {
    query += ' AND r.driver_id = ?';
    params.push(req.user.id);
    if (storico === '1') {
      query += ` AND (r.stato IN ('completato','annullato') OR (r.stato = 'attivo' AND NOT ${UPCOMING_SQL}))`;
    } else {
      query += ` AND (r.stato = 'in_approvazione' OR (r.stato = 'attivo' AND ${UPCOMING_SQL}))`;
    }
  } else {
    query += ' AND r.stato = \'attivo\' AND r.sede_id = ? AND r.driver_id != ?';
    params.push(sede_id || req.user.sede_id, req.user.id);
    query += ` AND ${UPCOMING_SQL}`;
  }
  if (home === '1') {
    const giorni = Math.max(1, Math.min(30, Number(req.query.giorni) || 5));
    query += ` AND r.data <= date('now', 'localtime', ?)`;
    params.push(`+${giorni} days`);
  }
  if (data) { query += ' AND r.data = ?'; params.push(data); }
  if (tipo) { query += ' AND r.tipo = ?'; params.push(tipo); }

  query += ' ORDER BY r.data ASC, r.ora ASC';
  const rides = db.prepare(query).all(...params);

  const ids = rides.map((r) => r.id);
  const stopsByRide = {};
  const bookingsByRide = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const stops = db.prepare(`SELECT * FROM ride_stops WHERE ride_id IN (${placeholders})`).all(...ids);
    for (const s of stops) (stopsByRide[s.ride_id] ||= []).push(s);

    const bookings = db.prepare(`
      SELECT b.*, u.nome, u.cognome FROM bookings b JOIN users u ON u.id = b.passenger_id
      WHERE b.ride_id IN (${placeholders})
    `).all(...ids);
    for (const b of bookings) (bookingsByRide[b.ride_id] ||= []).push(b);
  }

  // Distanza tra il percorso reale già salvato per ogni passaggio e casa dell'utente che
  // sta cercando: permette al frontend di mostrare prima i passaggi "sulla sua strada".
  // Ha senso solo quando si sfogliano i passaggi altrui, non i propri offerti.
  const casaUtente = mine === '1' ? null : db.prepare('SELECT casa_lat, casa_lon FROM users WHERE id = ?').get(req.user.id);
  const preferitoStmt = db.prepare('SELECT 1 FROM favorite_rides WHERE follower_id = ? AND driver_id = ? AND tipo = ?');

  for (const r of rides) {
    r.soste = stopsByRide[r.id] || [];
    r.geometria = r.geometria ? JSON.parse(r.geometria) : null;
    const allB = bookingsByRide[r.id] || [];
    if (mine === '1') {
      r.prenotazioni = allB;
    } else {
      r.richieste_in_sospeso = allB.filter((b) => b.stato === 'richiesto').length;
      const miaPrenotazione = allB.find((b) => b.passenger_id === req.user.id);
      r.mia_prenotazione = miaPrenotazione ? miaPrenotazione.stato : null;
      r.distanza_casa_m = (casaUtente?.casa_lat != null && casaUtente?.casa_lon != null && r.geometria)
        ? Math.round(distanzaPuntoDaPercorso(casaUtente.casa_lat, casaUtente.casa_lon, r.geometria))
        : null;
      r.preferito = !!preferitoStmt.get(req.user.id, r.driver_id, r.tipo);
    }
  }

  res.json({ rides });
});

// Unifica in un'unica lista i passaggi offerti (come autista) e le prenotazioni fatte
// (come passeggero) ancora da svolgere, per la sezione "I miei prossimi passaggi".
router.get('/prossimi-miei', requireAuth, (req, res) => {
  const offerti = db.prepare(`
    SELECT r.id, r.tipo, r.data, r.ora, r.punto_partenza, r.punto_arrivo, r.stato,
           r.posti_totali, r.posti_disponibili, 'autista' as ruolo,
           (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.stato = 'richiesto') as richieste_in_sospeso
    FROM rides r
    WHERE r.driver_id = ? AND (r.stato = 'in_approvazione' OR (r.stato = 'attivo' AND ${UPCOMING_SQL}))
  `).all(req.user.id);

  const prenotati = db.prepare(`
    SELECT r.id, r.tipo, r.data, r.ora, r.punto_partenza, r.punto_arrivo, r.stato,
           b.stato as booking_stato, 'passeggero' as ruolo,
           u.nome as driver_nome, u.cognome as driver_cognome
    FROM bookings b
    JOIN rides r ON r.id = b.ride_id
    JOIN users u ON u.id = r.driver_id
    WHERE b.passenger_id = ? AND b.stato IN ('richiesto','confermato','lista_attesa')
      AND (r.stato = 'in_approvazione' OR (r.stato = 'attivo' AND ${UPCOMING_SQL}))
  `).all(req.user.id);

  const tutti = [...offerti, ...prenotati].sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
  res.json({ prossimi: tutti });
});

router.get('/:id', requireAuth, (req, res) => {
  const ride = getRideFull(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Passaggio non trovato' });
  const isDriver = ride.driver_id === req.user.id;
  const isPassenger = ride.prenotazioni.some((b) => b.passenger_id === req.user.id);
  const isMM = req.user.ruolo === 'mobility_manager';
  if (!isDriver && !isPassenger && !isMM) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  res.json({ ride });
});

// Modifica di un passaggio esistente (solo l'autista o un mobility manager, e solo se
// ancora attivo). Se ci sono richieste/conferme attive, i passeggeri vengono avvisati.
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Non trovato' });
  if (ride.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  if (ride.stato !== 'attivo') {
    return res.status(400).json({ error: 'Questo passaggio non può più essere modificato' });
  }

  const {
    data, ora, punto_partenza, punto_arrivo, sede_id,
    partenza_lat, partenza_lon, arrivo_lat, arrivo_lon,
    km_stimati, geometria, posti_totali, note, soste, citta_domicilio,
  } = req.body;

  const nuovaData = data || ride.data;
  const nuovaOra = ora || ride.ora;
  if (nuovaData !== ride.data && !dataLavorativa(nuovaData)) return res.status(400).json({ error: messaggioGiornoNonLavorativo(nuovaData) });
  if (isPastDateTime(nuovaData, nuovaOra)) {
    return res.status(400).json({ error: 'Non puoi impostare un orario già passato.' });
  }

  const impegnati = db.prepare(`
    SELECT COUNT(*) as n FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato')
  `).get(ride.id).n;
  const nuoviPosti = Math.max(1, Math.min(8, Number(posti_totali) || ride.posti_totali));
  if (nuoviPosti < impegnati) {
    return res.status(400).json({ error: `Non puoi scendere sotto ${impegnati} posti: ci sono già richieste/conferme attive.` });
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE rides SET data = ?, ora = ?, punto_partenza = ?, punto_arrivo = ?, sede_id = ?,
        partenza_lat = ?, partenza_lon = ?, arrivo_lat = ?, arrivo_lon = ?,
        km_stimati = ?, geometria = ?, posti_totali = ?,
        posti_disponibili = posti_disponibili + (? - posti_totali), note = ?, citta_domicilio = ?
      WHERE id = ?
    `).run(
      nuovaData, nuovaOra, punto_partenza || ride.punto_partenza, punto_arrivo || ride.punto_arrivo,
      sede_id || ride.sede_id,
      partenza_lat ?? ride.partenza_lat, partenza_lon ?? ride.partenza_lon,
      arrivo_lat ?? ride.arrivo_lat, arrivo_lon ?? ride.arrivo_lon,
      km_stimati ?? ride.km_stimati, geometria ? JSON.stringify(geometria) : ride.geometria,
      nuoviPosti, nuoviPosti, note ?? ride.note, citta_domicilio ?? ride.citta_domicilio,
      ride.id
    );
    if (Array.isArray(soste)) {
      db.prepare('DELETE FROM ride_stops WHERE ride_id = ?').run(ride.id);
      const ins = db.prepare('INSERT INTO ride_stops (ride_id, orario, luogo, descrizione, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
      for (const s of soste) {
        if (s && s.luogo) ins.run(ride.id, s.orario || null, s.luogo, s.descrizione || null, s.lat || null, s.lon || null);
      }
    }
  });
  tx();

  if (impegnati > 0) {
    const passeggeri = db.prepare(`
      SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato') LIMIT 50
    `).all(ride.id).slice(0, 50).map((b) => b.passenger_id);
    notificaMassiva(
      passeggeri, 'passaggio_modificato',
      `Il passaggio ${ride.tipo} del ${nuovaData} è stato modificato dall'autista (nuovo orario: ${nuovaOra}). Controlla i dettagli.`,
      ride.id
    );
  }

  registraAzione(req.user.id, 'passaggio_modificato', `Passaggio #${ride.id}, ${nuovaData} ${nuovaOra}`, 'utente');

  // Più posti disponibili di prima: se qualcuno era in lista d'attesa, promuovilo.
  if (nuoviPosti > ride.posti_totali) {
    await notificaPromossi(promuoviListaAttesa(ride.id));
  }

  res.json({ ride: getRideFull(ride.id) });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Non trovato' });
  if (ride.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  const passeggeriCoinvolti = db.prepare(`
    SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa') LIMIT 50
  `).all(req.params.id).slice(0, 50).map((b) => b.passenger_id);

  db.prepare(`UPDATE rides SET stato = 'annullato' WHERE id = ?`).run(req.params.id);
  db.prepare(`UPDATE bookings SET stato = 'annullato' WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')`).run(req.params.id);

  if (ride.driver_id !== req.user.id) {
    registraAzione(req.user.id, 'passaggio_annullato_da_mm', `Passaggio #${ride.id} di un altro utente, ${ride.data} ${ride.ora}`);
  } else {
    registraAzione(req.user.id, 'passaggio_annullato', `Passaggio #${ride.id}, ${ride.data} ${ride.ora}`, 'utente');
  }

  if (passeggeriCoinvolti.length > 0) {
    await notificaMassiva(
      passeggeriCoinvolti, 'viaggio_annullato',
      `Il passaggio ${ride.tipo} del ${ride.data} alle ${ride.ora} è stato annullato dall'autista.`,
      ride.id
    );
  }
  res.json({ ok: true });
}));

// Avvisa in un tap solo i passeggeri confermati non ancora saliti a bordo: chi ha già
// fatto check-in è già con l'autista e non ha bisogno di un avviso di ritardo.
router.post('/:id/ritardo', requireAuth, asyncHandler(async (req, res) => {
  const minuti = Number(req.body.minuti);
  if (!Number.isFinite(minuti) || minuti <= 0) return res.status(400).json({ error: 'Indica i minuti di ritardo' });
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Non trovato' });
  if (ride.driver_id !== req.user.id) return res.status(403).json({ error: 'Non autorizzato' });
  if (ride.stato !== 'attivo') return res.status(400).json({ error: 'Questo passaggio non è più attivo' });

  const daAvvisare = db.prepare(`
    SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato = 'confermato' AND check_in != 1 LIMIT 50
  `).all(ride.id).slice(0, 50).map((b) => b.passenger_id);

  if (daAvvisare.length === 0) return res.json({ ok: true, avvisati: 0 });

  await notificaMassiva(
    daAvvisare, 'autista_in_ritardo',
    `L'autista del tuo passaggio delle ${ride.ora} è in ritardo di circa ${minuti} minuti.`,
    ride.id
  );
  registraAzione(req.user.id, 'passaggio_ritardo_segnalato', `Passaggio #${ride.id}: ${minuti} min`, 'utente');
  res.json({ ok: true, avvisati: daAvvisare.length });
}));

// Segna un viaggio come completato. Se l'impostazione "richiede approvazione" è attiva,
// il viaggio passa in stato "in_approvazione" e i punti vengono assegnati solo quando
// un mobility manager lo approva; altrimenti i punti vengono assegnati subito.
router.post('/:id/completa', requireAuth, asyncHandler(async (req, res) => {
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride) return res.status(404).json({ error: 'Non trovato' });
  if (ride.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  if (ride.stato !== 'attivo') return res.status(400).json({ error: 'Questo viaggio non può essere completato' });

  const settings = db.prepare('SELECT richiede_approvazione_completamento FROM system_settings WHERE id = 1').get();

  if (settings.richiede_approvazione_completamento) {
    db.prepare(`UPDATE rides SET stato = 'in_approvazione' WHERE id = ?`).run(ride.id);
    const mm = db.prepare(`SELECT id FROM users WHERE ruolo = 'mobility_manager' AND attivo = 1`).all();
    await notificaMassiva(
      mm.map((m) => m.id), 'completamento_da_approvare',
      `Nuovo viaggio da approvare: ${ride.tipo} del ${ride.data} alle ${ride.ora}.`,
      ride.id
    );
    registraAzione(req.user.id, 'completamento_richiesto', `Passaggio #${ride.id}, in attesa di approvazione`, 'utente');
    return res.json({ ok: true, stato: 'in_approvazione' });
  }

  const risultato = eseguiCompletamento(ride);
  registraAzione(req.user.id, 'viaggio_completato', `Passaggio #${ride.id}, ${risultato.passeggeri_a_bordo} a bordo`, 'utente');
  res.json({ ok: true, stato: 'completato', ...risultato });
}));

// Elenco viaggi in attesa di approvazione (solo mobility manager)
router.get('/pending/approvazione', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const rides = db.prepare(`
    SELECT r.*, u.nome as driver_nome, u.cognome as driver_cognome
    FROM rides r JOIN users u ON u.id = r.driver_id
    WHERE r.stato = 'in_approvazione'
    ORDER BY r.data, r.ora
  `).all();
  for (const r of rides) {
    const confermate = db.prepare(`SELECT * FROM bookings WHERE ride_id = ? AND stato = 'confermato'`).all(r.id);
    r.passeggeri_confermati = confermate.length;
    r.passeggeri_a_bordo = confermate.filter((b) => b.check_in === 1).length;
  }
  res.json({ rides });
});

router.post('/:id/approva-completamento', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride || ride.stato !== 'in_approvazione') return res.status(400).json({ error: 'Nessuna approvazione in sospeso per questo viaggio' });

  const risultato = eseguiCompletamento(ride);
  await notifica(ride.driver_id, 'completamento_approvato',
    `Il tuo viaggio ${ride.tipo} del ${ride.data} è stato approvato: punti assegnati.`, ride.id);
  registraAzione(req.user.id, 'completamento_approvato', `Passaggio #${ride.id}`);
  res.json({ ok: true, ...risultato });
}));

router.post('/:id/rifiuta-completamento', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const { motivo } = req.body;
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
  if (!ride || ride.stato !== 'in_approvazione') return res.status(400).json({ error: 'Nessuna approvazione in sospeso per questo viaggio' });

  db.prepare(`UPDATE rides SET stato = 'attivo' WHERE id = ?`).run(ride.id);
  await notifica(ride.driver_id, 'completamento_rifiutato',
    `Il completamento del viaggio del ${ride.data} è stato rifiutato${motivo ? `: ${motivo}` : ''}. Puoi correggere e riprovare.`, ride.id);
  registraAzione(req.user.id, 'completamento_rifiutato_mm', `Passaggio #${ride.id}${motivo ? `: ${motivo}` : ''}`);
  res.json({ ok: true });
}));

module.exports = router;
