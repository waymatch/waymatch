const db = require('./db');
const { notifica } = require('./utils/notify');
const { totaleGuadagnato } = require('./utils/points');
const { logEvent } = require('./utils/structuredLog');
const { pulisciSessioniScadute } = require('./utils/sessioni');

// Quanto conservare nel database applicativo il log punti, il log attività e lo storico
// viaggi prima di archiviarli (vedi archiviaDatiStorici). Configurabile perché è una
// policy aziendale, non una costante tecnica — chi ospita l'app decide il proprio valore.
const RITENZIONE_STORICO_MESI = Number(process.env.RITENZIONE_STORICO_MESI) || 24;

function avviaScheduler() {
  // Genera le occorrenze dei turni fissi (prossimi 14 giorni), all'avvio e poi ogni ora.
  const eseguiGenerazioneTurni = () => {
    try {
      const { generaTutteLeOccorrenze } = require('./routes/recurring_rides');
      const n = generaTutteLeOccorrenze(14);
      if (n > 0) console.log(`[scheduler] Generate ${n} occorrenze da turni fissi`);
    } catch (e) {
      console.error('[scheduler] Errore generazione turni fissi:', e.message);
    }
  };
  eseguiGenerazioneTurni();
  setInterval(eseguiGenerazioneTurni, 60 * 60 * 1000);

  // Invia i promemoria di partenza, controllando ogni 5 minuti i viaggi imminenti.
  const eseguiPromemoria = async () => {
    try {
      await inviaPromemoriaPartenza();
    } catch (e) {
      console.error('[scheduler] Errore invio promemoria:', e.message);
    }
  };
  eseguiPromemoria();
  setInterval(eseguiPromemoria, 5 * 60 * 1000);

  // Riepilogo settimanale: controlla ogni ora, invia una sola volta a settimana per
  // utente (tabella weekly_summary_sent fa da guardia contro riavvii/controlli ripetuti
  // nella stessa finestra). Il lunedì mattina è un momento naturale per uno sguardo
  // indietro sulla settimana appena conclusa.
  const eseguiRiepilogoSettimanale = async () => {
    try {
      await inviaRiepilogoSettimanale();
    } catch (e) {
      console.error('[scheduler] Errore riepilogo settimanale:', e.message);
    }
  };
  eseguiRiepilogoSettimanale();
  setInterval(eseguiRiepilogoSettimanale, 60 * 60 * 1000);

  // Pulizia dati "di servizio" che altrimenti crescerebbero senza limite: notifiche
  // (un inbox, non uno storico da conservare) e token di reset password scaduti/usati.
  const eseguiPulizia = () => {
    try {
      pulisciDatiScaduti();
    } catch (e) {
      console.error('[scheduler] Errore pulizia dati scaduti:', e.message);
    }
  };
  eseguiPulizia();
  setInterval(eseguiPulizia, 24 * 60 * 60 * 1000);

  // Archiviazione dello storico (log attività, log punti, viaggi conclusi) oltre la
  // finestra di conservazione: ogni riga viene prima emessa come log strutturato (vedi
  // utils/structuredLog.js), poi rimossa dal database applicativo. Chi collega un sistema
  // di log management esterno ha lo storico completo lì; il database resta di dimensione
  // limitata indipendentemente da quanti anni resta in funzione l'app.
  const eseguiArchiviazione = () => {
    try {
      archiviaDatiStorici();
    } catch (e) {
      console.error('[scheduler] Errore archiviazione storico:', e.message);
    }
  };
  eseguiArchiviazione();
  setInterval(eseguiArchiviazione, 24 * 60 * 60 * 1000);
}

function pulisciDatiScaduti() {
  const notifiche = db.prepare(`
    DELETE FROM notifications
    WHERE (letta = 1 AND created_at < datetime('now', '-90 days'))
       OR created_at < datetime('now', '-540 days')
  `).run();
  const token = db.prepare(`
    DELETE FROM password_reset_tokens
    WHERE (usato = 1 OR scade_il < datetime('now')) AND created_at < datetime('now', '-30 days')
  `).run();
  const sessioniRimosse = pulisciSessioniScadute();
  if (notifiche.changes > 0 || token.changes > 0 || sessioniRimosse > 0) {
    console.log(`[scheduler] Pulizia: ${notifiche.changes} notifiche vecchie, ${token.changes} token di reset scaduti, ${sessioniRimosse} sessioni scadute o revocate rimossi.`);
  }
}

