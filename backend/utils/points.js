const db = require('../db');
const { distanzaKm } = require('./geoDistance');
const { calcRouteMultiPoint } = require('./geocode');

// Km del percorso calcolati dal server con OSRM: partenza, soste con coordinate, arrivo. Null
// se mancano le coordinate o il servizio non risponde (la pubblicazione non si blocca).
async function kmDalServer(pLat, pLon, aLat, aLon, soste = []) {
  const ok = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (![pLat, pLon, aLat, aLon].every(ok)) return null;
  const intermedi = (Array.isArray(soste) ? soste : []).filter((s) => s && ok(s.lat) && ok(s.lon));
  const punti = [{ lat: pLat, lon: pLon }, ...intermedi.map((s) => ({ lat: s.lat, lon: s.lon })), { lat: aLat, lon: aLon }]
    .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }));
  try {
    const r = await calcRouteMultiPoint(punti);
    return Number.isFinite(r.km) ? r.km : null;
  } catch (e) {
    console.error('[km] percorso non calcolato dal server:', e.message);
    return null;
  }
}

// Km su cui si calcolano punti e risparmi. Quelli dichiarati, ma al massimo il 30% in più del
// percorso calcolato dal server (l'autista può aver scelto un'alternativa più lunga). Senza
// percorso verificato, al massimo il doppio della linea d'aria tra partenza e arrivo (+2 km).
function kmAffidabili(ride) {
  const km = Number(ride.km_stimati) || 0;
  if (Number.isFinite(ride.km_verificati) && ride.km_verificati > 0) return Math.min(km, ride.km_verificati * 1.3);
  const coordinate = [ride.partenza_lat, ride.partenza_lon, ride.arrivo_lat, ride.arrivo_lon];
  if (coordinate.some((c) => c == null || !Number.isFinite(c))) return km;
  return Math.min(km, 2 * distanzaKm(...coordinate) + 2);
}

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

module.exports = { getRule, assegnaPunti, totalePunti, totaleGuadagnato, calcolaBonusKm, kmDalServer, kmAffidabili };
