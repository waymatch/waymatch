const db = require('../db');
const { notifica } = require('./notify');

// Quando si libera un posto (una richiesta/conferma passa a rifiutato/annullato, oppure
// l'autista aumenta i posti totali), promuove automaticamente il passeggero in lista
// d'attesa da più tempo a 'richiesto': la conferma resta comunque all'autista, ma il
// passeggero non deve rifare da capo la richiesta. Ripete finché c'è capienza e c'è
// ancora qualcuno in lista (un aumento di più posti può liberarne più di uno insieme).
// Ritorna le prenotazioni promosse (con il viaggio allegato) per poter notificare.
function promuoviListaAttesa(rideId) {
  const promossi = [];
  while (true) {
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    if (!ride || ride.stato !== 'attivo') break;
    const impegnati = db.prepare(`
      SELECT COUNT(*) as n FROM bookings WHERE ride_id = ? AND stato IN ('richiesto','confermato')
    `).get(rideId).n;
    if (impegnati >= ride.posti_totali) break;

    const prossimo = db.prepare(`
      SELECT * FROM bookings WHERE ride_id = ? AND stato = 'lista_attesa' ORDER BY created_at ASC, id ASC LIMIT 1
    `).get(rideId);
    if (!prossimo) break;

    db.prepare(`UPDATE bookings SET stato = 'richiesto' WHERE id = ?`).run(prossimo.id);
    promossi.push({ ...prossimo, ride });
  }
  return promossi;
}

// Notifica passeggero e autista per ciascuna promozione da lista d'attesa a "richiesto".
// notifica non rifiuta mai, quindi un invio fallito non salta gli altri destinatari.
async function notificaPromossi(promossi) {
  for (const p of promossi) {
    await notifica(
      p.passenger_id, 'promosso_da_lista_attesa',
      `Si è liberato un posto nel passaggio ${p.ride.tipo} del ${p.ride.data} alle ${p.ride.ora}: la tua richiesta è stata inviata automaticamente al conducente.`,
      p.ride.id
    );
    // Nel frattempo il passeggero potrebbe aver già annullato: l'autista va avvisato solo di
    // una richiesta ancora valida.
    const ancoraRichiesta = db.prepare('SELECT stato FROM bookings WHERE id = ?').get(p.id)?.stato === 'richiesto';
    if (!ancoraRichiesta) continue;
    await notifica(
      p.ride.driver_id, 'nuova_richiesta',
      `Un passeggero dalla lista d'attesa ha una nuova richiesta per il tuo passaggio ${p.ride.tipo} del ${p.ride.data} alle ${p.ride.ora}.`,
      p.ride.id
    );
  }
}

module.exports = { promuoviListaAttesa, notificaPromossi };
