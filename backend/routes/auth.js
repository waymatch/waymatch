const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken, sessioneDelToken, requireAuth, requireRole } = require('../middleware/auth');
const { totalePunti, totaleGuadagnato } = require('../utils/points');
const { registraAzione } = require('../utils/audit');
const { notifica, notificaMassiva } = require('../utils/notify');
const { inviaEmail, smtpAttivo } = require('../utils/mailer');
const { passwordValida, REQUISITI_PASSWORD } = require('../utils/passwordPolicy');
const { hashPassword, verificaPassword, richiedeRehash } = require('../utils/passwordHash');
const { asyncHandler } = require('../utils/asyncHandler');
const sessioni = require('../utils/sessioni');

const router = express.Router();

// Limite per indirizzo IP (oltre al blocco per singolo account più sotto): protegge da
// tentativi distribuiti su tante email diverse dallo stesso IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi di accesso da questo indirizzo. Riprova tra qualche minuto.' },
});

function sanitizeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

const MAX_TENTATIVI = 5;
const BLOCCO_MINUTI = 15;

function minutiBloccoRimasti(userId) {
  const r = db.prepare(`
    SELECT bloccato_fino > datetime('now') AS attivo,
           CAST((julianday(bloccato_fino) - julianday('now')) * 1440 AS INTEGER) AS minuti
    FROM users WHERE id = ?
  `).get(userId);
  return r && r.attivo ? Math.max(1, r.minuti) : null;
}

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email e password richieste' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !user.attivo) {
    await verificaPassword(password, null);
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  const minutiPrima = minutiBloccoRimasti(user.id);
  if (minutiPrima) {
    return res.status(429).json({ error: `Troppi tentativi falliti. Riprova tra ${minutiPrima} minuto/i.` });
  }

  const ok = await verificaPassword(password, user.password_hash);

  // Riletto dopo la verifica: un tentativo partito in parallelo può aver bloccato
  // l'account nel frattempo, e in quel caso nemmeno la password giusta deve passare.
  const minutiDopo = minutiBloccoRimasti(user.id);
  if (minutiDopo) {
    return res.status(429).json({ error: `Troppi tentativi falliti. Riprova tra ${minutiDopo} minuto/i.` });
  }

  if (!ok) {
    // Incremento atomico: leggere il contatore prima della verifica (asincrona) e
    // riscriverlo dopo farebbe perdere i tentativi lanciati in parallelo.
    const { tentativi_falliti: tentativi } = db.prepare(
      'UPDATE users SET tentativi_falliti = tentativi_falliti + 1 WHERE id = ? RETURNING tentativi_falliti'
    ).get(user.id);
    if (tentativi >= MAX_TENTATIVI) {
      db.prepare(`UPDATE users SET tentativi_falliti = 0, bloccato_fino = datetime('now', '+${BLOCCO_MINUTI} minutes') WHERE id = ?`).run(user.id);
      registraAzione(user.id, 'account_bloccato', `${BLOCCO_MINUTI} minuti dopo ${MAX_TENTATIVI} tentativi falliti`, 'gestione');
      return res.status(429).json({ error: `Troppi tentativi falliti. Account bloccato per ${BLOCCO_MINUTI} minuti.` });
    }
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  db.prepare('UPDATE users SET tentativi_falliti = 0, bloccato_fino = NULL WHERE id = ?').run(user.id);

  // Hash creati con un costo più basso (prima del passaggio a 12) vengono rigenerati qui,
  // l'unico momento in cui il server conosce la password in chiaro. Non tocca
  // token_version: la password è la stessa, le altre sessioni restano valide.
  if (richiedeRehash(user.password_hash)) {
    const nuovoHash = await hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nuovoHash, user.id);
  }

  const { id: sessioneId, segreto } = sessioni.creaSessione(user.id, req);
  sessioni.impostaCookie(req, res, segreto);
  res.json({ token: signToken(user, sessioneId), user: sanitizeUser(user) });
}));

// Endpoint pubblico (il token di accesso può essere già scaduto): l'unica credenziale è
// il cookie httpOnly con il segreto della sessione.
const rinnovoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi, riprova tra qualche minuto.' },
});

