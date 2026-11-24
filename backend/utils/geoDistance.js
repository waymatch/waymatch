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

module.exports = { distanzaPuntoDaPercorso };
