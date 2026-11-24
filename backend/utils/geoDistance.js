// Distanza minima (in metri) tra un punto (lat, lon) e una polilinea [[lat,lon], ...] —
// tipicamente il percorso stradale reale già salvato per un passaggio (rides.geometria).
// Usa una proiezione equirettangolare locale, centrata sul punto: sufficientemente
// accurata alla scala di una città (l'errore di questa approssimazione diventa
// significativo solo su distanze di decine di km, ben oltre l'uso previsto qui).
function distanzaPuntoDaPercorso(lat, lon, punti) {
  if (!Array.isArray(punti) || punti.length === 0) return null;

  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(latRad);
  const toXY = ([pLat, pLon]) => [(pLon - lon) * mPerDegLon, (pLat - lat) * mPerDegLat];

  const puntiXY = punti.map(toXY);
  if (puntiXY.length === 1) {
    return Math.hypot(puntiXY[0][0], puntiXY[0][1]);
  }

  let min = Infinity;
  for (let i = 0; i < puntiXY.length - 1; i++) {
    const [x1, y1] = puntiXY[i];
    const [x2, y2] = puntiXY[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    // Proiezione del punto (l'origine, 0,0) sul segmento, con t vincolato a [0,1] così da
    // considerare anche gli estremi del segmento e non solo la retta che lo contiene.
    let t = lenSq === 0 ? 0 : (-x1 * dx - y1 * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const dist = Math.hypot(projX, projY);
    if (dist < min) min = dist;
  }
  return min;
}

// Un percorso salvato deve essere una lista di punti [lat, lon] con coordinate valide: dati
// malformati non devono poter rompere il calcolo delle distanze per tutti.
const MAX_PUNTI_PERCORSO = 20000;
function geometriaValida(punti) {
  return Array.isArray(punti) && punti.length > 0 && punti.length <= MAX_PUNTI_PERCORSO
    && punti.every((p) => Array.isArray(p) && p.length >= 2
      && Number.isFinite(p[0]) && Number.isFinite(p[1])
      && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
}

// Distanza in linea d'aria (km) tra due punti, con la formula dell'emisenoverso.
function distanzaKm(lat1, lon1, lat2, lon2) {
  const r = (g) => (g * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Soste di un passaggio o di un turno: elenco di al massimo 20 oggetti. Le righe senza luogo
// si ignorano al salvataggio; per le altre luogo, orario (HH:MM) e coordinate devono avere il
// tipo giusto, altrimenti l'inserimento fallirebbe a metà.
function sosteValide(soste) {
  if (soste == null) return true;
  const vuoto = (v) => v === undefined || v === null || v === '';
  return Array.isArray(soste) && soste.length <= 20 && soste.every((s) => s == null || (typeof s === 'object'
    && (vuoto(s.luogo) || (typeof s.luogo === 'string' && s.luogo.length <= 200))
    && (vuoto(s.descrizione) || (typeof s.descrizione === 'string' && s.descrizione.length <= 500))
    && (vuoto(s.orario) || (typeof s.orario === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.orario)))
    && ['lat', 'lon'].every((k) => vuoto(s[k]) || Number.isFinite(s[k]))));
}

module.exports = { distanzaPuntoDaPercorso, geometriaValida, distanzaKm, sosteValide };