// Log attività, log punti e viaggi conclusi più vecchi della finestra di conservazione:
// spediti come evento strutturato (per un eventuale sistema di log management esterno) e
// poi rimossi dal database applicativo. Il log punti non viene solo cancellato: le righe
// vecchie di ogni utente vengono consolidate in un'unica riga che ne conserva la somma,
// altrimenti il saldo punti (calcolato come SOMMA di tutte le righe, vedi utils/points.js)
// cambierebbe silenziosamente. La riga di consolidamento viene datata esattamente al
// limite della finestra, così un calcolo per periodo (es. classifica "ultimi 12 mesi")
// continua a escluderla correttamente, come farebbe con le righe originali.
function archiviaDatiStorici() {
  const cutoff = `datetime('now', '-${RITENZIONE_STORICO_MESI} months')`;
  const cutoffData = `date('now', '-${RITENZIONE_STORICO_MESI} months')`;

  const vecchiAudit = db.prepare(`SELECT * FROM audit_log WHERE created_at < ${cutoff}`).all();
  for (const riga of vecchiAudit) logEvent('audit_log_archiviato', riga);
  const auditRimossi = db.prepare(`DELETE FROM audit_log WHERE created_at < ${cutoff}`).run().changes;

  const consolidaPunti = db.transaction(() => {
    const utenti = db.prepare(`
      SELECT DISTINCT user_id FROM points_log WHERE created_at < ${cutoff} AND tipo_evento != 'consolidamento_storico'
    `).all();
    let righeConsolidate = 0;
    for (const { user_id } of utenti) {
      const vecchie = db.prepare(`
        SELECT * FROM points_log WHERE user_id = ? AND created_at < ${cutoff} AND tipo_evento != 'consolidamento_storico'
      `).all(user_id);
      if (vecchie.length === 0) continue;
      for (const riga of vecchie) logEvent('points_log_archiviato', riga);
      const somma = vecchie.reduce((tot, r) => tot + r.punti, 0);
      // Cancellazione per id esatti (non per intervallo di date): evita di toccare per
      // sbaglio un'eventuale riga di consolidamento precedente che ricadesse nello stesso
      // intervallo.
      const eliminaRiga = db.prepare('DELETE FROM points_log WHERE id = ?');
      for (const riga of vecchie) eliminaRiga.run(riga.id);
      if (somma !== 0) {
        db.prepare(`
          INSERT INTO points_log (user_id, tipo_evento, punti, note, created_at)
          VALUES (?, 'consolidamento_storico', ?, ?, ${cutoffData})
        `).run(user_id, somma, `Somma di ${vecchie.length} eventi precedenti, archiviati nel log esterno`);
      }
      righeConsolidate += vecchie.length;
    }
    return righeConsolidate;
  });
  const puntiConsolidati = consolidaPunti();

  // Solo viaggi conclusi (completati o annullati): un viaggio attivo/in approvazione non
  // può per definizione essere più vecchio della finestra di conservazione. La cancellazione
  // trascina con sé, in automatico (ON DELETE CASCADE), le relative prenotazioni e soste.
  const vecchiRides = db.prepare(`
    SELECT r.*,
      (SELECT json_group_array(json_object('id', b.id, 'passenger_id', b.passenger_id, 'stato', b.stato))
       FROM bookings b WHERE b.ride_id = r.id) as prenotazioni_json
    FROM rides r WHERE r.data < ${cutoffData} AND r.stato IN ('completato', 'annullato')
  `).all();
  for (const riga of vecchiRides) {
    const { prenotazioni_json, ...ride } = riga;
    logEvent('viaggio_archiviato', { ...ride, prenotazioni: JSON.parse(prenotazioni_json || '[]') });
  }
  const rideRimosse = db.prepare(`
    DELETE FROM rides WHERE data < ${cutoffData} AND stato IN ('completato', 'annullato')
  `).run().changes;

  if (auditRimossi > 0 || puntiConsolidati > 0 || rideRimosse > 0) {
    console.log(`[scheduler] Archiviazione storico (oltre ${RITENZIONE_STORICO_MESI} mesi): ${auditRimossi} voci di log attività, ${puntiConsolidati} righe di log punti consolidate, ${rideRimosse} viaggi rimossi.`);
  }
}