router.post('/rinnova', rinnovoLimiter, (req, res) => {
  const sessione = sessioni.sessioneRinnovabile(sessioni.leggiSegreto(req));
  const user = sessione && db.prepare('SELECT * FROM users WHERE id = ?').get(sessione.user_id);
  if (!sessione || !user || !user.attivo) {
    sessioni.cancellaCookie(req, res);
    return res.status(401).json({ error: 'Sessione scaduta, effettua di nuovo l\'accesso' });
  }
  db.prepare(`UPDATE sessioni SET ultimo_uso = datetime('now') WHERE id = ?`).run(sessione.id);
  res.json({ token: signToken(user, sessione.id) });
});

// Funziona anche con il token già scaduto: chiude la sessione indicata dal cookie e/o dal
// token, e cancella il cookie. Risponde sempre ok.
router.post('/logout', (req, res) => {
  sessioni.revocaSessioneDaSegreto(sessioni.leggiSegreto(req));
  const header = req.headers.authorization || '';
  const jti = header.startsWith('Bearer ') ? sessioneDelToken(header.slice(7)) : null;
  if (jti) sessioni.revocaSessione(jti);
  sessioni.cancellaCookie(req, res);
  res.json({ ok: true });
});

router.get('/sessioni', requireAuth, (req, res) => {
  const elenco = sessioni.elencoSessioni(req.user.id).map((s) => ({ ...s, corrente: s.id === req.sessioneId }));
  res.json({ sessioni: elenco });
});

router.delete('/sessioni/:id', requireAuth, (req, res) => {
  const sessione = sessioni.sessioneAttiva(req.params.id);
  if (!sessione || sessione.user_id !== req.user.id) return res.status(404).json({ error: 'Sessione non trovata' });
  sessioni.revocaSessione(sessione.id);
  if (sessione.id === req.sessioneId) sessioni.cancellaCookie(req, res);
  res.json({ ok: true });
});

// Chiude tutte le altre sessioni. Alza anche token_version, quindi pure il
// token di questa sessione cambia: il nuovo è nella risposta.
router.post('/esci-ovunque', requireAuth, (req, res) => {
  sessioni.revocaSessioniUtente(req.user.id, req.sessioneId);
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  registraAzione(req.user.id, 'esci_da_tutti_i_dispositivi', null, 'utente');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: signToken(user, req.sessioneId) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  const punti = totalePunti(user.id);
  const puntiGuadagnati = totaleGuadagnato(user.id);
  res.json({ user: sanitizeUser(user), punti, punti_guadagnati: puntiGuadagnati });
});

router.put('/me', requireAuth, (req, res) => {
  const {
    telefono, auto_marca, auto_modello, auto_anno,
    auto_cilindrata, auto_colore, auto_alimentazione, auto_posti, auto_targa, sede_id,
    indirizzo_casa, casa_lat, casa_lon, citta_casa,
  } = req.body;

  db.prepare(
    `UPDATE users SET telefono = ?, auto_marca = ?, auto_modello = ?, auto_anno = ?,
     auto_cilindrata = ?, auto_colore = ?, auto_alimentazione = ?, auto_posti = ?, auto_targa = ?, sede_id = ?,
     indirizzo_casa = ?, casa_lat = ?, casa_lon = ?, citta_casa = ?
     WHERE id = ?`
  ).run(
    telefono || null, auto_marca || null, auto_modello || null,
    auto_anno || null, auto_cilindrata || null, auto_colore || null, auto_alimentazione || null,
    auto_posti || 3, auto_targa || null, sede_id || null,
    indirizzo_casa || null, casa_lat ?? null, casa_lon ?? null, citta_casa || null,
    req.user.id
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: sanitizeUser(user) });
});

// Tentativi sulla password attuale: con un token rubato non si possono provare password
// all'infinito. Si contano solo i tentativi falliti, per utente (il limite per IP è quello
// generale di tutte le API).
const cambioPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `utente:${req.user.id}`,
  message: { error: 'Troppi tentativi di cambio password. Riprova tra qualche minuto.' },
});

