const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { assegnaPunti, getRule } = require('../utils/points');
const { registraAzione } = require('../utils/audit');
const { notificaMatchProattivo, notificaPreferiti } = require('../utils/matching');
const { notificaMassiva } = require('../utils/notify');
const { asyncHandler } = require('../utils/asyncHandler');
const { giorniLavorativi, NOMI } = require('../utils/calendario');

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!me.sede_id) return res.status(400).json({ error: 'Imposta prima la tua sede nel profilo' });

  const {
    tipo, giorni_settimana, ora, punto_partenza, punto_arrivo, sede_id,
    partenza_lat, partenza_lon, arrivo_lat, arrivo_lon,
    km_stimati, geometria, posti_totali, note, soste,
    data_inizio, data_fine, citta_domicilio,
  } = req.body;

  if (!tipo || !giorni_settimana || !giorni_settimana.length || !ora || !punto_partenza || !punto_arrivo) {
    return res.status(400).json({ error: 'Dati mancanti per il turno fisso' });
  }

  // Normalizza a interi 1-7 (1=lun..7=dom) validi e senza duplicati, prima di salvarli:
  // senza questo controllo un array arbitrariamente lungo/malformato finirebbe salvato
  // così com'è e poi riletto a ogni generazione delle occorrenze (generaOccorrenzePerTemplate).
  // .slice(0, 7): ci sono solo 7 giorni della settimana, un array più lungo è per
  // definizione fatto solo di duplicati/valori scartati — limite esplicito prima di
  // qualunque map/filter, non solo garantito dalla dimensione naturale dell'input.
  const giorniNormalizzati = [...new Set(giorni_settimana.slice(0, 7).map(Number).filter((g) => Number.isInteger(g) && g >= 1 && g <= 7))];
  if (giorniNormalizzati.length === 0) {
    return res.status(400).json({ error: 'Indica almeno un giorno della settimana valido (1-7)' });
  }

  const lavorativi = giorniLavorativi();
  const nonLavorativi = giorniNormalizzati.filter((g) => !lavorativi.includes(g));
  if (nonLavorativi.length) {
    return res.status(400).json({ error: `La tua azienda non prevede passaggi di ${nonLavorativi.map((g) => NOMI[g]).join(', ')}. Togli ${nonLavorativi.length === 1 ? 'quel giorno' : 'quei giorni'} dal turno.` });
  }

  const posti = Math.max(1, Math.min(8, Number(posti_totali) || me.auto_posti || 3));
  const info = db.prepare(`
    INSERT INTO recurring_rides (
      driver_id, tipo, giorni_settimana, ora, punto_partenza, punto_arrivo, sede_id,
      partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, km_stimati, geometria,
      posti_totali, note, soste, data_inizio, data_fine, citta_domicilio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    me.id, tipo, giorniNormalizzati.join(','), ora, punto_partenza, punto_arrivo, sede_id || me.sede_id,
    partenza_lat || null, partenza_lon || null, arrivo_lat || null, arrivo_lon || null,
    Number(km_stimati) || 0, geometria ? JSON.stringify(geometria) : null,
    posti, note || null, soste ? JSON.stringify(soste) : null,
    data_inizio, data_fine || null, citta_domicilio || null
  );

  registraAzione(me.id, 'turno_fisso_creato', `${tipo} alle ${ora}, giorni: ${giorniNormalizzati.join(',')}`, 'utente');

  const generati = generaOccorrenzePerTemplate(info.lastInsertRowid, 14);
  res.json({ recurring_ride: db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(info.lastInsertRowid), generati });
});

router.get('/mie', requireAuth, (req, res) => {
  const turni = db.prepare(`
    SELECT r.*, s.nome as sede_nome FROM recurring_rides r LEFT JOIN sedi s ON s.id = r.sede_id
    WHERE r.driver_id = ? ORDER BY r.attivo DESC, r.created_at DESC
  `).all(req.user.id);
  res.json({ turni });
});

router.put('/:id/attivo', requireAuth, asyncHandler(async (req, res) => {
  const { attivo } = req.body;
  const turno = db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(req.params.id);
  if (!turno) return res.status(404).json({ error: 'Non trovato' });
  if (turno.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  db.prepare('UPDATE recurring_rides SET attivo = ? WHERE id = ?').run(attivo ? 1 : 0, turno.id);

  if (!attivo) {
    // Annulla le occorrenze future già generate ma non ancora svolte, e avvisa gli
    // eventuali passeggeri coinvolti (richieste, conferme, lista d'attesa) — coerente con
    // come viene gestito l'annullamento di un singolo passaggio o di una singola data.
    const future = db.prepare(`
      SELECT id, tipo, data, ora FROM rides WHERE recurring_ride_id = ? AND stato = 'attivo'
        AND (data > date('now','localtime') OR (data = date('now','localtime') AND ora >= strftime('%H:%M','now','localtime')))
    `).all(turno.id);
    for (const r of future) {
      const passeggeriCoinvolti = db.prepare(`
        SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa') LIMIT 50
      `).all(r.id).slice(0, 50).map((b) => b.passenger_id);
      db.prepare(`UPDATE rides SET stato = 'annullato' WHERE id = ?`).run(r.id);
      db.prepare(`
        UPDATE bookings SET stato = 'annullato' WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')
      `).run(r.id);
      if (passeggeriCoinvolti.length > 0) {
        await notificaMassiva(
          passeggeriCoinvolti, 'viaggio_annullato',
          `Il passaggio ${r.tipo} del ${r.data} alle ${r.ora} è stato annullato dall'autista.`,
          r.id
        );
      }
    }
  }
  registraAzione(req.user.id, attivo ? 'turno_fisso_riattivato' : 'turno_fisso_sospeso', `Turno #${turno.id}`, 'utente');
  res.json({ ok: true });
}));

