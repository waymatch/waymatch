const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { passwordValida, REQUISITI_PASSWORD } = require('../utils/passwordPolicy');
const { hashPassword } = require('../utils/passwordHash');
const { asyncHandler } = require('../utils/asyncHandler');
const { revocaSessioniUtente } = require('../utils/sessioni');

const { ErroreUltimoAdmin, verificaResteUnAdmin, MESSAGGIO: MESSAGGIO_ULTIMO_ADMIN } = require('../utils/ultimoAdmin');

const router = express.Router();
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 * 1024 * 1024 } });
const RUOLI_VALIDI = ['mobility_manager', 'supervisor', 'utente'];

// Endpoint sensibile (reimposta la password di un altro utente): un limite moderato per IP
// riduce il rischio che un account mobility_manager compromesso venga usato per martellare
// reset password su tutti gli utenti.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi reset password in poco tempo, riprova tra qualche minuto.' },
});

function sanitizeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

router.get('/', requireAuth, requireRole('mobility_manager', 'supervisor'), (req, res) => {
  // Saldo punti calcolato in un'unica query aggregata (stessa logica di totalePunti: eventi +
  // assegnazioni manuali) invece di una query per utente, per evitare N+1 su liste di centinaia
  // di persone.
  const users = db.prepare(`
    SELECT u.*, s.nome as sede_nome,
      COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id), 0)
      + COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id), 0) as punti
    FROM users u LEFT JOIN sedi s ON s.id = u.sede_id
    ORDER BY u.cognome, u.nome
  `).all();
  res.json({ users: users.map(sanitizeUser) });
});

router.post('/', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const { nome, cognome, email, password, ruolo, sede_id } = req.body;
  if (!nome || !cognome || !email || !password) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  if (!passwordValida(password)) {
    return res.status(400).json({ error: `Password non valida: richiesti ${REQUISITI_PASSWORD}.` });
  }
  const ruoloFinale = RUOLI_VALIDI.includes(ruolo) ? ruolo : 'utente';
  const hash = await hashPassword(password);
  try {
    const info = db.prepare(`
      INSERT INTO users (nome, cognome, email, password_hash, ruolo, sede_id, password_da_cambiare)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(nome, cognome, email.toLowerCase().trim(), hash, ruoloFinale, sede_id || null);
    registraAzione(req.user.id, 'utente_creato', `${nome} ${cognome} (${email}), ruolo: ${ruoloFinale}`);
    res.json({ user: sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Email già in uso' });
    console.error(e);
    res.status(500).json({ error: 'Errore creazione utente' });
  }
}));

router.put('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, cognome, email, ruolo, sede_id, attivo } = req.body;
  if (!nome || !cognome || !email) {
    return res.status(400).json({ error: 'Nome, cognome ed email sono obbligatori' });
  }
  const ruoloFinale = RUOLI_VALIDI.includes(ruolo) ? ruolo : 'utente';
  const prima = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!prima) return res.status(404).json({ error: 'Utente non trovato' });
  if (Number(req.params.id) === req.user.id && !attivo) {
    return res.status(400).json({ error: 'Non puoi disattivare il tuo stesso account' });
  }
  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE users SET nome = ?, cognome = ?, email = ?, ruolo = ?, sede_id = ?, attivo = ?
        WHERE id = ?
      `).run(nome, cognome, email.toLowerCase().trim(), ruoloFinale, sede_id || null, attivo ? 1 : 0, req.params.id);
      verificaResteUnAdmin();
    })();
  } catch (e) {
    if (e instanceof ErroreUltimoAdmin) return res.status(400).json({ error: MESSAGGIO_ULTIMO_ADMIN });
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Email già in uso' });
    throw e;
  }
  const cambi = [];
  if (prima.ruolo !== ruoloFinale) cambi.push(`ruolo: ${prima.ruolo} → ${ruoloFinale}`);
  if (prima.sede_id !== (sede_id || null)) cambi.push(`sede cambiata`);
  if (prima.attivo !== (attivo ? 1 : 0)) cambi.push(attivo ? 'riattivato' : 'disattivato');
  if (cambi.length > 0) {
    registraAzione(req.user.id, 'utente_modificato', `${nome} ${cognome} (${email}): ${cambi.join(', ')}`);
  }
  res.json({ user: sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/reset-password', requireAuth, requireRole('mobility_manager'), resetPasswordLimiter, asyncHandler(async (req, res) => {
  const { password_nuova } = req.body;
  if (!passwordValida(password_nuova)) {
    return res.status(400).json({ error: `Password non valida: richiesti ${REQUISITI_PASSWORD}.` });
  }
  const utente = db.prepare('SELECT nome, cognome, email FROM users WHERE id = ?').get(req.params.id);
  const hash = await hashPassword(password_nuova);
  // token_version + 1 invalida qualunque sessione già attiva dell'utente (coerente col
  // fatto che le sue credenziali sono appena cambiate senza che l'abbia richiesto lui).
  db.prepare(`
    UPDATE users SET password_hash = ?, token_version = token_version + 1, password_da_cambiare = 1 WHERE id = ?
  `).run(hash, req.params.id);
  revocaSessioniUtente(Number(req.params.id));
  if (utente) registraAzione(req.user.id, 'password_reimpostata', `${utente.nome} ${utente.cognome} (${utente.email})`);
  res.json({ ok: true });
}));

