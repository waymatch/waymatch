// Integrazione con i servizi pubblici dello stack OpenStreetMap:
// - Nominatim per la ricerca/geocodifica degli indirizzi
// - OSRM per il calcolo del percorso stradale (distanza reale, non in linea d'aria)
//
// Nota sull'uso in produzione:
// I server pubblici (nominatim.openstreetmap.org, router.project-osrm.org) sono gratuiti
// ma pensati per un uso leggero/di test, con policy di utilizzo (rate limit, User-Agent
// obbligatorio, niente carichi intensivi). Per un utilizzo aziendale continuativo con
// molti utenti è consigliabile ospitare una propria istanza di Nominatim/OSRM (o usare un
// provider gestito) e cambiare NOMINATIM_URL/OSRM_URL.
// Qui viene comunque applicato un rate limiting lato server per rispettare la policy
// di Nominatim (max 1 richiesta al secondo).

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io';
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const USER_AGENT = process.env.OSM_USER_AGENT || 'WayMatch/1.0 (self-hosted)';
const COUNTRY_CODES = process.env.GEO_COUNTRY_CODES || 'it'; // limita i risultati, es. "it" oppure "it,ch,fr"
const PAESI = COUNTRY_CODES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);

// Tempo massimo per una richiesta a un provider (risposta e lettura del corpo): un servizio
// lento non deve tenere in sospeso la ricerca quando l'altro ha già risposto.
const TIMEOUT_MS = 8000;
function chiedi(url) {
  return fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Al massimo 1 richiesta al secondo verso Nominatim, per tutta l'applicazione: le richieste
// si mettono in fila, ognuna parte almeno 1,1 secondi dopo la precedente.
let codaNominatim = Promise.resolve();
function throttleNominatim() {
  const turno = codaNominatim.then(() => new Promise((r) => setTimeout(r, 1100)));
  const mioTurno = codaNominatim;
  codaNominatim = turno;
  return mioTurno;
}

async function searchNominatim(query) {
  await throttleNominatim();
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '6',
    'accept-language': 'it',
  });
  if (COUNTRY_CODES) params.set('countrycodes', COUNTRY_CODES);

  const res = await chiedi(`${NOMINATIM_URL}/search?${params.toString()}`);
  if (!res.ok) throw new Error('Servizio di ricerca indirizzi non disponibile');
  const data = await res.json();
  return data.map((r) => ({
    display_name: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    ...comuneEFrazione(r.address),
    _fallbackCitta: r.address?.county || null,
  }));
}

// L'indirizzo strutturato di Nominatim non ha un unico campo "città": in una zona rurale
// il comune (city/town/municipality) può mancare del tutto, mentre c'è una frazione
// (village/hamlet, dalla più grande alla più piccola). Quando ci sono entrambi e sono
// diversi, li componiamo ("Frazione, Comune"): la sola frazione non basta a capire di che
// comune si tratta, e il solo comune non basta a farsi un'idea della distanza reale su un
// territorio comunale esteso.
function comuneEFrazione(address) {
  if (!address) return { comune: null, frazione: null };
  return {
    comune: address.city || address.town || address.municipality || null,
    frazione: address.village || address.hamlet || null,
  };
}
function componiCitta(comune, frazione, fallback) {
  if (frazione && comune && frazione !== comune) return `${frazione}, ${comune}`;
  return comune || frazione || fallback || null;
}