async function inviaRiepilogoSettimanale() {
  const giornoSettimana = db.prepare(`SELECT CAST(strftime('%w','now','localtime') AS INTEGER) as g`).get().g; // 1 = lunedì
  const ora = db.prepare(`SELECT CAST(strftime('%H','now','localtime') AS INTEGER) as h`).get().h;
  if (giornoSettimana !== 1 || ora !== 7) return;

  const settimana = db.prepare(`SELECT strftime('%Y-%W','now','localtime') as s`).get().s;
  const utenti = db.prepare('SELECT id FROM users WHERE attivo = 1').all();

  for (const u of utenti) {
    const giaInviato = db.prepare('SELECT 1 FROM weekly_summary_sent WHERE user_id = ? AND settimana = ?').get(u.id, settimana);
    if (giaInviato) continue;
    db.prepare('INSERT INTO weekly_summary_sent (user_id, settimana) VALUES (?, ?)').run(u.id, settimana);

    const punti = totaleGuadagnato(u.id, 7);
    // Filtro sulla data del viaggio (quando è avvenuto), non su created_at (quando è
    // stato offerto/prenotato): un'offerta di giorni fa completata solo questa settimana
    // deve comunque contare in questo riepilogo.
    const viaggi = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM rides WHERE driver_id = ? AND stato = 'completato' AND data >= date('now','-7 days')) +
        (SELECT COUNT(*) FROM bookings b JOIN rides r ON r.id = b.ride_id
           WHERE b.passenger_id = ? AND b.stato = 'completato' AND r.data >= date('now','-7 days'))
        as n
    `).get(u.id, u.id).n;

    if (punti <= 0 && viaggi <= 0) continue; // nessuna attività, non serve un riepilogo vuoto

    await notifica(
      u.id, 'riepilogo_settimanale',
      `Questa settimana: ${viaggi} viaggi completati e ${punti} punti guadagnati. Continua così!`
    );
  }
}

async function inviaPromemoriaPartenza() {
  // Considera solo i viaggi che partono nelle prossime 2 ore (copre qualunque anticipo
  // configurato dagli utenti, fino a 120 minuti).
  const rides = db.prepare(`
    SELECT * FROM rides
    WHERE stato = 'attivo'
      AND data = date('now', 'localtime')
      AND (
        (CAST(substr(ora,1,2) AS INTEGER) * 60 + CAST(substr(ora,4,2) AS INTEGER))
        - (CAST(strftime('%H','now','localtime') AS INTEGER) * 60 + CAST(strftime('%M','now','localtime') AS INTEGER))
      ) BETWEEN 0 AND 120
  `).all();

  for (const ride of rides) {
    const partecipanti = [{ user_id: ride.driver_id, ruolo: 'autista' }];
    const confermati = db.prepare(`SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato = 'confermato'`).all(ride.id);
    for (const c of confermati) partecipanti.push({ user_id: c.passenger_id, ruolo: 'passeggero' });

    for (const p of partecipanti) {
      const pref = db.prepare(`
        SELECT push, email, minuti_anticipo FROM notification_preferences WHERE user_id = ? AND categoria = 'promemoria_partenza'
      `).get(p.user_id);
      const attivo = pref ? (pref.push || pref.email) : true; // default: attivo
      if (!attivo) continue;
      const minutiAnticipo = pref?.minuti_anticipo ?? 30;

      const [oreP, minP] = ride.ora.split(':').map(Number);
      const oraNow = db.prepare(`SELECT CAST(strftime('%H','now','localtime') AS INTEGER) as h, CAST(strftime('%M','now','localtime') AS INTEGER) as m`).get();
      const minutiMancanti = (oreP * 60 + minP) - (oraNow.h * 60 + oraNow.m);
      if (minutiMancanti > minutiAnticipo || minutiMancanti < 0) continue;

      const giaInviato = db.prepare('SELECT 1 FROM reminder_sent WHERE ride_id = ? AND user_id = ?').get(ride.id, p.user_id);
      if (giaInviato) continue;

      await notifica(
        p.user_id, 'promemoria_partenza',
        `Il tuo passaggio ${ride.tipo} delle ${ride.ora} parte tra circa ${minutiMancanti} minuti.`,
        ride.id
      );
      db.prepare('INSERT OR IGNORE INTO reminder_sent (ride_id, user_id) VALUES (?, ?)').run(ride.id, p.user_id);
    }
  }
}

module.exports = { avviaScheduler };
