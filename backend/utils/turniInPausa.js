const db = require('../db');
const { notifica } = require('./notify');
const { documentiPendenti } = require('./documentiLegali');

// Un avviso al conducente quando i suoi turni attivi vanno in pausa per documenti da accettare.
// Uno solo per ogni insieme di versioni pendenti: lo scheduler gira ogni ora e non deve ripeterlo;
// una nuova versione dei documenti dà un nuovo avviso.
async function avvisaTurniInPausa() {
  const conducenti = db.prepare('SELECT DISTINCT driver_id FROM recurring_rides WHERE attivo = 1').all().map((r) => r.driver_id);
  const daAvvisare = [];
  db.transaction(() => {
    for (const id of conducenti) {
      const pendenti = documentiPendenti(id, 'conducente');
      if (pendenti.length === 0) continue;
      const firma = pendenti.map((d) => `${d.id}:${d.versione}`).join(',');
      const gia = db.prepare('SELECT firma FROM avvisi_turni_in_pausa WHERE user_id = ?').get(id);
      if (gia?.firma === firma) continue;
      db.prepare(`
        INSERT INTO avvisi_turni_in_pausa (user_id, firma) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET firma = excluded.firma, created_at = datetime('now')
      `).run(id, firma);
      daAvvisare.push(id);
    }
    // Chi non ha più documenti da accettare (o turni attivi) esce dall'elenco: a un documento
    // nuovo verrà avvisato di nuovo.
    for (const { user_id } of db.prepare('SELECT user_id FROM avvisi_turni_in_pausa').all()) {
      if (!conducenti.includes(user_id) || documentiPendenti(user_id, 'conducente').length === 0) {
        db.prepare('DELETE FROM avvisi_turni_in_pausa WHERE user_id = ?').run(user_id);
      }
    }
  })();
  for (const id of daAvvisare) {
    await notifica(id, 'turni_in_pausa',
      'I tuoi turni fissi sono in pausa: le corse già in calendario restano, ma per generarne di nuove devi accettare i documenti del conducente aggiornati.');
  }
  return daAvvisare.length;
}

module.exports = { avvisaTurniInPausa };