async function reverseNominatim(lat, lon) {
  await throttleNominatim();
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', addressdetails: '1' });
  const res = await chiedi(`${NOMINATIM_URL}/reverse?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.address || null;
}

async function reversePhoton(lat, lon) {
  const params = new URLSearchParams({ lon: String(lon), lat: String(lat) });
  const res = await chiedi(`${PHOTON_URL}/reverse?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.features?.[0]?.properties || null;
}

// Da coordinate a città (usata per recuperare la città su indirizzi/passaggi salvati
// prima che questo campo esistesse, quando si hanno già lat/lon ma non l'indirizzo
// strutturato). Interroga sia Nominatim che Photon perché, per zone rurali, uno dei due a
// volte manca proprio il comune (visto su un caso reale: Nominatim aveva solo la
// frazione, Photon aveva il comune ma non la frazione) — combinando i due si prende il
// meglio di entrambi. Non solleva mai eccezioni: un fallimento qui non deve bloccare nulla.
async function reverseGeocodeCitta(lat, lon) {
  if (lat == null || lon == null) return null;
  try {
    const [nomAddr, photonProps] = await Promise.all([
      reverseNominatim(lat, lon).catch(() => null),
      reversePhoton(lat, lon).catch(() => null),
    ]);
    // Il "district" di Photon in città è un municipio/quartiere amministrativo (es.
    // "Municipio 1"), non una frazione: usarlo come frazione andrebbe bene in campagna ma
    // sarebbe rumore in una grande città. Lo usiamo quindi solo per il comune, mai per la
    // frazione — che prendiamo solo da Nominatim (village/hamlet), quando c'è.
    const nom = comuneEFrazione(nomAddr);
    const comune = nom.comune || photonProps?.city || photonProps?.town || null;
    return componiCitta(comune, nom.frazione, nomAddr?.county || photonProps?.county);
  } catch (e) {
    return null;
  }
}

// Photon (komoot.de, gratuito, anch'esso su dati OpenStreetMap ma con un motore di
// ricerca diverso — full-text/Elasticsearch): spesso trova meglio nomi di attività
// commerciali (bar, negozi...) rispetto alla sola ricerca per via/civico di Nominatim.
// Se non risponde o va in errore restituisce null: non blocca la ricerca principale, ma
// searchAddress sa distinguere un guasto da una ricerca senza risultati.
async function searchPhoton(query) {
  try {
    // Photon supporta come "lang" solo default/de/en/fr (l'italiano non è tra le lingue
    // con nomi tradotti): 'it' viene rifiutato con un errore 200 senza "features", che
    // altrimenti passa inosservato e fa sembrare Photon silenziosamente senza risultati.
    const params = new URLSearchParams({ q: query, limit: '6' });
    const res = await chiedi(`${PHOTON_URL}/api/?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Stesso limite geografico di Nominatim (GEO_COUNTRY_CODES), applicato ai risultati.
    const features = (data.features || []).filter((f) => !PAESI.length || PAESI.includes(String(f.properties?.countrycode || '').toUpperCase()));
    return features.map((f) => {
      const p = f.properties || {};
      const via = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : null;
      const parti = [p.name, via, p.city, p.postcode].filter(Boolean);
      return {
        display_name: parti.join(', ') || p.name || 'Risultato senza nome',
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        comune: p.city || p.town || null,
        // Il "district" di Photon in città è un municipio/quartiere amministrativo, non
        // una frazione rurale: non lo usiamo come frazione (vedi reverseGeocodeCitta).
        frazione: null,
        _fallbackCitta: p.county || null,
      };
    });
  } catch (e) {
    return null;
  }
}

async function searchAddress(query) {
  if (!query || query.trim().length < 3) return [];

  const [nominatimResults, photonResults] = await Promise.all([
    searchNominatim(query).catch(() => null),
    searchPhoton(query),
  ]);
  // Entrambi i provider guasti: è un disservizio, non una ricerca senza risultati.
  if (nominatimResults === null && photonResults === null) {
    throw new Error('Servizio di ricerca indirizzi non disponibile');
  }

  // Unione con deduplica approssimativa: stesso punto (entro ~50 metri) non viene ripetuto,
  // ma il comune dei due duplicati viene fuso prima di scartare quello di Photon — per un
  // indirizzo rurale Nominatim a volte manca proprio il comune (visto su un caso reale),
  // mentre Photon di solito ce l'ha. La frazione resta invece solo quella di Nominatim.
  const risultati = [...(nominatimResults || [])];
  for (const p of photonResults || []) {
    const esistente = risultati.find((n) => Math.abs(n.lat - p.lat) < 0.0005 && Math.abs(n.lon - p.lon) < 0.0005);
    if (esistente) {
      esistente.comune = esistente.comune || p.comune;
      esistente._fallbackCitta = esistente._fallbackCitta || p._fallbackCitta;
    } else {
      risultati.push(p);
    }
  }
  return risultati.slice(0, 8).map((r) => ({
    display_name: r.display_name,
    lat: r.lat,
    lon: r.lon,
    citta: componiCitta(r.comune, r.frazione, r._fallbackCitta),
  }));
}

async function calcRoute(fromLat, fromLon, toLat, toLon) {
  const url = `${OSRM_URL}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&alternatives=true`;
  const res = await chiedi(url);
  if (!res.ok) throw new Error('Servizio di calcolo percorso non disponibile');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
    throw new Error('Percorso stradale non trovato tra i due punti');
  }

  // GeoJSON usa [lon, lat]: la invertiamo in [lat, lon] per Leaflet
  const mappa = (route) => ({
    km: Math.round((route.distance / 1000) * 10) / 10,
    minuti: Math.round(route.duration / 60),
    geometria: (route.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]),
  });

  // OSRM può restituire più percorsi alternativi quando la rete stradale lo consente
  // (non è garantito per ogni tratta). Ne teniamo al massimo 3, ordinati per durata.
  const opzioni = data.routes.slice(0, 3).map(mappa);
  return { ...opzioni[0], alternative: opzioni };
}

// Calcola un percorso che passa, nell'ordine indicato, per più punti (usato quando ci
// sono soste con indirizzo validato: il tragitto deve davvero attraversarle, non solo
// elencarle come informazione a parte).
async function calcRouteMultiPoint(punti) {
  if (!Array.isArray(punti) || punti.length < 2) throw new Error('Servono almeno due punti');
  const coordStr = punti.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
  const res = await chiedi(url);
  if (!res.ok) throw new Error('Servizio di calcolo percorso non disponibile');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
    throw new Error('Percorso stradale non trovato tra i punti indicati');
  }
  const route = data.routes[0];
  return {
    km: Math.round((route.distance / 1000) * 10) / 10,
    minuti: Math.round(route.duration / 60),
    geometria: (route.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]),
  };
}

module.exports = { searchAddress, calcRoute, calcRouteMultiPoint, reverseGeocodeCitta };