router.delete('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Non puoi eliminare il tuo stesso account' });
  }
  const utente = db.prepare('SELECT nome, cognome, email FROM users WHERE id = ?').get(req.params.id);
  try {
    db.transaction(() => {
      db.prepare('UPDATE users SET attivo = 0 WHERE id = ?').run(req.params.id);
      verificaResteUnAdmin();
    })();
  } catch (e) {
    if (e instanceof ErroreUltimoAdmin) return res.status(400).json({ error: MESSAGGIO_ULTIMO_ADMIN });
    throw e;
  }
  if (utente) registraAzione(req.user.id, 'utente_disattivato', `${utente.nome} ${utente.cognome} (${utente.email})`);
  res.json({ ok: true });
});

// Import massivo da CSV. Formato atteso (con intestazione, separatore virgola):
// Nome,Cognome,email,passtemporanea,ruolo,sede
// La colonna sede è facoltativa (nome esatto di una sede esistente); se assente o vuota
// la sede dell'utente non viene toccata. La colonna ruolo è facoltativa (default: utente).
// La password temporanea deve rispettare la stessa policy di tutta l'app (vedi
// utils/passwordPolicy.js): righe con password non conforme vengono segnalate come
// errore e non creano l'utente (l'utente dovrà comunque sceglierne una sua al primo
// accesso, ma la temporanea non deve essere il punto debole nel frattempo).
//
// Due modalità, distinte dal NOME DEL FILE (per evitare ambiguità pericolose):
// - file normale: crea i nuovi utenti (email non esistente) e aggiorna nome/cognome/
//   ruolo di quelli già esistenti (la password non viene mai toccata in questo caso).
// - file il cui nome contiene "cessat" (es. "cessati_settembre.csv"): considera ogni
//   riga come un utente da DISATTIVARE (si usa solo la colonna email); nessuna verifica
//   di password/ruolo. Nessuna disattivazione avviene mai automaticamente al di fuori
//   di questa modalità esplicita.
// Campi di una riga CSV (RFC 4180): un campo tra virgolette può contenere virgole, e due
// virgolette consecutive valgono una virgoletta. Gli spazi attorno ai campi si tolgono.
function campiCsv(riga) {
  const campi = [];
  let campo = '';
  let traVirgolette = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (traVirgolette) {
      if (c === '"' && riga[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') traVirgolette = false;
      else campo += c;
    } else if (c === '"' && campo.trim() === '') { campo = ''; traVirgolette = true; }
    else if (c === ',') { campi.push(campo.trim()); campo = ''; }
    else campo += c;
  }
  campi.push(campo.trim());
  return campi;
}

router.post('/import-csv', requireAuth, requireRole('mobility_manager'), uploadCsv.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

  const nomeFile = (req.file.originalname || '').toLowerCase();
  const modalitaCessati = nomeFile.includes('cessat');

  const testo = req.file.buffer.toString('utf-8');
  const righe = testo.split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0);
  if (righe.length === 0) return res.status(400).json({ error: 'File vuoto' });

  const primaRigaSembraIntestazione = /nome/i.test(righe[0]) || /email/i.test(righe[0]);
  const dataRighe = primaRigaSembraIntestazione ? righe.slice(1) : righe;

  if (modalitaCessati) {
    const risultati = { disattivati: 0, errori: [] };
    const trovaEmail = db.prepare('SELECT id, nome, cognome, attivo FROM users WHERE email = ?');
    const disattiva = db.prepare('UPDATE users SET attivo = 0 WHERE id = ?');

    // Un'unica transazione invece di un commit su disco per riga: con centinaia di
    // dipendenti l'import passa da qualche secondo a pochi millisecondi. Se alla fine non
    // resta nessun mobility manager attivo, l'intero file viene annullato.
    try {
    db.transaction(() => {
      for (let i = 0; i < dataRighe.length; i++) {
        const colonne = campiCsv(dataRighe[i]);
        // La colonna email può essere in prima posizione (solo email) o terza (formato completo)
        const email = (colonne.find((c) => c.includes('@')) || '').toLowerCase();
        const numeroRiga = i + 1 + (primaRigaSembraIntestazione ? 1 : 0);

        if (!email) { risultati.errori.push(`Riga ${numeroRiga}: nessuna email trovata`); continue; }
        const utente = trovaEmail.get(email);
        if (!utente) { risultati.errori.push(`Riga ${numeroRiga}: nessun utente con email ${email}`); continue; }
        if (utente.id === req.user.id) { risultati.errori.push(`Riga ${numeroRiga}: non puoi disattivare te stesso (${email})`); continue; }
        if (!utente.attivo) continue; // già disattivato, non conta come errore né come azione

        disattiva.run(utente.id);
        risultati.disattivati++;
      }
      verificaResteUnAdmin();
    })();
    } catch (e) {
      if (e instanceof ErroreUltimoAdmin) return res.status(400).json({ error: `${MESSAGGIO_ULTIMO_ADMIN} Nessun utente è stato disattivato.` });
      throw e;
    }
    registraAzione(req.user.id, 'import_csv_cessati', `${risultati.disattivati} utenti disattivati da file "${req.file.originalname}"`);
    return res.json(risultati);
  }

  const insUser = db.prepare(`
    INSERT INTO users (nome, cognome, email, password_hash, ruolo, sede_id, password_da_cambiare) VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const trovaEmail = db.prepare('SELECT id FROM users WHERE email = ?');
  const aggiornaUser = db.prepare('UPDATE users SET nome = ?, cognome = ?, ruolo = ?, sede_id = COALESCE(?, sede_id) WHERE id = ?');
  const tutteLeSedi = db.prepare('SELECT id, nome FROM sedi').all();
  const trovaSedeIdPerNome = (nomeSede) => {
    if (!nomeSede) return { id: null, trovata: true }; // colonna vuota: non tocchiamo la sede
    const match = tutteLeSedi.find((s) => s.nome.toLowerCase().trim() === nomeSede.toLowerCase().trim());
    return match ? { id: match.id, trovata: true } : { id: null, trovata: false };
  };

  const risultati = { creati: 0, aggiornati: 0, errori: [] };

  // Gli hash dei nuovi utenti si calcolano qui, prima della transazione: bcrypt a costo 12
  // costa ~0,5 s per password, e dentro la transazione (sincrona) bloccherebbe il server
  // per minuti con un file di qualche centinaio di righe.
  const hashPerRiga = new Map();
  for (let i = 0; i < dataRighe.length; i++) {
    const [nome, cognome, email, passTemp] = campiCsv(dataRighe[i]);
    if (!nome || !cognome || !email || !passwordValida(passTemp)) continue;
    if (trovaEmail.get(email.toLowerCase().trim())) continue;
    hashPerRiga.set(i, await hashPassword(passTemp));
  }

  // Transazione unica: un solo commit su disco per l'intero file invece di uno per riga.
  // Se alla fine non resta nessun mobility manager attivo (ruoli cambiati dal file), si annulla tutto.
  try {
  db.transaction(() => {
    for (let i = 0; i < dataRighe.length; i++) {
      const colonne = campiCsv(dataRighe[i]);
      const [nome, cognome, email, passTemp, ruoloRaw, sedeNome] = colonne;
      const numeroRiga = i + 1 + (primaRigaSembraIntestazione ? 1 : 0);

      if (!nome || !cognome || !email) {
        risultati.errori.push(`Riga ${numeroRiga}: dati mancanti (servono almeno nome, cognome, email)`);
        continue;
      }
      const ruolo = RUOLI_VALIDI.includes((ruoloRaw || '').toLowerCase()) ? ruoloRaw.toLowerCase() : 'utente';
      const emailNorm = email.toLowerCase().trim();
      const { id: sedeId, trovata: sedeTrovata } = trovaSedeIdPerNome(sedeNome);
      if (sedeNome && !sedeTrovata) {
        risultati.errori.push(`Riga ${numeroRiga}: sede "${sedeNome}" non trovata, non impostata per ${email}`);
      }
      const esistente = trovaEmail.get(emailNorm);

      if (esistente) {
        aggiornaUser.run(nome, cognome, ruolo, sedeId, esistente.id);
        risultati.aggiornati++;
        continue;
      }

      if (!passwordValida(passTemp)) {
        risultati.errori.push(`Riga ${numeroRiga}: password mancante o non conforme per il nuovo utente ${email} (richiesti ${REQUISITI_PASSWORD})`);
        continue;
      }
      const hash = hashPerRiga.get(i);
      if (!hash) {
        risultati.errori.push(`Riga ${numeroRiga}: utente ${email} non creato, riprova l'import`);
        continue;
      }
      try {
        insUser.run(nome, cognome, emailNorm, hash, ruolo, sedeId);
        risultati.creati++;
      } catch (e) {
        risultati.errori.push(`Riga ${numeroRiga}: errore imprevisto (${email})`);
      }
    }
    verificaResteUnAdmin();
  })();
  } catch (e) {
    if (e instanceof ErroreUltimoAdmin) return res.status(400).json({ error: `${MESSAGGIO_ULTIMO_ADMIN} Il file non è stato importato.` });
    throw e;
  }

  registraAzione(req.user.id, 'import_csv_utenti', `${risultati.creati} creati, ${risultati.aggiornati} aggiornati da file "${req.file.originalname}"`);
  res.json(risultati);
}));

module.exports = router;
