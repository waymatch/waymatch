// Provider dei tile della mappa, scelto dal gestore dell'installazione (.env):
//   TILE_URL           modello con {z}/{x}/{y}, es. https://tile.openstreetmap.org/{z}/{x}/{y}.png
//   TILE_ATTRIBUTION   testo (HTML ammesso) mostrato in basso sulla mappa
//   TILE_MAX_ZOOM      zoom massimo nativo del provider (default 19)
//
// Il valore predefinito è il server pubblico di OpenStreetMap, adatto solo a prove e a un uso
// leggero: la sua policy vieta il carico da applicazioni in produzione (vedi README).
const DEFAULT_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUZIONE = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function leggi(env = process.env) {
  const url = (env.TILE_URL || DEFAULT_URL).trim();
  const attribuzione = env.TILE_URL ? (env.TILE_ATTRIBUTION || '').trim() : DEFAULT_ATTRIBUZIONE;
  const maxZoom = Number(env.TILE_MAX_ZOOM || 19);

  let origine;
  try {
    const u = new URL(url.replace(/\{[zxy]\}/g, '0'));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocollo');
    origine = u.origin;
  } catch {
    throw new Error(`TILE_URL non valido: "${url}". Serve un indirizzo http(s) come ${DEFAULT_URL}`);
  }
  for (const segnaposto of ['{z}', '{x}', '{y}']) {
    if (!url.includes(segnaposto)) throw new Error(`TILE_URL non valido: manca ${segnaposto} (esempio: ${DEFAULT_URL})`);
  }
  if (!Number.isInteger(maxZoom) || maxZoom < 1 || maxZoom > 22) throw new Error('TILE_MAX_ZOOM non valido: serve un numero intero tra 1 e 22');
  if (env.TILE_URL && !attribuzione) {
    throw new Error('TILE_ATTRIBUTION mancante: con un TILE_URL personalizzato l\'attribuzione richiesta dal provider è obbligatoria.');
  }
  return { url, attribuzione, maxZoom, origine };
}

module.exports = { leggi, DEFAULT_URL };
