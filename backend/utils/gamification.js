const db = require('../db');

// Punti, premi, classifiche e contest sono facoltativi: il Mobility Manager li attiva o li spegne
// da Impostazioni generali → Gamification. Spenti, non si assegnano punti e le parti dell'app che
// li riguardano non si vedono; lo storico resta nel database.
function gamificationAttiva() {
  return db.prepare('SELECT gamification_attiva FROM system_settings WHERE id = 1').get()?.gamification_attiva === 1;
}

// Per le route che esistono solo con la gamification attiva (riscatti, classifiche, contest).
function richiediGamification(_req, res, next) {
  if (!gamificationAttiva()) {
    return res.status(403).json({ error: 'Punti e premi non sono attivi in questa azienda.', codice: 'GAMIFICATION_DISATTIVATA' });
  }
  next();
}

module.exports = { gamificationAttiva, richiediGamification };
