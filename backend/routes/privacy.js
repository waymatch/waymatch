const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const fotoProfilo = require('../utils/fotoProfilo');
const { registraAzione } = require('../utils/audit');
const { notifica, notificaMassiva } = require('../utils/notify');
const { promuoviListaAttesa, notificaPromossi } = require('../utils/waitlist');
const { totalePunti, totaleGuadagnato } = require('../utils/points');
const { hashPassword } = require('../utils/passwordHash');
const { asyncHandler } = require('../utils/asyncHandler');
const { MESSAGGIO: MESSAGGIO_ULTIMO_ADMIN } = require('../utils/ultimoAdmin');

const router = express.Router();

// Esporta tutti i dati personali dell'utente corrente (GDPR, diritto alla portabilità/accesso).
router.get('/export', requireAuth, (req, res) => {
  const userId = req.user.id;
  const profilo = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  delete profilo.password_hash;
  // La foto è nell'export così com'è salvata (decifrata), come immagine incorporata.
  if (profilo.foto_path) {
    try { profilo.foto_profilo = `data:image/jpeg;base64,${fotoProfilo.leggi(profilo.foto_path).toString('base64')}`; } catch { profilo.foto_profilo = null; }
  }
  delete profilo.foto_path;

  const passaggiOfferti = db.prepare(`
    SELECT * FROM rides WHERE driver_id = ? ORDER BY data DESC, ora DESC
  `).all(userId);
  for (const r of passaggiOfferti) {
    r.soste = db.prepare('SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY orario').all(r.id);
    r.geometria = undefined; // solo la polilinea del percorso, non è un dato personale utile da esportare
  }

  const prenotazioni = db.prepare(`
    SELECT b.*, r.data, r.ora, r.tipo, r.punto_partenza, r.punto_arrivo,
           u.nome as autista_nome, u.cognome as autista_cognome
    FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN users u ON u.id = r.driver_id
    WHERE b.passenger_id = ? ORDER BY r.data DESC
  `).all(userId);

  const turniFissi = db.prepare('SELECT * FROM recurring_rides WHERE driver_id = ?').all(userId);

  const puntiLog = db.prepare('SELECT tipo_evento, punti, note, created_at FROM points_log WHERE user_id = ?').all(userId);
  const puntiManuali = db.prepare(`
    SELECT punti, motivo, created_at FROM manual_point_awards WHERE user_id = ?
  `).all(userId);

  const riscatti = db.prepare(`
    SELECT rr.stato, rr.codice_voucher, rr.created_at, r.nome as premio, r.punti_richiesti
    FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
    WHERE rr.user_id = ? ORDER BY rr.created_at DESC
  `).all(userId);

  const preferenzeNotifiche = db.prepare(`
    SELECT categoria, push, email, minuti_anticipo FROM notification_preferences WHERE user_id = ?
  `).all(userId);

  const notifiche = db.prepare(`
    SELECT tipo, messaggio, letta, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);

  const documentiAccettati = db.prepare(`
    SELECT d.titolo, a.versione_accettata, a.accettato_at
    FROM document_acceptances a JOIN legal_documents d ON d.id = a.document_id
    WHERE a.user_id = ?
  `).all(userId);

  const logAttivita = db.prepare(`
    SELECT azione, dettagli, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);

  registraAzione(userId, 'dati_personali_esportati', null, 'utente');

  res.json({
    generato_il: new Date().toISOString(),
    profilo,
    passaggi_offerti: passaggiOfferti,
    prenotazioni,
    turni_fissi: turniFissi,
    punti: {
      saldo_spendibile: totalePunti(userId),
      totale_guadagnato: totaleGuadagnato(userId),
      log_eventi: puntiLog,
      assegnazioni_manuali: puntiManuali,
    },
    riscatti_premi: riscatti,
    preferenze_notifiche: preferenzeNotifiche,
    notifiche,
    documenti_accettati: documentiAccettati,
    log_attivita: logAttivita,
  });
});