router.delete('/:id', requireAuth, (req, res) => {
  const turno = db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(req.params.id);
  if (!turno) return res.status(404).json({ error: 'Non trovato' });
  if (turno.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  db.prepare('UPDATE recurring_rides SET attivo = 0 WHERE id = ?').run(turno.id);
  registraAzione(req.user.id, 'turno_fisso_eliminato', `Turno #${turno.id}`, 'utente');
  res.json({ ok: true });
});

function trovaTurnoAutorizzato(req, res) {
  const turno = db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(req.params.id);
  if (!turno) { res.status(404).json({ error: 'Non trovato' }); return null; }
  if (turno.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    res.status(403).json({ error: 'Non autorizzato' });
    return null;
  }
  return turno;
}

// Date future in cui questo turno fisso non genera/mantiene un'occorrenza.
router.get('/:id/eccezioni', requireAuth, (req, res) => {
  const turno = trovaTurnoAutorizzato(req, res);
  if (!turno) return;
  const eccezioni = db.prepare(`
    SELECT data FROM recurring_ride_exceptions
    WHERE recurring_ride_id = ? AND data >= date('now','localtime') ORDER BY data LIMIT 1000
  `).all(turno.id).slice(0, 1000).map((r) => r.data);
  res.json({ eccezioni });
});

// Salta una singola data (es. ferie/malattia di un giorno) senza sospendere l'intero
// turno. Se per quella data era già stata generata un'occorrenza attiva, la annulla e
// avvisa gli eventuali passeggeri coinvolti.
router.post('/:id/eccezioni', requireAuth, asyncHandler(async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Data richiesta' });
  const turno = trovaTurnoAutorizzato(req, res);
  if (!turno) return;

  try {
    db.prepare('INSERT INTO recurring_ride_exceptions (recurring_ride_id, data) VALUES (?, ?)').run(turno.id, data);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Questa data è già stata saltata' });
    throw e;
  }

  const occorrenza = db.prepare(`
    SELECT * FROM rides WHERE recurring_ride_id = ? AND data = ? AND stato = 'attivo'
  `).get(turno.id, data);
  if (occorrenza) {
    const passeggeriCoinvolti = db.prepare(`
      SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa') LIMIT 50
    `).all(occorrenza.id).slice(0, 50).map((b) => b.passenger_id);
    db.prepare(`UPDATE rides SET stato = 'annullato' WHERE id = ?`).run(occorrenza.id);
    db.prepare(`
      UPDATE bookings SET stato = 'annullato' WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')
    `).run(occorrenza.id);
    if (passeggeriCoinvolti.length > 0) {
      await notificaMassiva(
        passeggeriCoinvolti, 'viaggio_annullato',
        `Il passaggio ${occorrenza.tipo} del ${occorrenza.data} alle ${occorrenza.ora} è stato annullato dall'autista.`,
        occorrenza.id
      );
    }
  }

  registraAzione(req.user.id, 'turno_fisso_data_saltata', `Turno #${turno.id}: ${data}`, 'utente');
  res.json({ ok: true });
}));

