const db = require('./db');
const { notifica, creaNotificaInApp, inAppAttiva, consegnaEsterna } = require('./utils/notify');
const { totaleGuadagnato } = require('./utils/points');
const { gamificationAttiva } = require('./utils/gamification');
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
      const { avvisaTurniInPausa } = require('./utils/turniInPausa');
      const n = generaTutteLeOccorrenze(14);
      if (n > 0) console.log(`[scheduler] Generate ${n} occorrenze da turni fissi`);
      avvisaTurniInPausa().catch((e) => console.error('[scheduler] Errore avviso turni in pausa:', e.message));
    } catch (e) {
      console.error('[scheduler] Errore generazione turni fissi:', e.message);
    }
  };
  eseguiGenerazioneTurni();
  setInterval(eseguiGenerazioneTurni, 60 * 60 * 1000);

  // Controlla una volta al giorno se c'è una nuova versione di WayMatch (disattivabile con
  // CONTROLLO_AGGIORNAMENTI=0). Il primo controllo poco dopo l'avvio, per non rallentarlo.
  const eseguiControlloAggiornamenti = () => {
    const { controlla, attivo } = require('./utils/aggiornamenti');
    if (!attivo()) return;
    controlla().catch((e) => console.error('[scheduler] Controllo nuove versioni non riuscito:', e.message));
  };
  setTimeout(eseguiControlloAggiornamenti, 60 * 1000).unref();
  setInterval(eseguiControlloAggiornamenti, 24 * 60 * 60 * 1000);

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
// cambierebbe silenziosamente. Si consolida per utente e per mese, datando ogni riga
// all'ultimo evento di quel mese: un calcolo per periodo (es. classifica "ultimi 12 mesi")
// sbaglia al massimo di un mese, invece di attribuire a una data recente punti vecchi.
function archiviaDatiStorici() {
  // Soglia calcolata una volta sola: selezione e cancellazione devono vedere le stesse righe.
  const soglie = db.prepare(`SELECT datetime('now', ?) AS istante, date('now', ?) AS giorno`)
    .get(`-${RITENZIONE_STORICO_MESI} months`, `-${RITENZIONE_STORICO_MESI} months`);
  const cutoff = soglie.istante;
  const cutoffData = soglie.giorno;

  const auditRimossi = db.transaction(() => {
    const vecchiAudit = db.prepare('SELECT * FROM audit_log WHERE created_at < ?').all(cutoff);
    for (const riga of vecchiAudit) logEvent('audit_log_archiviato', riga);
    const elimina = db.prepare('DELETE FROM audit_log WHERE id = ?');
    for (const riga of vecchiAudit) elimina.run(riga.id);
    return vecchiAudit.length;
  })();

  const consolidaPunti = db.transaction(() => {
    const vecchie = db.prepare(`
      SELECT * FROM points_log WHERE created_at < ? AND tipo_evento != 'consolidamento_storico'
    `).all(cutoff);
    // Gruppi per utente e mese; cancellazione per id esatti, così non si tocca un'eventuale
    // riga di consolidamento precedente che ricadesse nello stesso intervallo.
    const gruppi = new Map();
    for (const riga of vecchie) {
      // Anche per generazione: un mese a cavallo di un azzeramento dei punteggi dà due righe.
      const chiave = `${riga.user_id}|${String(riga.created_at).slice(0, 7)}|${riga.generazione}`;
      if (!gruppi.has(chiave)) gruppi.set(chiave, []);
      gruppi.get(chiave).push(riga);
    }
    const eliminaRiga = db.prepare('DELETE FROM points_log WHERE id = ?');
    const inserisci = db.prepare(`
      INSERT INTO points_log (user_id, tipo_evento, punti, note, created_at, generazione)
      VALUES (?, 'consolidamento_storico', ?, ?, ?, ?)
    `);
    for (const righe of gruppi.values()) {
      for (const riga of righe) logEvent('points_log_archiviato', riga);
      for (const riga of righe) eliminaRiga.run(riga.id);
      const somma = righe.reduce((tot, r) => tot + r.punti, 0);
      const ultima = righe.reduce((max, r) => (r.created_at > max ? r.created_at : max), righe[0].created_at);
      if (somma !== 0) {
        inserisci.run(righe[0].user_id, somma, `Somma di ${righe.length} eventi del mese, archiviati nel log esterno`, ultima, righe[0].generazione);
      }
    }
    return vecchie.length;
  });
  const puntiConsolidati = consolidaPunti();

  // Solo viaggi conclusi (completati o annullati): un viaggio attivo/in approvazione non
  // può per definizione essere più vecchio della finestra di conservazione. La cancellazione
  // trascina con sé, in automatico (ON DELETE CASCADE), le relative prenotazioni e soste.
  const rideRimosse = db.transaction(() => {
    const vecchiRides = db.prepare(`
      SELECT r.*,
        (SELECT json_group_array(json_object('id', b.id, 'passenger_id', b.passenger_id, 'stato', b.stato))
         FROM bookings b WHERE b.ride_id = r.id) as prenotazioni_json
      FROM rides r WHERE r.data < ? AND r.stato IN ('completato', 'annullato')
    `).all(cutoffData);
    const elimina = db.prepare('DELETE FROM rides WHERE id = ?');
    for (const riga of vecchiRides) {
      const { prenotazioni_json, ...ride } = riga;
      logEvent('viaggio_archiviato', { ...ride, prenotazioni: JSON.parse(prenotazioni_json || '[]') });
      elimina.run(riga.id);
    }
    return vecchiRides.length;
  })();

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

    const conPunti = gamificationAttiva();
    const punti = conPunti ? totaleGuadagnato(u.id, 7) : 0;
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
      conPunti
        ? `Questa settimana: ${viaggi} viaggi completati e ${punti} punti guadagnati. Continua così!`
        : `Questa settimana: ${viaggi} viaggi completati in carpooling. Continua così!`
    );
  }
}