router.put('/me/password', requireAuth, cambioPasswordLimiter, asyncHandler(async (req, res) => {
  const { password_attuale, password_nuova } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verificaPassword(password_attuale, user.password_hash))) {
    return res.status(400).json({ error: 'Password attuale errata' });
  }
  if (!passwordValida(password_nuova)) {
    return res.status(400).json({ error: `Password non valida: richiesti ${REQUISITI_PASSWORD}.` });
  }
  const hash = await hashPassword(password_nuova);
  // Incrementare token_version invalida subito ogni token emesso prima d'ora (es. su un
  // altro dispositivo con la vecchia password): qui sotto ne riemettiamo uno nuovo, valido,
  // solo per la sessione che ha appena effettuato il cambio. Se era una password scelta da
  // qualcun altro (nuovo account, reset da MM), la scelta di una password propria chiude
  // anche l'obbligo di cambiarla.
  db.prepare(`
    UPDATE users SET password_hash = ?, token_version = token_version + 1, password_da_cambiare = 0
    WHERE id = ?
  `).run(hash, req.user.id);
  sessioni.revocaSessioniUtente(req.user.id, req.sessioneId);
  const aggiornato = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, token: signToken(aggiornato, req.sessioneId) });
}));

const RESET_TOKEN_ORE_VALIDITA = 2;

function generaToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function generaPasswordTemporanea() {
  // Facile da leggere/dettare a voce (niente caratteri ambigui tipo 0/O, 1/l/I), ma
  // comunque casuale e conforme alla policy password (14+ caratteri, maiuscola, numero,
  // speciale): chi la riceve dovrà comunque sceglierne una sua al primo accesso, ma nel
  // frattempo la temporanea non deve essere il punto debole.
  const minuscole = 'abcdefghjkmnpqrstuvwxyz';
  const maiuscole = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const numeri = '23456789';
  const speciali = '!@#$%&*?-_';
  const tutti = minuscole + maiuscole + numeri + speciali;
  const LUNGHEZZA = 16;

  const caratteri = [
    maiuscole[crypto.randomInt(maiuscole.length)],
    numeri[crypto.randomInt(numeri.length)],
    speciali[crypto.randomInt(speciali.length)],
  ];
  for (let i = caratteri.length; i < LUNGHEZZA; i++) caratteri.push(tutti[crypto.randomInt(tutti.length)]);

  // Fisher-Yates: senza mescolare, i tre caratteri "obbligatori" sarebbero sempre nelle
  // prime posizioni, rendendo la password più prevedibile del necessario.
  for (let i = caratteri.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [caratteri[i], caratteri[j]] = [caratteri[j], caratteri[i]];
  }
  return caratteri.join('');
}

// Richiesta di reset password (link "Password dimenticata?" in login, non autenticata).
// Risposta sempre uguale indipendentemente dal fatto che l'email esista, per non rivelare
// quali indirizzi sono registrati.
const passwordDimenticataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi, riprova tra qualche minuto.' },
});

// Limite per indirizzo, oltre a quello per IP: nessuno può riempire di richieste (o di
// email, con SMTP attivo) la casella di un collega. Si conta ogni richiesta per
// quell'indirizzo, esista o no l'utente, quindi il 429 non rivela nulla.
const passwordDimenticataPerEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `email:${String(req.body && req.body.email).toLowerCase().trim()}`,
  skip: (req) => !req.body || typeof req.body.email !== 'string' || !req.body.email,
  message: { error: 'Troppe richieste per questo indirizzo, riprova tra un\'ora.' },
});