// Ripristina una data precedentemente saltata. Se per quella data era già stata generata
// un'occorrenza (poi annullata quando la data è stata saltata), la riattiva direttamente:
// generaOccorrenzePerTemplate non genera una seconda riga per una data che ha già una
// riga in rides, quale che sia il suo stato. Se invece non era mai stata generata (es.
// eccezione aggiunta prima che lo scheduler passasse di lì), la genera da zero se rientra
// ancora nella finestra dei prossimi 14 giorni.
router.delete('/:id/eccezioni/:data', requireAuth, (req, res) => {
  const turno = trovaTurnoAutorizzato(req, res);
  if (!turno) return;
  db.prepare('DELETE FROM recurring_ride_exceptions WHERE recurring_ride_id = ? AND data = ?').run(turno.id, req.params.data);

  const esistente = db.prepare(`SELECT * FROM rides WHERE recurring_ride_id = ? AND data = ?`).get(turno.id, req.params.data);
  let generati = 0;
  if (esistente && esistente.stato === 'annullato') {
    db.prepare(`UPDATE rides SET stato = 'attivo', posti_disponibili = posti_totali WHERE id = ?`).run(esistente.id);
  } else if (!esistente) {
    generati = generaOccorrenzePerTemplate(turno.id, 14);
  }

  registraAzione(req.user.id, 'turno_fisso_data_ripristinata', `Turno #${turno.id}: ${req.params.data}`, 'utente');
  res.json({ ok: true, generati });
});

// Genera le occorrenze mancanti (rides) per un singolo template, nei prossimi `giorni` giorni.
// Evita duplicati controllando (recurring_ride_id, data) già esistenti.
function generaOccorrenzePerTemplate(recurringId, giorni) {
  const t = db.prepare('SELECT * FROM recurring_rides WHERE id = ? AND attivo = 1').get(recurringId);
  if (!t) return 0;
  // I giorni del turno e quelli lavorativi dell'azienda: se il mobility manager ne toglie uno
  // dopo la creazione del turno, non si generano più passaggi in quel giorno.
  const lavorativi = giorniLavorativi();
  const giorniValidi = t.giorni_settimana.split(',').slice(0, 7).map(Number).filter((g) => lavorativi.includes(g));
  const soste = t.soste ? JSON.parse(t.soste) : [];
  let generati = 0;

  for (let i = 0; i < giorni; i++) {
    const giorno = new Date();
    giorno.setDate(giorno.getDate() + i);
    const data = `${giorno.getFullYear()}-${String(giorno.getMonth() + 1).padStart(2, '0')}-${String(giorno.getDate()).padStart(2, '0')}`;
    if (data < t.data_inizio) continue;
    if (t.data_fine && data > t.data_fine) continue;

    const isoWeekday = giorno.getDay(); // 0=domenica..6=sabato
    const giornoLunBasato = isoWeekday === 0 ? 7 : isoWeekday; // 1=lun..7=dom
    if (!giorniValidi.includes(giornoLunBasato)) continue;

    const esiste = db.prepare('SELECT 1 FROM rides WHERE recurring_ride_id = ? AND data = ?').get(t.id, data);
    if (esiste) continue;

    const saltata = db.prepare('SELECT 1 FROM recurring_ride_exceptions WHERE recurring_ride_id = ? AND data = ?').get(t.id, data);
    if (saltata) continue;

    const info = db.prepare(`
      INSERT INTO rides (
        driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo,
        partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, km_stimati, km_calcolati_auto, geometria,
        posti_totali, posti_disponibili, note, recurring_ride_id, citta_domicilio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      t.driver_id, t.sede_id, t.tipo, data, t.ora, t.punto_partenza, t.punto_arrivo,
      t.partenza_lat, t.partenza_lon, t.arrivo_lat, t.arrivo_lon, t.km_stimati, t.geometria,
      t.posti_totali, t.posti_totali, t.note, t.id, t.citta_domicilio
    );
    const rideId = info.lastInsertRowid;
    if (soste.length) {
      const ins = db.prepare('INSERT INTO ride_stops (ride_id, orario, luogo, descrizione, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
      for (const s of soste) {
        if (s && s.luogo) ins.run(rideId, s.orario || null, s.luogo, s.descrizione || null, s.lat || null, s.lon || null);
      }
    }
    assegnaPunti(t.driver_id, 'offerta_creata', getRule('offerta_creata'), rideId, `Turno fisso #${t.id}, ${data}`);
    const rideCompleto = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    notificaMatchProattivo(rideCompleto).catch((e) => console.error('Errore matching proattivo:', e.message));
    notificaPreferiti(rideCompleto).catch((e) => console.error('Errore notifica preferiti:', e.message));
    generati++;
  }
  return generati;
}

// Esegue la generazione per TUTTI i template attivi (usata dallo scheduler periodico)
function generaTutteLeOccorrenze(giorni = 14) {
  const templates = db.prepare('SELECT id FROM recurring_rides WHERE attivo = 1').all();
  let totale = 0;
  for (const t of templates) totale += generaOccorrenzePerTemplate(t.id, giorni);
  return totale;
}

module.exports = router;
module.exports.generaOccorrenzePerTemplate = generaOccorrenzePerTemplate;
module.exports.generaTutteLeOccorrenze = generaTutteLeOccorrenze;
