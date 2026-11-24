const crypto = require('crypto');
const db = require('../db');

const INATTIVITA_MAX_GIORNI = 7;
const DURATA_MAX_GIORNI = 30;
const COOKIE = 'cp_rinnovo';

const hash = (segreto) => crypto.createHash('sha256').update(segreto).digest('hex');

function creaSessione(userId, req) {
  const id = crypto.randomBytes(16).toString('hex');
  const segreto = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessioni (id, user_id, segreto_hash, dispositivo) VALUES (?, ?, ?, ?)')
    .run(id, userId, hash(segreto), String(req.get('user-agent') || '').slice(0, 300));
  return { id, segreto };
}

// Il segreto di rinnovo vive solo in un cookie httpOnly: uno script nella pagina (es. un
// XSS) può leggere il token di accesso da 8 ore in localStorage, ma non questo. SameSite
// Strict + path ristretto: il browser lo invia solo alle rotte /api/auth dello stesso sito.
function opzioniCookie(req) {
  return { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/api/auth' };
}

function impostaCookie(req, res, segreto) {
  res.cookie(COOKIE, segreto, { ...opzioniCookie(req), maxAge: DURATA_MAX_GIORNI * 24 * 60 * 60 * 1000 });
}

function cancellaCookie(req, res) {
  res.clearCookie(COOKIE, opzioniCookie(req));
}

function leggiSegreto(req) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [nome, ...valore] = parte.trim().split('=');
    if (nome === COOKIE) return decodeURIComponent(valore.join('='));
  }
  return null;
}

function sessioneRinnovabile(segreto) {
  if (!segreto) return null;
  return db.prepare(`
    SELECT * FROM sessioni
    WHERE segreto_hash = ? AND revocata = 0
      AND ultimo_uso > datetime('now', '-${INATTIVITA_MAX_GIORNI} days')
      AND creata_il > datetime('now', '-${DURATA_MAX_GIORNI} days')
  `).get(hash(segreto));
}

function sessioneAttiva(id) {
  return db.prepare('SELECT * FROM sessioni WHERE id = ? AND revocata = 0').get(id);
}

// Aggiornato al massimo ogni 5 minuti: basta per l'inattività in giorni, senza una
// scrittura su disco a ogni richiesta.
function registraUso(id) {
  db.prepare(`UPDATE sessioni SET ultimo_uso = datetime('now') WHERE id = ? AND ultimo_uso < datetime('now', '-5 minutes')`).run(id);
}

function revocaSessione(id) {
  db.prepare('UPDATE sessioni SET revocata = 1 WHERE id = ?').run(id);
}

function revocaSessioneDaSegreto(segreto) {
  if (segreto) db.prepare('UPDATE sessioni SET revocata = 1 WHERE segreto_hash = ?').run(hash(segreto));
}

function revocaSessioniUtente(userId, tranneId = null) {
  db.prepare('UPDATE sessioni SET revocata = 1 WHERE user_id = ? AND revocata = 0 AND id IS NOT ?').run(userId, tranneId);
}

function elencoSessioni(userId) {
  return db.prepare(`
    SELECT id, dispositivo, creata_il, ultimo_uso FROM sessioni
    WHERE user_id = ? AND revocata = 0
      AND ultimo_uso > datetime('now', '-${INATTIVITA_MAX_GIORNI} days')
      AND creata_il > datetime('now', '-${DURATA_MAX_GIORNI} days')
    ORDER BY ultimo_uso DESC
  `).all(userId);
}

function pulisciSessioniScadute() {
  return db.prepare(`
    DELETE FROM sessioni
    WHERE revocata = 1
       OR ultimo_uso < datetime('now', '-${INATTIVITA_MAX_GIORNI} days')
       OR creata_il < datetime('now', '-${DURATA_MAX_GIORNI} days')
  `).run().changes;
}

module.exports = {
  creaSessione, impostaCookie, cancellaCookie, leggiSegreto, sessioneRinnovabile, sessioneAttiva,
  registraUso, revocaSessione, revocaSessioneDaSegreto, revocaSessioniUtente, elencoSessioni, pulisciSessioniScadute,
  INATTIVITA_MAX_GIORNI, DURATA_MAX_GIORNI,
};