// Stato della propria richiesta di cancellazione (se esiste), per mostrarlo nel profilo.
router.get('/cancellazione/mia', requireAuth, (req, res) => {
  const richiesta = db.prepare(`
    SELECT * FROM account_deletion_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);
  res.json({ richiesta: richiesta || null });
});

// L'utente chiede la cancellazione dei propri dati. Non cancella nulla subito: la
// richiesta va approvata da un Mobility Manager (vedi sotto), perché l'anonimizzazione
// tocca anche viaggi/prenotazioni condivisi con altri colleghi.
router.post('/cancellazione', requireAuth, asyncHandler(async (req, res) => {
  const { motivo } = req.body;
  const pendente = db.prepare(`
    SELECT 1 FROM account_deletion_requests WHERE user_id = ? AND stato = 'in_attesa'
  `).get(req.user.id);
  if (pendente) return res.status(400).json({ error: 'Hai già una richiesta di cancellazione in attesa' });

  db.prepare(`
    INSERT INTO account_deletion_requests (user_id, motivo) VALUES (?, ?)
  `).run(req.user.id, motivo || null);
  registraAzione(req.user.id, 'richiesta_cancellazione_creata', motivo || null, 'utente');

  const mm = db.prepare(`SELECT id FROM users WHERE ruolo = 'mobility_manager' AND attivo = 1`).all();
  await notificaMassiva(
    mm.map((m) => m.id), 'richiesta_cancellazione_ricevuta',
    `${req.user.nome} ${req.user.cognome} ha richiesto la cancellazione del proprio account.`
  );
  res.json({ ok: true });
}));

router.get('/cancellazioni', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const richieste = db.prepare(`
    SELECT dr.*, u.nome, u.cognome, u.email
    FROM account_deletion_requests dr JOIN users u ON u.id = dr.user_id
    ORDER BY dr.created_at DESC
  `).all();
  res.json({ richieste });
});

// Anonimizza l'utente invece di eliminare la riga: i suoi viaggi/prenotazioni passati
// restano visibili nello storico di chi ha condiviso un passaggio con lui (la cascata sul
// DELETE fisico di un utente cancellerebbe anche le prenotazioni di ALTRI colleghi sui
// suoi viaggi). I passaggi/turni fissi ancora attivi vengono annullati e chi era coinvolto
// avvisato, come per un normale annullamento.
router.post('/cancellazioni/:id/completa', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  // Calcolato prima dei controlli: dopo, fino alla fine dell'anonimizzazione, nessun await.
  const hashInutilizzabile = await hashPassword(crypto.randomBytes(32).toString('hex'));

  // Dalla lettura della richiesta al passaggio a «completata» non c'è nessun await: tutto
  // avviene in una transazione sincrona, quindi due conferme in parallelo non possono
  // elaborare due volte la stessa richiesta (la seconda trova già «completata»). Gli invii di
  // notifiche (push/email) sono asincroni e partono dopo, a transazione conclusa.
  const daNotificare = [];
  let fotoDaEliminare = null;
  const elabora = db.transaction(() => {
    const richiesta = db.prepare('SELECT * FROM account_deletion_requests WHERE id = ?').get(req.params.id);
    if (!richiesta || richiesta.stato !== 'in_attesa') {
      return { codice: 400, error: 'Nessuna richiesta in attesa con questo id' };
    }
    const utente = db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.user_id);
    if (!utente) return { codice: 404, error: 'Utente non trovato' };
    // L'anonimizzazione disattiva l'account: non può togliere l'ultimo Mobility Manager.
    if (utente.ruolo === 'mobility_manager' && utente.attivo) {
      const altri = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ruolo = 'mobility_manager' AND attivo = 1 AND id != ?`).get(utente.id).n;
      if (altri < 1) return { codice: 400, error: `${MESSAGGIO_ULTIMO_ADMIN} Nomina prima un altro Mobility Manager.` };
    }

    const upcoming = `(data > date('now','localtime') OR (data = date('now','localtime') AND ora >= strftime('%H:%M','now','localtime')))`;
    const upcomingR = `(r.data > date('now','localtime') OR (r.data = date('now','localtime') AND r.ora >= strftime('%H:%M','now','localtime')))`;

    // 1) Annulla i passaggi futuri offerti da lui, avvisando i passeggeri coinvolti.
    const rideOfferti = db.prepare(`SELECT * FROM rides WHERE driver_id = ? AND stato = 'attivo' AND ${upcoming}`).all(utente.id);
    for (const r of rideOfferti) {
      const passeggeriCoinvolti = db.prepare(`
        SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')
      `).all(r.id).map((b) => b.passenger_id);
      db.prepare(`UPDATE rides SET stato = 'annullato' WHERE id = ?`).run(r.id);
      db.prepare(`UPDATE bookings SET stato = 'annullato' WHERE ride_id = ? AND stato IN ('richiesto','confermato','lista_attesa')`).run(r.id);
      if (passeggeriCoinvolti.length > 0) {
        daNotificare.push(() => notificaMassiva(
          passeggeriCoinvolti, 'viaggio_annullato',
          `Il passaggio ${r.tipo} del ${r.data} alle ${r.ora} è stato annullato dall'autista.`,
          r.id
        ));
      }
    }

    // 2) Annulla le sue prenotazioni attive sui passaggi altrui, avvisando l'autista e
    // promuovendo eventuali persone in lista d'attesa al posto che si libera.
    const proprieBooking = db.prepare(`
      SELECT b.*, r.driver_id, r.tipo, r.data, r.ora FROM bookings b
      JOIN rides r ON r.id = b.ride_id
      WHERE b.passenger_id = ? AND b.stato IN ('richiesto','confermato','lista_attesa')
        AND r.stato = 'attivo' AND ${upcomingR}
    `).all(utente.id);
    for (const b of proprieBooking) {
      const eraConfermato = b.stato === 'confermato';
      // Anche una richiesta non ancora confermata occupa un posto: liberarla può promuovere
      // chi è in lista d'attesa.
      const occupavaPosto = b.stato === 'confermato' || b.stato === 'richiesto';
      db.prepare(`UPDATE bookings SET stato = 'annullato' WHERE id = ?`).run(b.id);
      if (eraConfermato) {
        db.prepare('UPDATE rides SET posti_disponibili = posti_disponibili + 1 WHERE id = ?').run(b.ride_id);
      }
      daNotificare.push(() => notifica(
        b.driver_id, 'richiesta_annullata',
        `Un passeggero ha annullato la richiesta per il tuo passaggio del ${b.data} alle ${b.ora}.`,
        b.ride_id
      ));
      if (occupavaPosto) {
        const promossi = promuoviListaAttesa(b.ride_id);
        daNotificare.push(() => notificaPromossi(promossi));
      }
    }

    // 3) Sospende i suoi turni fissi (evita che ne vengano generate altre occorrenze).
    db.prepare(`UPDATE recurring_rides SET attivo = 0 WHERE driver_id = ?`).run(utente.id);

    // 3b) Indirizzi personali nei suoi passaggi e turni fissi: il capo del tragitto che non è
    // la sede (la partenza all'andata, l'arrivo al ritorno) diventa la sola città, senza
    // coordinate; il tracciato e le note spariscono. Restano data, sede e km, che servono ai
    // report. Toglie anche il punto di salita scelto nelle sue prenotazioni.
    const generico = "COALESCE(citta_domicilio, 'Indirizzo rimosso')";
    for (const tabella of ['rides', 'recurring_rides']) {
      db.prepare(`
        UPDATE ${tabella} SET
          punto_partenza = CASE WHEN tipo = 'andata' THEN ${generico} ELSE punto_partenza END,
          partenza_lat = CASE WHEN tipo = 'andata' THEN NULL ELSE partenza_lat END,
          partenza_lon = CASE WHEN tipo = 'andata' THEN NULL ELSE partenza_lon END,
          punto_arrivo = CASE WHEN tipo = 'ritorno' THEN ${generico} ELSE punto_arrivo END,
          arrivo_lat = CASE WHEN tipo = 'ritorno' THEN NULL ELSE arrivo_lat END,
          arrivo_lon = CASE WHEN tipo = 'ritorno' THEN NULL ELSE arrivo_lon END,
          geometria = NULL, note = NULL
        WHERE driver_id = ?
      `).run(utente.id);
    }
    db.prepare('UPDATE bookings SET punto_salita = NULL WHERE passenger_id = ?').run(utente.id);

    // 4) Rimuove le sue sottoscrizioni push (non più raggiungibile comunque, ma pulizia).
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(utente.id);

    // 5) Anonimizza il profilo e disabilita il login.
    const emailAnonima = `cancellato-${utente.id}@anonimizzato.local`;
    fotoDaEliminare = db.prepare('SELECT foto_path FROM users WHERE id = ?').get(utente.id)?.foto_path || null;
    db.prepare(`
      UPDATE users SET
        nome = 'Utente', cognome = 'cancellato', email = ?, password_hash = ?,
        telefono = NULL, indirizzo_casa = NULL, casa_lat = NULL, casa_lon = NULL, citta_casa = NULL,
        auto_marca = NULL, auto_modello = NULL, auto_anno = NULL, auto_cilindrata = NULL,
        auto_colore = NULL, auto_alimentazione = NULL, foto_path = NULL,
        attivo = 0, token_version = token_version + 1
      WHERE id = ?
    `).run(emailAnonima, hashInutilizzabile, utente.id);

    db.prepare(`
      UPDATE account_deletion_requests SET stato = 'completata', gestita_da = ?, gestita_at = datetime('now') WHERE id = ?
    `).run(req.user.id, richiesta.id);
    // Solo l'id: l'email originale è proprio il dato che l'anonimizzazione deve far sparire.
    registraAzione(req.user.id, 'richiesta_cancellazione_completata', `Utente #${utente.id}`);
  return { ok: true };
  });
  const esito = elabora();
  if (!esito.ok) return res.status(esito.codice).json({ error: esito.error });
  // Il file della foto si cancella dopo il commit: se la transazione fallisse, la foto resterebbe.
  fotoProfilo.elimina(fotoDaEliminare);
  for (const invia of daNotificare) {
    try { await invia(); } catch (e) { console.error('[cancellazione] notifica non inviata:', e.message); }
  }

  res.json({ ok: true });
}));

router.post('/cancellazioni/:id/rifiuta', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const { motivo } = req.body;
  const richiesta = db.prepare('SELECT * FROM account_deletion_requests WHERE id = ?').get(req.params.id);
  if (!richiesta || richiesta.stato !== 'in_attesa') {
    return res.status(400).json({ error: 'Nessuna richiesta in attesa con questo id' });
  }
  db.prepare(`
    UPDATE account_deletion_requests SET stato = 'rifiutata', gestita_da = ?, gestita_at = datetime('now'), motivo = ? WHERE id = ?
  `).run(req.user.id, motivo || richiesta.motivo, richiesta.id);
  registraAzione(req.user.id, 'richiesta_cancellazione_rifiutata', `Utente #${richiesta.user_id}${motivo ? `: ${motivo}` : ''}`);
  await notifica(
    richiesta.user_id, 'richiesta_cancellazione_rifiutata',
    `La tua richiesta di cancellazione dell'account è stata rifiutata${motivo ? `: ${motivo}` : ''}.`
  );
  res.json({ ok: true });
}));

module.exports = router;
