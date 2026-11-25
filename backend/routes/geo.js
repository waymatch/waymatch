const express = require('express');
const rateLimit = require('express-rate-limit');
const { searchAddress, calcRoute, calcRouteMultiPoint } = require('../utils/geocode');
const { asyncHandler } = require('../utils/asyncHandler');
const { log } = require('../utils/structuredLog');

const router = express.Router();

// Nota: questi endpoint sono volutamente senza autenticazione, perché servono anche
// durante il wizard di primo avvio (creazione sedi), prima che esista un account.
// Sono solo un proxy verso servizi pubblici di geocodifica, senza accesso a dati sensibili.
// Proprio perché non richiedono login, sono l'endpoint più esposto ad abusi (scraping o
// carico eccessivo sui servizi pubblici Nominatim/Photon/OSRM): un limite generoso per IP
// (pensato per uffici dietro NAT condiviso) basta a scoraggiare un uso improprio senza
// intralciare la digitazione normale di un indirizzo.
const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste di geocodifica, riprova tra qualche secondo.' },
});
router.use(geoLimiter);

router.get('/search', asyncHandler(async (req, res) => {
  try {
    const results = await searchAddress(req.query.q || '');
    res.json({ results });
  } catch (e) {
    log.warn('geocodifica_non_riuscita', { errore: e });
    res.status(502).json({ error: 'Servizio di ricerca indirizzi non disponibile, riprova.' });
  }
}));

router.get('/route', asyncHandler(async (req, res) => {
  const { from_lat, from_lon, to_lat, to_lon } = req.query;
  if (!from_lat || !from_lon || !to_lat || !to_lon) {
    return res.status(400).json({ error: 'Coordinate mancanti' });
  }
  try {
    const route = await calcRoute(
      parseFloat(from_lat), parseFloat(from_lon),
      parseFloat(to_lat), parseFloat(to_lon)
    );
    res.json(route);
  } catch (e) {
    log.warn('percorso_non_calcolato', { errore: e });
    res.status(502).json({ error: 'Servizio di calcolo percorso non disponibile, riprova.' });
  }
}));

// Percorso che attraversa più punti nell'ordine dato (casa -> soste -> sede, o viceversa
// per il ritorno). Niente alternative qui: con più tappe l'obiettivo è la precisione del
// tragitto, non la scelta tra opzioni.
router.post('/route-multi', asyncHandler(async (req, res) => {
  const { punti } = req.body;
  if (!Array.isArray(punti) || punti.length < 2) {
    return res.status(400).json({ error: 'Servono almeno due punti' });
  }
  try {
    const route = await calcRouteMultiPoint(punti);
    res.json(route);
  } catch (e) {
    log.warn('percorso_multitappa_non_calcolato', { errore: e });
    res.status(502).json({ error: 'Servizio di calcolo percorso non disponibile, riprova.' });
  }
}));

module.exports = router;
