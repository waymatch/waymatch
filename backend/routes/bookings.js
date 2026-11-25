const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifica } = require('../utils/notify');
const { registraAzione } = require('../utils/audit');
const { confrontoSicuro } = require('../utils/compare');
const { promuoviListaAttesa, notificaPromossi } = require('../utils/waitlist');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Passaggio non ancora partito (data e ora locali).
const FUTURO = `(data > date('now','localtime') OR (data = date('now','localtime') AND ora >= strftime('%H:%M','now','localtime')))`;
// Istante con i millisecondi: ordina la lista d'attesa anche tra richieste nello stesso secondo.
const ADESSO_MS = "strftime('%Y-%m-%d %H:%M:%f','now')";

// Richiedi un posto in un passaggio. Il limite si basa su richieste+conferme totali (non
// solo sui posti già confermati), così un'offerta non riceve più richieste di quanti
// posti abbia davvero, anche prima che l'autista le approvi. Se il passaggio è già al
// completo, la richiesta entra in lista d'attesa: verrà promossa automaticamente a
// "richiesta" (vedi utils/waitlist.js) se si libera un posto.
router.post('/rides/:rideId/book', requireAuth, asyncHandler(async (req, res) => {
  const { punto_salita } = req.body;
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.rideId);
  if (!ride || ride.stato !== 'attivo') return res.status(404).json({ error: 'Passaggio non disponibile' });
  if (!db.prepare(`SELECT 1 FROM rides WHERE id = ? AND ${FUTURO}`).get(ride.id)) {
    return res.status(400).json({ error: 'Questo passaggio è già partito' });
  }
  if (ride.driver_id === req.user.id) return res.status(400).json({ error: 'Non puoi prenotare il tuo stesso passaggio' });

  const esistente = db.prepare(
    'SELECT * FROM bookings WHERE ride_id = ? AND passenger_id = ?'
  ).get(ride.id, req.user.id);
  if (esistente && ['richiesto', 'confermato'].includes(esistente.stato)) {
    return res.status(400).json({ error: 'Hai già una richiesta attiva per questo passaggio' });
  }
  if (esistente && esistente.stato === 'lista_attesa') {
    return res.status(400).json({ error: 'Sei già in lista d\'attesa per questo passaggio' });
  }

  const impegnati = db.prepare(`
    SELECT COUNT(*) as n FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato')
  `).get(ride.id).n;
  const listaAttesa = impegnati >= ride.posti_totali;
  const nuovoStato = listaAttesa ? 'lista_attesa' : 'richiesto';

  try {
    let bookingId;
    if (esistente) {
      // Richiesta precedente annullata o rifiutata: riattiviamo la stessa riga invece di
      // inserirne una nuova (il vincolo unico ride+passeggero non permetterebbe un duplicato).
      db.prepare(`
        UPDATE bookings SET stato = ?, punto_salita = ?, check_in = 0, check_in_at = NULL, created_at = ${ADESSO_MS}
        WHERE id = ?
      `).run(nuovoStato, punto_salita || null, esistente.id);
      bookingId = esistente.id;
    } else {
      const info = db.prepare(`
        INSERT INTO bookings (ride_id, passenger_id, stato, punto_salita, created_at) VALUES (?, ?, ?, ?, ${ADESSO_MS})
      `).run(ride.id, req.user.id, nuovoStato, punto_salita || null);
      bookingId = info.lastInsertRowid;
    }

    if (listaAttesa) {
      await notifica(
        req.user.id, 'iscritto_lista_attesa',
        `Sei in lista d'attesa per il passaggio ${ride.tipo} del ${ride.data} alle ${ride.ora}: ti avviseremo se si libera un posto.`,
        ride.id
      );
      registraAzione(req.user.id, 'iscrizione_lista_attesa', `Passaggio #${ride.id}, ${ride.data} ${ride.ora}`, 'utente');
    } else {
      const passeggero = db.prepare('SELECT nome, cognome FROM users WHERE id = ?').get(req.user.id);
      await notifica(
        ride.driver_id, 'nuova_richiesta',
        `${passeggero.nome} ${passeggero.cognome} ha richiesto il tuo passaggio ${ride.tipo} del ${ride.data} alle ${ride.ora}.`,
        ride.id
      );
      registraAzione(req.user.id, 'richiesta_passaggio', `Passaggio #${ride.id}, ${ride.data} ${ride.ora}`, 'utente');
    }

    res.json({ booking_id: bookingId, lista_attesa: listaAttesa });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Hai già richiesto questo passaggio' });
    console.error(e);
    res.status(500).json({ error: 'Errore nella richiesta' });
  }
}));