router.post('/password-dimenticata', passwordDimenticataLimiter, passwordDimenticataPerEmailLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;
  const rispostaGenerica = { ok: true };
  if (!email) return res.json(rispostaGenerica);

  const utente = db.prepare('SELECT * FROM users WHERE email = ? AND attivo = 1').get(email.toLowerCase().trim());
  if (!utente) return res.json(rispostaGenerica);

  if (smtpAttivo()) {
    const token = generaToken();
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, scade_il)
      VALUES (?, ?, datetime('now', '+${RESET_TOKEN_ORE_VALIDITA} hours'))
    `).run(utente.id, hashToken(token));
    const url = `${process.env.APP_URL || ''}/reimposta-password?token=${token}`;
    await inviaEmail(
      utente.email, 'Carpooling — reimposta la tua password',
      `Hai richiesto di reimpostare la password. Apri questo link entro ${RESET_TOKEN_ORE_VALIDITA} ore: ${url}\n\n` +
      `Se non sei stato tu, ignora questa email: la tua password non è stata modificata.`
    );
  } else {
    // Nessuna email disponibile per contattare l'utente in modo sicuro: la richiesta va
    // gestita da un mobility manager (vedi le route sotto).
    const giaInAttesa = db.prepare(`
      SELECT 1 FROM password_reset_requests WHERE user_id = ? AND stato = 'in_attesa'
    `).get(utente.id);
    if (!giaInAttesa) {
      db.prepare('INSERT INTO password_reset_requests (user_id) VALUES (?)').run(utente.id);
      registraAzione(utente.id, 'password_reset_richiesta_creata', null, 'utente');
      const mm = db.prepare(`SELECT id FROM users WHERE ruolo = 'mobility_manager' AND attivo = 1`).all();
      await notificaMassiva(
        mm.map((m) => m.id), 'richiesta_reset_password_ricevuta',
        `${utente.nome} ${utente.cognome} ha richiesto la reimpostazione della password.`
      );
    }
  }
  res.json(rispostaGenerica);
}));

// Il token di reset è lungo e casuale, ma il tentativo a vuoto non deve costare niente
// all'attaccante: limite per IP anche qui.
const reimpostaPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi, riprova tra qualche minuto.' },
});

router.post('/reimposta-password', reimpostaPasswordLimiter, asyncHandler(async (req, res) => {
  const { token, password_nuova } = req.body;
  if (!token) return res.status(400).json({ error: 'Dati mancanti' });
  if (!passwordValida(password_nuova)) {
    return res.status(400).json({ error: `Password non valida: richiesti ${REQUISITI_PASSWORD}.` });
  }
  // Hash calcolato prima di leggere il token: da qui in poi niente await, così lettura e
  // consumo del token restano atomici e lo stesso link non vale per due richieste parallele.
  const hash = await hashPassword(password_nuova);
  const riga = db.prepare(`
    SELECT * FROM password_reset_tokens WHERE token_hash = ? AND usato = 0 AND scade_il > datetime('now')
  `).get(hashToken(token));
  if (!riga) return res.status(400).json({ error: 'Link non valido o scaduto: richiedine uno nuovo.' });

  db.prepare(`
    UPDATE users SET password_hash = ?, token_version = token_version + 1, password_da_cambiare = 0 WHERE id = ?
  `).run(hash, riga.user_id);
  db.prepare('UPDATE password_reset_tokens SET usato = 1 WHERE id = ?').run(riga.id);
  sessioni.revocaSessioniUtente(riga.user_id);
  res.json({ ok: true });
}));

// Lato mobility manager: richieste in attesa quando SMTP non è configurato.
router.get('/password-reset-richieste', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const richieste = db.prepare(`
    SELECT r.*, u.nome, u.cognome, u.email FROM password_reset_requests r
    JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
  `).all();
  res.json({ richieste, smtp_attivo: smtpAttivo() });
});

router.post('/password-reset-richieste/:id/genera', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  // Hash prima dei controlli: tra la verifica "in attesa" e la chiusura della richiesta non
  // ci sono await, quindi due click paralleli non generano due password diverse.
  const passwordTemp = generaPasswordTemporanea();
  const hash = await hashPassword(passwordTemp);

  const richiesta = db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(req.params.id);
  if (!richiesta || richiesta.stato !== 'in_attesa') {
    return res.status(400).json({ error: 'Nessuna richiesta in attesa con questo id' });
  }
  const utente = db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.user_id);
  if (!utente) return res.status(404).json({ error: 'Utente non trovato' });

  db.prepare(`
    UPDATE users SET password_hash = ?, token_version = token_version + 1, password_da_cambiare = 1 WHERE id = ?
  `).run(hash, utente.id);
  sessioni.revocaSessioniUtente(utente.id);
  db.prepare(`
    UPDATE password_reset_requests SET stato = 'completata', gestita_da = ?, gestita_at = datetime('now') WHERE id = ?
  `).run(req.user.id, richiesta.id);

  registraAzione(req.user.id, 'password_reset_generata_mm', `${utente.nome} ${utente.cognome} (${utente.email})`);
  await notifica(
    utente.id, 'password_reset_completata',
    'Il mobility manager ti ha assegnato una nuova password temporanea: te la comunicherà a parte. Al primo accesso ti verrà chiesto di sceglierne una tua.'
  );
  res.json({ ok: true, password_temporanea: passwordTemp, utente: { nome: utente.nome, cognome: utente.cognome, email: utente.email } });
}));

module.exports = router;