async function inviaPromemoriaPartenza() {
  // Viaggi che partono nelle prossime 2 ore (copre qualunque anticipo configurabile, fino a
  // 120 minuti). Si confronta l'istante completo di partenza, così un viaggio alle 00:10
  // rientra già nel controllo delle 23:50 del giorno prima.
  const rides = db.prepare(`
    SELECT *, CAST(round((julianday(data || ' ' || ora) - julianday('now', 'localtime')) * 1440) AS INTEGER) AS minuti_mancanti
    FROM rides
    WHERE stato = 'attivo'
      AND julianday(data || ' ' || ora) BETWEEN julianday('now', 'localtime') AND julianday('now', 'localtime', '+120 minutes')
  `).all();

  for (const ride of rides) {
    const partecipanti = [{ user_id: ride.driver_id, ruolo: 'autista' }];
    const confermati = db.prepare(`SELECT passenger_id FROM bookings WHERE ride_id = ? AND stato = 'confermato'`).all(ride.id);
    for (const c of confermati) partecipanti.push({ user_id: c.passenger_id, ruolo: 'passeggero' });

    for (const p of partecipanti) {
      // La notifica in-app arriva sempre; push ed email seguono le preferenze (le gestisce notifica).
      const pref = db.prepare(`
        SELECT minuti_anticipo FROM notification_preferences WHERE user_id = ? AND categoria = 'promemoria_partenza'
      `).get(p.user_id);
      const minutiAnticipo = pref?.minuti_anticipo ?? 30;
      // Minuti ricalcolati per ogni partecipante: gli invii precedenti richiedono tempo.
      const minutiMancanti = db.prepare(`
        SELECT CAST(round((julianday(?) - julianday('now', 'localtime')) * 1440) AS INTEGER) AS m
      `).get(`${ride.data} ${ride.ora}`).m;
      if (minutiMancanti > minutiAnticipo || minutiMancanti < 0) continue;

      // Il marcatore e la notifica in-app si scrivono insieme: due giri sovrapposti non mandano
      // il promemoria due volte, e non esiste un marcatore senza notifica. Push ed email dopo.
      const messaggio = `Il tuo passaggio ${ride.tipo} delle ${ride.ora} parte tra circa ${minutiMancanti} minuti.`;
      const esito = db.transaction(() => {
        const prenotato = db.prepare('INSERT OR IGNORE INTO reminder_sent (ride_id, user_id) VALUES (?, ?)').run(ride.id, p.user_id).changes === 1;
        if (!prenotato) return null;
        return { inApp: inAppAttiva(p.user_id, 'promemoria_partenza') ? creaNotificaInApp(p.user_id, 'promemoria_partenza', messaggio, ride.id) : null };
      })();
      if (!esito) continue;
      await consegnaEsterna(p.user_id, 'promemoria_partenza', messaggio, esito.inApp);
    }
  }
}

module.exports = { avviaScheduler };
