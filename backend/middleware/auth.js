const jwt = require('jsonwebtoken');
const db = require('../db');
const { readSecret } = require('../utils/secrets');
const { sessioneAttiva, registraUso } = require('../utils/sessioni');
const { sicurezza } = require('../utils/structuredLog');

const JWT_SECRET = readSecret('JWT_SECRET');
if (!JWT_SECRET) {
  // Niente valore di default debole: se il secret manca, il server non deve partire in
  // silenzio con una chiave nota e indovinabile da chiunque legga il codice sorgente.
  throw new Error('JWT_SECRET non impostato: imposta JWT_SECRET (o JWT_SECRET_FILE) prima di avviare il server.');
}

// Chi copia .env.example senza cambiarlo avvierebbe l'app con un segreto pubblico: meglio
// rifiutare di partire. Servono almeno 32 caratteri e non il valore d'esempio.
if (JWT_SECRET.length < 32 || /^cambia-questo|^genera-un-valore/i.test(JWT_SECRET)) {
  throw new Error('JWT_SECRET non valido: servono almeno 32 caratteri e non il valore d\'esempio. Genera un valore con: openssl rand -hex 32');
}

const CONSENTITE_CON_PASSWORD_PROVVISORIA = new Set(['GET /api/auth/me', 'PUT /api/auth/me/password']);

// Il JWT serve solo a stabilire "chi sei" (id) in modo sicuro. Attributi che possono
// cambiare nel tempo (sede, ruolo, stato attivo) vengono sempre riletti dal database ad
// ogni richiesta, così un cambio di sede o ruolo ha effetto immediato senza dover
// rifare login e aspettare la scadenza del vecchio token (8 ore).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non autenticato' });
  // Solo un token non valido o scaduto è un errore di autenticazione. Un guasto del database
  // passa al gestore degli errori (500): rispondere 401 farebbe uscire l'utente senza motivo.
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Sessione scaduta o non valida' });
  }
  try {
    // Ogni token appartiene a una sessione: se è stata revocata (logout, revoca dal
    // profilo, cambio password) il token smette di valere subito, non alla scadenza.
    const sessione = payload.jti ? sessioneAttiva(payload.jti) : null;
    if (!sessione || sessione.user_id !== payload.id) {
      return res.status(401).json({ error: 'Sessione non più valida, effettua di nuovo l\'accesso' });
    }
    const utente = db.prepare('SELECT id, email, ruolo, sede_id, nome, cognome, attivo, token_version, password_da_cambiare FROM users WHERE id = ?').get(payload.id);
    if (!utente || !utente.attivo) return res.status(401).json({ error: 'Sessione non più valida' });
    // Un cambio/reset password incrementa token_version: invalida immediatamente ogni
    // token emesso prima, anche se non ancora scaduto (dura fino a 8 ore).
    if ((payload.v || 0) !== (utente.token_version || 0)) {
      return res.status(401).json({ error: 'Sessione non più valida, effettua di nuovo l\'accesso' });
    }
    // Password provvisoria (scelta da un Mobility Manager o da un import): finché l'utente
    // non ne sceglie una sua, le API rispondono solo al profilo e al cambio password.
    // Logout e rinnovo non passano da qui e restano disponibili.
    if (utente.password_da_cambiare && !CONSENTITE_CON_PASSWORD_PROVVISORIA.has(`${req.method} ${req.baseUrl}${req.path}`)) {
      return res.status(403).json({ error: 'Prima di continuare devi scegliere una nuova password.', codice: 'PASSWORD_DA_CAMBIARE' });
    }
    delete utente.token_version;
    delete utente.password_da_cambiare;
    registraUso(sessione.id);
    req.user = utente;
    req.sessioneId = sessione.id;
  } catch (e) {
    return next(e);
  }
  next();
}

function requireRole(...ruoli) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    if (!ruoli.includes(req.user.ruolo)) {
      sicurezza('warn', 'accesso_negato', req, { user_id: req.user.id, ruolo: req.user.ruolo, metodo: req.method, percorso: req.originalUrl.split('?')[0] });
      return res.status(403).json({ error: 'Non autorizzato per questa azione' });
    }
    next();
  };
}

// Il token di accesso dura al massimo 8 ore. Finché la sessione resta in uso
// il client ne ottiene uno nuovo da POST /api/auth/rinnova, senza rifare il login.
function signToken(user, sessioneId) {
  return jwt.sign({ id: user.id, v: user.token_version || 0 }, JWT_SECRET, { expiresIn: '8h', jwtid: sessioneId });
}

// Per il logout: anche un token già scaduto identifica la sessione da chiudere, purché la
// firma sia valida.
function sessioneDelToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], ignoreExpiration: true }).jti || null;
  } catch {
    return null;
  }
}

module.exports = { requireAuth, requireRole, signToken, sessioneDelToken, JWT_SECRET };