// L'autista conferma o rifiuta una richiesta; il passeggero può solo annullarla.
const STATI_VALIDI = ['confermato', 'rifiutato', 'annullato'];

router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { stato } = req.body; // confermato | rifiutato | annullato
  if (!STATI_VALIDI.includes(stato)) return res.status(400).json({ error: 'Stato non valido' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Non trovata' });
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(booking.ride_id);

  const isDriver = ride.driver_id === req.user.id;
  const isPassenger = confrontoSicuro(booking.passenger_id, req.user.id);
  if (!isDriver && !isPassenger && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  if (isPassenger && !isDriver && stato !== 'annullato') {
    return res.status(403).json({ error: 'Puoi solo annullare la tua richiesta' });
  }

  // Gli esiti di un viaggio concluso (completato, assente, viaggio non più attivo) non si
  // riscrivono: cambierebbero lo storico senza rettificare i punti.
  if (['completato', 'no_show'].includes(booking.stato) || ride.stato !== 'attivo') {
    return res.status(400).json({ error: 'Questo passaggio è concluso o non è più attivo: la prenotazione non si può modificare' });
  }

  const statoPrecedente = booking.stato;
  let esito = null;
  let promossi = [];
  const tx = db.transaction(() => {
    const r = db.prepare('SELECT posti_disponibili, posti_totali FROM rides WHERE id = ?').get(ride.id);
    if (stato === 'confermato' && statoPrecedente !== 'confermato') {
      // Ricontrolla la capienza al momento della conferma. Una richiesta 'richiesto' è già
      // contata tra gli impegni; da lista d'attesa, rifiutata o annullata invece aggiunge un
      // impegno, quindi servono sia un posto libero sia spazio tra richieste e conferme.
      const impegniAltri = db.prepare(`
        SELECT COUNT(*) AS n FROM bookings WHERE ride_id = ? AND id != ? AND stato IN ('richiesto','confermato')
      `).get(ride.id, booking.id).n;
      if (r.posti_disponibili <= 0 || (statoPrecedente !== 'richiesto' && impegniAltri >= r.posti_totali)) {
        esito = 'pieno';
        return;
      }
      db.prepare('UPDATE rides SET posti_disponibili = posti_disponibili - 1 WHERE id = ?').run(ride.id);
    }
    if ((stato === 'rifiutato' || stato === 'annullato') && statoPrecedente === 'confermato') {
      db.prepare('UPDATE rides SET posti_disponibili = posti_disponibili + 1 WHERE id = ?').run(ride.id);
    }
    // Chi perde la conferma perde anche il check-in: una conferma successiva ne richiede uno nuovo.
    if (statoPrecedente === 'confermato' && stato !== 'confermato') {
      db.prepare('UPDATE bookings SET stato = ?, check_in = 0, check_in_at = NULL WHERE id = ?').run(stato, booking.id);
    } else {
      db.prepare('UPDATE bookings SET stato = ? WHERE id = ?').run(stato, booking.id);
    }
    // Rifiutare o annullare una richiesta o una conferma libera un posto: chi è in lista
    // d'attesa viene promosso nella stessa transazione, prima che qualcun altro lo occupi.
    if (['rifiutato', 'annullato'].includes(stato) && ['richiesto', 'confermato'].includes(statoPrecedente)) {
      promossi = promuoviListaAttesa(ride.id);
    }
  });
  tx();
  if (esito === 'pieno') return res.status(400).json({ error: 'Non ci sono più posti disponibili su questo passaggio' });

  if (isDriver && stato === 'confermato') {
    await notifica(booking.passenger_id, 'richiesta_confermata',
      `Il tuo passaggio ${ride.tipo} del ${ride.data} alle ${ride.ora} è stato confermato dall'autista.`, ride.id);
    registraAzione(req.user.id, 'richiesta_confermata', `Passaggio #${ride.id}`, 'utente');
  }
  if (isDriver && stato === 'rifiutato') {
    await notifica(booking.passenger_id, 'richiesta_rifiutata',
      `La tua richiesta per il passaggio ${ride.tipo} del ${ride.data} alle ${ride.ora} è stata rifiutata.`, ride.id);
    registraAzione(req.user.id, 'richiesta_rifiutata', `Passaggio #${ride.id}`, 'utente');
  }
  if (isPassenger && stato === 'annullato') {
    await notifica(ride.driver_id, 'richiesta_annullata',
      `Un passeggero ha annullato la richiesta per il tuo passaggio del ${ride.data} alle ${ride.ora}.`, ride.id);
    registraAzione(req.user.id, 'richiesta_annullata', `Passaggio #${ride.id}`, 'utente');
  }

  await notificaPromossi(promossi);

  res.json({ ok: true });
}));

