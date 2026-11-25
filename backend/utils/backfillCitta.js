// Recupero una tantum della città per indirizzi/passaggi salvati prima che il campo
// "citta_domicilio"/"citta_casa" esistesse: lat/lon erano già salvati, manca solo
// l'etichetta breve da mostrare nelle liste. Non blocca l'avvio del server (viene
// invocata dopo app.listen) e non fa nulla se non trova righe da aggiornare, quindi
// diventa un no-op automatico dopo la prima esecuzione riuscita.
const db = require('../db');
const { reverseGeocodeCitta } = require('./geocode');
const { log } = require('./structuredLog');

const LIMITE_RIGHE = 300; // margine di sicurezza, non un limite pensato per essere raggiunto in uso normale

async function backfillCittaMancanti() {
  let aggiornati = 0;

  const utenti = db.prepare(`
    SELECT id, casa_lat, casa_lon FROM users
    WHERE casa_lat IS NOT NULL AND casa_lon IS NOT NULL AND (citta_casa IS NULL OR citta_casa = '')
    LIMIT ?
  `).all(LIMITE_RIGHE);
  for (const u of utenti) {
    const citta = await reverseGeocodeCitta(u.casa_lat, u.casa_lon);
    if (citta) {
      // Solo se nel frattempo l'utente non ha cambiato indirizzo o città.
      aggiornati += db.prepare(`
        UPDATE users SET citta_casa = ? WHERE id = ? AND casa_lat = ? AND casa_lon = ? AND (citta_casa IS NULL OR citta_casa = '')
      `).run(citta, u.id, u.casa_lat, u.casa_lon).changes;
    }
  }

  // Per un'andata il domicilio è la partenza, per un ritorno è l'arrivo; l'altro lato è
  // sempre il nome della sede, già sintetico e senza bisogno di città.
  const rides = db.prepare(`
    SELECT id, tipo, partenza_lat, partenza_lon, arrivo_lat, arrivo_lon FROM rides
    WHERE stato = 'attivo' AND (citta_domicilio IS NULL OR citta_domicilio = '')
      AND (
        (tipo = 'andata' AND partenza_lat IS NOT NULL AND partenza_lon IS NOT NULL)
        OR (tipo = 'ritorno' AND arrivo_lat IS NOT NULL AND arrivo_lon IS NOT NULL)
      )
    LIMIT ?
  `).all(LIMITE_RIGHE);
  for (const r of rides) {
    const lat = r.tipo === 'andata' ? r.partenza_lat : r.arrivo_lat;
    const lon = r.tipo === 'andata' ? r.partenza_lon : r.arrivo_lon;
    const citta = await reverseGeocodeCitta(lat, lon);
    if (citta) {
      aggiornati += db.prepare(`
        UPDATE rides SET citta_domicilio = ? WHERE id = ? AND (citta_domicilio IS NULL OR citta_domicilio = '')
          AND (CASE WHEN tipo = 'andata' THEN partenza_lat = ? AND partenza_lon = ? ELSE arrivo_lat = ? AND arrivo_lon = ? END)
      `).run(citta, r.id, lat, lon, lat, lon).changes;
    }
  }

  const turni = db.prepare(`
    SELECT id, tipo, partenza_lat, partenza_lon, arrivo_lat, arrivo_lon FROM recurring_rides
    WHERE attivo = 1 AND (citta_domicilio IS NULL OR citta_domicilio = '')
      AND (
        (tipo = 'andata' AND partenza_lat IS NOT NULL AND partenza_lon IS NOT NULL)
        OR (tipo = 'ritorno' AND arrivo_lat IS NOT NULL AND arrivo_lon IS NOT NULL)
      )
    LIMIT ?
  `).all(LIMITE_RIGHE);
  for (const t of turni) {
    const lat = t.tipo === 'andata' ? t.partenza_lat : t.arrivo_lat;
    const lon = t.tipo === 'andata' ? t.partenza_lon : t.arrivo_lon;
    const citta = await reverseGeocodeCitta(lat, lon);
    if (citta) {
      aggiornati += db.prepare(`
        UPDATE recurring_rides SET citta_domicilio = ? WHERE id = ? AND (citta_domicilio IS NULL OR citta_domicilio = '')
          AND (CASE WHEN tipo = 'andata' THEN partenza_lat = ? AND partenza_lon = ? ELSE arrivo_lat = ? AND arrivo_lon = ? END)
      `).run(citta, t.id, lat, lon, lat, lon).changes;
    }
  }

  if (aggiornati > 0) log.info('citta_recuperate', { righe: aggiornati });
}

module.exports = { backfillCittaMancanti };
