require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const tiles = require('./utils/tiles').leggi();
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { percorsoSicuro } = require('./utils/safePath');

const app = express();
const PORT = process.env.PORT || 4000;

// L'app gira dietro un reverse proxy (Caddy) in produzione, che imposta X-Forwarded-For.
// Senza questo, Express non si fida di quell'header: express-rate-limit lo rileva come
// una possibile falsificazione e rifiuta la richiesta con un errore 500 (tutte le
// richieste che passano dal proxy, quindi in pratica tutto il traffico reale).
// "1" = fidati di esattamente un hop di proxy davanti all'app.
app.set('trust proxy', 1);

// Header di sicurezza standard (nosniff, frameguard anti-clickjacking, niente referrer a
// terzi, HSTS quando servito in HTTPS...) più una Content-Security-Policy esplicita.
// Elenco delle risorse esterne legittime caricate dalla pagina (censite nel codice, non a
// occhio): tile mappa dal provider scelto in TILE_URL (img-src), font inclusi nel progetto
// (style-src/font-src). 'unsafe-inline' su style-src serve a Leaflet, che posiziona tile e
// marker con stili inline via JS — non indebolisce la protezione da XSS (che dipende da
// script-src, qui senza eccezioni). Nessuna chiamata diretta del browser verso servizi
// esterni: Nominatim/Photon/OSRM passano sempre dal backend (connect-src resta 'self').
// Permissions-Policy: l'app non usa nessuna funzione del dispositivo (camera, microfono,
// posizione, pagamenti, USB, sensori): le disattiva per sé e per eventuali contenuti incorporati.
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), geolocation=()');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      // blob: serve alle immagini caricate con il login (voucher, template) e mostrate
      // da un URL locale creato nel browser.
      imgSrc: ["'self'", 'data:', 'blob:', tiles.origine],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

app.use(compression());
// Il frontend è servito dallo stesso dominio/porta dell'API (stesso Express, vedi sotto):
// le pagine dell'app non hanno bisogno di CORS per funzionare (richieste same-origin).
// Questo blocca invece, di default, qualunque ALTRO sito che provi a chiamare l'API a
// nome di un utente già loggato nel browser. ALLOWED_ORIGIN va impostato solo se in
// futuro serve un accesso legittimo da un altro dominio (es. un'app mobile separata).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : { origin: false }));
app.use(express.json());

// Backstop generico contro traffico anomalo (script impazzito, account compromesso...).
// Volutamente alto: molti dipendenti di un ufficio possono condividere lo stesso IP
// pubblico dietro un NAT aziendale, quindi un limite troppo basso per IP colpirebbe
// utenti legittimi invece dell'abuso. I singoli endpoint sensibili (login, reset
// password, geocodifica) hanno già limiti propri più stretti.
app.use('/api', rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste, riprova tra qualche minuto.' },
}));

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Dei file caricati è pubblico solo il logo in uso, che serve già nella pagina di login.
// Template voucher e PDF legali si scaricano dalle rispettive API, che
// richiedono l'accesso.
app.get('/uploads/:nome', (req, res, next) => {
  const logo = db.prepare('SELECT logo_path FROM system_settings WHERE id = 1').get().logo_path;
  if (!logo || logo !== `/uploads/${req.params.nome}`) return next();
  res.sendFile(percorsoSicuro(UPLOAD_DIR, req.params.nome), {
    headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' },
  }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'File non trovato' }); });
});
app.use('/uploads', (req, res) => res.status(404).json({ error: 'File non trovato' }));

app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sedi', require('./routes/sedi'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/points', require('./routes/points'));
app.use('/api/point-rules', require('./routes/point_rules'));
app.use('/api/geo', require('./routes/geo'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/push', require('./routes/push'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/notification-prefs', require('./routes/notification_prefs'));
app.use('/api/audit-log', require('./routes/audit_log'));
app.use('/api/rewards', require('./routes/rewards'));
app.use('/api/contests', require('./routes/contests'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/branding', require('./routes/branding'));
app.use('/api/recurring-rides', require('./routes/recurring_rides'));
app.use('/api/legal-documents', require('./routes/legal_documents'));
app.use('/api/voucher-templates', require('./routes/voucher_templates'));
app.use('/api/privacy', require('./routes/privacy'));
app.use('/api/email', require('./routes/email_diagnostica'));
app.use('/api/sistema', require('./routes/sistema'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/favorites', require('./routes/favorites'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve il frontend buildato (Vite) in produzione
// Manifest dell'app installabile: nome, colori e icone dell'azienda (o di WayMatch, senza
// personalizzazioni). Deve stare PRIMA dei file statici, che contengono una copia di base.
app.get('/manifest.webmanifest', (req, res) => {
  res.set({ 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }).send(JSON.stringify(require('./utils/icona').manifest()));
});

const FRONTEND_DIST = path.join(__dirname, 'public');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  // Il dettaglio (stack, messaggi di driver/librerie) va solo nei log del server: al
  // client arriva sempre un messaggio generico, per non rivelare dettagli interni
  // (schema del DB, percorsi, versioni di librerie...) a chi riceve una risposta 500.
  console.error(err);
  res.status(500).json({ error: 'Errore interno del server' });
});

// Rete di sicurezza: una promise rifiutata fuori da una route (es. un'attività in
// background) viene registrata invece di terminare il processo. Le route async usano
// asyncHandler; un test controlla che nessuna lo dimentichi.
process.on('unhandledRejection', (motivo) => {
  console.error('[unhandledRejection]', motivo);
});

app.listen(PORT, () => {
  console.log(`Carpooling backend in ascolto sulla porta ${PORT}`);
  require('./scheduler').avviaScheduler();
  require('./utils/backfillCitta').backfillCittaMancanti()
    .catch((e) => console.error('Recupero città non riuscito:', e.message));
});
