const db = require('../db');
const { creaNotificaInApp, inAppAttiva, consegnaEsterna } = require('./notify');
const { documentiPendenti } = require('./documentiLegali');
const { log } = require('./structuredLog');

const MESSAGGIO = 'I tuoi turni fissi sono in pausa: le corse già in calendario restano, ma per generarne di nuove devi accettare i documenti del conducente aggiornati.';

// Un avviso al conducente quando i suoi turni attivi vanno in pausa per documenti da accettare.
// Uno solo per ogni insieme di versioni pendenti: lo scheduler gira ogni ora e non deve ripeterlo;
// una nuova versione dei documenti dà un nuovo avviso.
async function avvisaTurniInPausa() {
  const conducenti = db.prepare('SELECT DISTINCT driver_id FROM recurring_rides WHERE attivo = 1').all().map((r) => r.driver_id);
  let avvisati = 0;
  for (const id of conducenti) {
    let esito;
    try {
      // Marcatore e notifica in-app nella stessa transazione: se il salvataggio della notifica
      // fallisce non resta un marcatore che impedirebbe di riprovare al giro successivo.
      esito = db.transaction(() => {
        const pendenti = documentiPendenti(id, 'conducente');
        if (pendenti.length === 0) return null;
        const firma = pendenti.map((d) => `${d.id}:${d.versione}`).join(',');
        if (db.prepare('SELECT firma FROM avvisi_turni_in_pausa WHERE user_id = ?').get(id)?.firma === firma) return null;
        db.prepare(`
          INSERT INTO avvisi_turni_in_pausa (user_id, firma) VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET firma = excluded.firma, created_at = datetime('now')
        `).run(id, firma);
        return { inApp: inAppAttiva(id, 'turni_in_pausa') ? creaNotificaInApp(id, 'turni_in_pausa', MESSAGGIO) : null };
      })();
    } catch (e) {
      log.error('turni_in_pausa_avviso_non_salvato', { errore: e, user_id: id });
      continue;
    }
    if (!esito) continue;
    avvisati++;
    await consegnaEsterna(id, 'turni_in_pausa', MESSAGGIO, esito.inApp); // push ed email, dopo il commit
  }
  // Chi non ha più documenti da accettare (o turni attivi) esce dall'elenco: a un documento
  // nuovo verrà avvisato di nuovo.
  db.transaction(() => {
    for (const { user_id } of db.prepare('SELECT user_id FROM avvisi_turni_in_pausa').all()) {
      if (!conducenti.includes(user_id) || documentiPendenti(user_id, 'conducente').length === 0) {
        db.prepare('DELETE FROM avvisi_turni_in_pausa WHERE user_id = ?').run(user_id);
      }
    }
  })();
  return avvisati;
}

module.exports = { avvisaTurniInPausa };
