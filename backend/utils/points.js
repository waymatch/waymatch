const db = require('../db');

function getRule(chiave) {
  const rule = db.prepare('SELECT * FROM point_rules WHERE chiave = ?').get(chiave);
  if (!rule || !rule.attivo) return 0;
  return rule.punti;
}

function assegnaPunti(userId, tipoEvento, punti, rideId = null, note = null) {
  if (!punti) return;
  db.prepare(
    `INSERT INTO points_log (user_id, tipo_evento, punti, ride_id, note) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, tipoEvento, punti, rideId, note);
}

// Saldo attuale (spendibile): tutto ciò che è stato guadagnato, meno i punti usati per
// riscattare premi (e più eventuali rimborsi se un riscatto viene rifiutato).
function totalePunti(userId) {
  const daEventi = db
    .prepare(`SELECT COALESCE(SUM(punti), 0) as tot FROM points_log WHERE user_id = ?`)
    .get(userId).tot;
  const daManuali = db
    .prepare(`SELECT COALESCE(SUM(punti), 0) as tot FROM manual_point_awards WHERE user_id = ?`)
    .get(userId).tot;
  return daEventi + daManuali;
}

// Punti guadagnati (usati per classifica/contest): non scendono mai quando si riscatta
// un premio. Esclude le voci legate a un riscatto (sia la decurtazione che l'eventuale
// rimborso, che si annullano a vicenda), conta solo i punti realmente maturati con
// viaggi e bonus manuali del mobility manager.
function totaleGuadagnato(userId, periodoGiorni = null) {
  const filtroData = periodoGiorni ? `AND created_at >= datetime('now', '-${Number(periodoGiorni)} days')` : '';
  const daEventi = db
    .prepare(`SELECT COALESCE(SUM(punti), 0) as tot FROM points_log WHERE user_id = ? ${filtroData}`)
    .get(userId).tot;
  const daManuali = db
    .prepare(`SELECT COALESCE(SUM(punti), 0) as tot FROM manual_point_awards WHERE user_id = ? AND redemption_id IS NULL ${filtroData}`)
    .get(userId).tot;
  return daEventi + daManuali;
}

function calcolaBonusKm(km, numPasseggeri) {
  const perKm = getRule('punto_per_km');
  const capRow = db.prepare('SELECT punti FROM point_rules WHERE chiave = ?').get('km_cap_bonus');
  const cap = capRow ? capRow.punti : 20;
  return Math.min(cap, Math.round(km * numPasseggeri * perKm));
}

module.exports = { getRule, assegnaPunti, totalePunti, totaleGuadagnato, calcolaBonusKm };