// Il conducente segna un passeggero confermato come "a bordo" al momento della partenza.
router.put('/:id/check-in', requireAuth, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Non trovata' });
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(booking.ride_id);
  if (ride.driver_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  if (booking.stato !== 'confermato') {
    return res.status(400).json({ error: 'Solo le prenotazioni confermate possono fare check-in' });
  }
  const nuovoValore = booking.check_in ? 0 : 1;
  db.prepare('UPDATE bookings SET check_in = ?, check_in_at = ? WHERE id = ?')
    .run(nuovoValore, nuovoValore ? new Date().toISOString() : null, booking.id);
  registraAzione(req.user.id, 'check_in_modificato', `Passaggio #${ride.id}: ${nuovoValore ? 'a bordo' : 'check-in rimosso'}`, 'utente');
  res.json({ ok: true, check_in: nuovoValore });
});

// Il passeggero segnala all'autista di essere in ritardo al punto di ritrovo (es. non è
// ancora arrivato quando l'autista sta per partire). Solo per prenotazioni confermate e non
// ancora salite a bordo: dopo il check-in il passeggero è già con l'autista.
router.post('/:id/ritardo', requireAuth, asyncHandler(async (req, res) => {
  const minuti = Number(req.body.minuti);
  if (!Number.isFinite(minuti) || minuti <= 0) return res.status(400).json({ error: 'Indica i minuti di ritardo' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Non trovata' });
  if (!confrontoSicuro(booking.passenger_id, req.user.id)) return res.status(403).json({ error: 'Non autorizzato' });
  if (booking.stato !== 'confermato') return res.status(400).json({ error: 'Solo le prenotazioni confermate possono segnalare un ritardo' });
  if (booking.check_in) return res.status(400).json({ error: 'Hai già effettuato il check-in' });
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(booking.ride_id);
  if (!ride || ride.stato !== 'attivo') return res.status(400).json({ error: 'Questo passaggio non è più attivo' });

  const passeggero = db.prepare('SELECT nome, cognome FROM users WHERE id = ?').get(req.user.id);
  await notifica(
    ride.driver_id, 'passeggero_in_ritardo',
    `${passeggero.nome} ${passeggero.cognome} è in ritardo di circa ${minuti} minuti per il passaggio delle ${ride.ora}.`,
    ride.id
  );
  registraAzione(req.user.id, 'passeggero_ritardo_segnalato', `Passaggio #${ride.id}: ${minuti} min`, 'utente');
  res.json({ ok: true });
}));

// Le mie prenotazioni (come passeggero). storico=1 -> passate/concluse invece delle prossime.
router.get('/mie', requireAuth, (req, res) => {
  const { storico } = req.query;
  const upcoming = `(r.data > date('now','localtime') OR (r.data = date('now','localtime') AND r.ora >= strftime('%H:%M','now','localtime')))`;
  const filtro = storico === '1'
    ? `AND (b.stato IN ('completato','no_show','rifiutato','annullato')
         OR (b.stato IN ('richiesto','confermato','lista_attesa') AND r.stato = 'annullato')
         OR (b.stato IN ('richiesto','confermato','lista_attesa') AND r.stato = 'attivo' AND NOT ${upcoming}))`
    : `AND b.stato IN ('richiesto','confermato','lista_attesa') AND (r.stato = 'in_approvazione' OR (r.stato = 'attivo' AND ${upcoming}))`;

  const bookings = db.prepare(`
    SELECT b.*, r.data, r.ora, r.tipo, r.punto_partenza, r.punto_arrivo, r.stato as ride_stato, r.driver_id,
           u.nome as driver_nome, u.cognome as driver_cognome, CASE WHEN u.foto_path IS NOT NULL THEN u.foto_versione END as driver_foto,
           -- Il telefono dell'autista solo a chi è stato confermato (stessa regola del dettaglio).
           CASE WHEN b.stato IN ('confermato','completato','no_show') THEN u.telefono END as driver_telefono,
           u.auto_marca, u.auto_modello, u.auto_colore
    FROM bookings b
    JOIN rides r ON r.id = b.ride_id
    JOIN users u ON u.id = r.driver_id
    WHERE b.passenger_id = ? ${filtro}
    ORDER BY r.data DESC, r.ora DESC
  `).all(req.user.id);
  res.json({ bookings });
});

module.exports = router;
