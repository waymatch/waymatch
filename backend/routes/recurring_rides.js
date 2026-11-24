const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { assegnaPunti, getRule, kmDalServer } = require('../utils/points');
const { registraAzione } = require('../utils/audit');
const { notificaMatchProattivo, notificaPreferiti } = require('../utils/matching');
const { notificaMassiva } = require('../utils/notify');
const { asyncHandler } = require('../utils/asyncHandler');
const { richiediDocumentiConducente, documentiPendenti } = require('../utils/documentiLegali');
const { giorniLavorativi, NOMI } = require('../utils/calendario');
const { geometriaValida, sosteValide } = require('../utils/geoDistance');

const router = express.Router();

router.post('/', requireAuth, richiediDocumentiConducente, asyncHandler(async (req, res) => {
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
  if (!['andata', 'ritorno'].includes(tipo)) return res.status(400).json({ error: 'Tipo di turno non valido' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ora)) return res.status(400).json({ error: 'Orario non valido (formato HH:MM)' });
  if (geometria != null && !geometriaValida(geometria)) return res.status(400).json({ error: 'Percorso non valido' });
  if (!sosteValide(soste)) return res.status(400).json({ error: 'Soste non valide' });
  if (posti_totali != null && posti_totali !== '' && !(Number.isInteger(Number(posti_totali)) && Number(posti_totali) >= 1 && Number(posti_totali) <= 8)) {
    return res.status(400).json({ error: 'I posti devono essere un numero intero da 1 a 8' });
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

  // Anche il valore preso dal profilo diventa un intero da 1 a 8.
  const posti = posti_totali != null && posti_totali !== ''
    ? Number(posti_totali)
    : Math.max(1, Math.min(8, Math.trunc(Number(me.auto_posti)) || 3));
  // Km del percorso calcolati una volta dal server: valgono per tutte le occorrenze.
  const kmVerificati = await kmDalServer(partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, soste);
  // Controllo ripetuto dopo l'attesa dei km (vedi rides.js): da qui all'inserimento non ci sono attese.
  if (documentiPendenti(req.user.id, 'conducente').length > 0) {
    return res.status(403).json({ error: 'Prima di offrire un passaggio devi accettare i documenti del conducente.', codice: 'DOCUMENTI_DA_ACCETTARE' });
  }
  const info = db.prepare(`
    INSERT INTO recurring_rides (
      driver_id, tipo, giorni_settimana, ora, punto_partenza, punto_arrivo, sede_id,
      partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, km_stimati, geometria,
      posti_totali, note, soste, data_inizio, data_fine, citta_domicilio, km_verificati
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    me.id, tipo, giorniNormalizzati.join(','), ora, punto_partenza, punto_arrivo, sede_id || me.sede_id,
    partenza_lat ?? null, partenza_lon ?? null, arrivo_lat ?? null, arrivo_lon ?? null,
    Number(km_stimati) || 0, geometria != null ? JSON.stringify(geometria) : null,
    posti, note || null, soste ? JSON.stringify(soste) : null,
    data_inizio, data_fine || null, citta_domicilio || null, kmVerificati
  );

  registraAzione(me.id, 'turno_fisso_creato', `${tipo} alle ${ora}, giorni: ${giorniNormalizzati.join(',')}`, 'utente');

  const generati = generaOccorrenzePerTemplate(info.lastInsertRowid, 14);
  res.json({ recurring_ride: db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(info.lastInsertRowid), generati });
}));

router.get('/mie', requireAuth, (req, res) => {
  const turni = db.prepare(`
    SELECT r.*, s.nome as sede_nome FROM recurring_rides r LEFT JOIN sedi s ON s.id = r.sede_id
    WHERE r.driver_id = ? ORDER BY r.attivo DESC, r.created_at DESC
  `).all(req.user.id);
  res.json({ turni });
});

const FUTURO = `(data > date('now','localtime') OR (data = date('now','localtime') AND ora >= strftime('%H:%M','now','localtime')))`;

// Annulla un'occorrenza e le sue prenotazioni attive; ritorna chi avvisare. Da chiamare dentro
// una transazione: gli avvisi si inviano dopo, così un invio fallito non lascia il lavoro a metà.
function annullaOccorrenza(r, motivo = null) {
  const coinvolti = db.prepare(`
    SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')
  `).all(r.id).map((b) => b.passenger_id);
  db.prepare(`UPDATE rides SET stato = 'annullato', motivo_annullamento = ? WHERE id = ?`).run(motivo, r.id);
  db.prepare(`
    UPDATE bookings SET stato = 'annullato' WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')
  `).run(r.id);
  return coinvolti.length ? { ride: r, coinvolti } : null;
}

// Avvisi ai passeggeri dopo il commit; notificaMassiva non rifiuta mai.
function avvisaAnnullamenti(avvisi) {
  return Promise.all(avvisi.map((a) => notificaMassiva(
    a.coinvolti, 'viaggio_annullato',
    `Il passaggio ${a.ride.tipo} del ${a.ride.data} alle ${a.ride.ora} è stato annullato dall'autista.`,
    a.ride.id
  )));
}

// Sospende il turno e annulla le occorrenze future già generate, ricordando che sono state
// annullate dalla sospensione: alla riattivazione tornano disponibili.
function sospendiTurno(turno) {
  db.prepare('UPDATE recurring_rides SET attivo = 0 WHERE id = ?').run(turno.id);
  const future = db.prepare(`SELECT * FROM rides WHERE recurring_ride_id = ? AND stato = 'attivo' AND ${FUTURO}`).all(turno.id);
  return future.map((r) => annullaOccorrenza(r, 'sospensione_turno')).filter(Boolean);
}

// Riattiva il turno e ripristina le occorrenze future annullate dalla sospensione (non quelle
// annullate a mano o per una data saltata).
function riattivaTurno(turno) {
  db.prepare('UPDATE recurring_rides SET attivo = 1 WHERE id = ?').run(turno.id);
  db.prepare(`
    UPDATE rides SET stato = 'attivo', posti_disponibili = posti_totali, motivo_annullamento = NULL
    WHERE recurring_ride_id = ? AND stato = 'annullato' AND motivo_annullamento = 'sospensione_turno' AND ${FUTURO}
      AND data NOT IN (SELECT data FROM recurring_ride_exceptions WHERE recurring_ride_id = ?)
  `).run(turno.id, turno.id);
}

router.put('/:id/attivo', requireAuth, asyncHandler(async (req, res) => {
  const { attivo } = req.body;
  const turno = db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(req.params.id);
  if (!turno) return res.status(404).json({ error: 'Non trovato' });
  if (turno.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  const avvisi = db.transaction(() => {
    const a = attivo ? (riattivaTurno(turno), []) : sospendiTurno(turno);
    registraAzione(req.user.id, attivo ? 'turno_fisso_riattivato' : 'turno_fisso_sospeso', `Turno #${turno.id}`, 'utente');
    return a;
  })();
  if (attivo) generaOccorrenzePerTemplate(turno.id, 14);
  await avvisaAnnullamenti(avvisi);
  res.json({ ok: true });
}));

// Eliminare un turno lo sospende e ne annulla le occorrenze future, avvisando i passeggeri.
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const turno = db.prepare('SELECT * FROM recurring_rides WHERE id = ?').get(req.params.id);
  if (!turno) return res.status(404).json({ error: 'Non trovato' });
  if (turno.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  const avvisi = db.transaction(() => {
    const a = sospendiTurno(turno);
    registraAzione(req.user.id, 'turno_fisso_eliminato', `Turno #${turno.id}`, 'utente');
    return a;
  })();
  await avvisaAnnullamenti(avvisi);
  res.json({ ok: true });
}));

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
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: 'Data richiesta (formato AAAA-MM-GG)' });
  const turno = trovaTurnoAutorizzato(req, res);
  if (!turno) return;

  let avvisi;
  try {
    avvisi = db.transaction(() => {
      db.prepare('INSERT INTO recurring_ride_exceptions (recurring_ride_id, data) VALUES (?, ?)').run(turno.id, data);
      const occorrenza = db.prepare(`
        SELECT * FROM rides WHERE recurring_ride_id = ? AND data = ? AND stato = 'attivo'
      `).get(turno.id, data);
      registraAzione(req.user.id, 'turno_fisso_data_saltata', `Turno #${turno.id}: ${data}`, 'utente');
      return occorrenza ? [annullaOccorrenza(occorrenza, 'data_saltata')].filter(Boolean) : [];
    })();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Questa data è già stata saltata' });
    throw e;
  }
  await avvisaAnnullamenti(avvisi);
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

  // Solo occorrenze non ancora partite: una data già trascorsa non torna disponibile.
  const esistente = db.prepare(`SELECT * FROM rides WHERE recurring_ride_id = ? AND data = ? AND ${FUTURO}`).get(turno.id, req.params.data);
  let generati = 0;
  // Si ripristina solo un passaggio annullato perché la data era saltata (non uno annullato a
  // mano). Con il turno sospeso resta annullato, ma come se l'avesse annullato la sospensione:
  // così torna disponibile alla riattivazione.
  // (Una data saltata durante la sospensione conserva il motivo 'sospensione_turno': vale lo stesso.)
  if (esistente && esistente.stato === 'annullato' && ['data_saltata', 'sospensione_turno'].includes(esistente.motivo_annullamento)) {
    if (turno.attivo) {
      db.prepare(`UPDATE rides SET stato = 'attivo', posti_disponibili = posti_totali, motivo_annullamento = NULL WHERE id = ?`).run(esistente.id);
    } else {
      db.prepare(`UPDATE rides SET motivo_annullamento = 'sospensione_turno' WHERE id = ?`).run(esistente.id);
    }
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
  const sosteSalvate = t.soste ? JSON.parse(t.soste) : [];
  const soste = Array.isArray(sosteSalvate) ? sosteSalvate : [];
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

    // Mai un'occorrenza già partita (oggi, con l'orario passato): niente punti né avvisi.
    const giaPartita = db.prepare(`SELECT ? < date('now','localtime') OR (? = date('now','localtime') AND ? < strftime('%H:%M','now','localtime')) AS p`).get(data, data, t.ora).p;
    if (giaPartita) continue;

    const saltata = db.prepare('SELECT 1 FROM recurring_ride_exceptions WHERE recurring_ride_id = ? AND data = ?').get(t.id, data);
    if (saltata) continue;

    // Occorrenza, soste e punti in un'unica transazione: un errore a metà non lascia una
    // riga incompleta che il controllo "esiste già" renderebbe definitiva.
    const rideId = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO rides (
          driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo,
          partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, km_stimati, km_calcolati_auto, geometria,
          posti_totali, posti_disponibili, note, recurring_ride_id, citta_domicilio, km_verificati
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t.driver_id, t.sede_id, t.tipo, data, t.ora, t.punto_partenza, t.punto_arrivo,
        t.partenza_lat, t.partenza_lon, t.arrivo_lat, t.arrivo_lon, t.km_stimati, t.geometria,
        t.posti_totali, t.posti_totali, t.note, t.id, t.citta_domicilio, t.km_verificati
      );
      const id = info.lastInsertRowid;
      if (soste.length) {
        const ins = db.prepare('INSERT INTO ride_stops (ride_id, orario, luogo, descrizione, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
        for (const s of soste) {
          if (s && s.luogo) ins.run(id, s.orario || null, s.luogo, s.descrizione || null, s.lat ?? null, s.lon ?? null);
        }
      }
      assegnaPunti(t.driver_id, 'offerta_creata', getRule('offerta_creata'), id, `Turno fisso #${t.id}, ${data}`);
      return id;
    })();
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
