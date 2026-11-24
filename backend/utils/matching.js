const db = require('../db');
const { notifica } = require('./notify');

// Quando viene pubblicato un nuovo passaggio, avvisa (se lo desiderano, vedi preferenze)
// i colleghi della stessa sede che hanno un turno fisso compatibile (stesso tipo,
// orario entro 60 minuti) e non sono già coinvolti nel passaggio.
async function notificaMatchProattivo(ride) {
  if (!ride || !ride.sede_id) return;

  const candidati = db.prepare(`
    SELECT DISTINCT rr.driver_id
    FROM recurring_rides rr
    WHERE rr.attivo = 1 AND rr.sede_id = ? AND rr.tipo = ? AND rr.driver_id != ?
      AND ABS((CAST(substr(rr.ora,1,2) AS INTEGER) * 60 + CAST(substr(rr.ora,4,2) AS INTEGER))
              - (CAST(substr(?,1,2) AS INTEGER) * 60 + CAST(substr(?,4,2) AS INTEGER))) <= 60
  `).all(ride.sede_id, ride.tipo, ride.driver_id, ride.ora, ride.ora);

  // La notifica in-app arriva sempre; push ed email seguono le preferenze (le applica
  // notifica, che non fallisce mai: un invio non riuscito non salta gli altri destinatari).
  for (const c of candidati) {
    await notifica(
      c.driver_id, 'matching_proattivo',
      `È stato pubblicato un passaggio ${ride.tipo === 'andata' ? 'di andata' : 'di ritorno'} alle ${ride.ora} compatibile con il tuo turno abituale.`,
      ride.id
    );
  }
}

// Avvisa chi segue questo autista per questo tipo di tratta ("passaggi preferiti").
async function notificaPreferiti(ride) {
  if (!ride) return;
  const follower = db.prepare(`
    SELECT follower_id FROM favorite_rides WHERE driver_id = ? AND tipo = ?
  `).all(ride.driver_id, ride.tipo);

  for (const f of follower) {
    await notifica(
      f.follower_id, 'passaggio_preferito_pubblicato',
      `Un autista che segui ha pubblicato un nuovo passaggio ${ride.tipo === 'andata' ? 'di andata' : 'di ritorno'} alle ${ride.ora}.`,
      ride.id
    );
  }
}

module.exports = { notificaMatchProattivo, notificaPreferiti };
