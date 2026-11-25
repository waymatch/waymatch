const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken } = require('../middleware/auth');
const { passwordValida, REQUISITI_PASSWORD } = require('../utils/passwordPolicy');
const { hashPassword } = require('../utils/passwordHash');
const { asyncHandler } = require('../utils/asyncHandler');
const { creaSessione, impostaCookie } = require('../utils/sessioni');
const { log } = require('../utils/structuredLog');

const router = express.Router();

// Il setup si usa una volta sola: pochi tentativi per IP bastano e chiudono la porta a chi
// prova a indovinare o a occupare l'installazione appena esposta.
const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi, riprova più tardi.' },
});

router.get('/status', (req, res) => {
  const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
  res.json({ initialized: !!settings.initialized, company_name: settings.company_name });
});

// Eseguibile solo se il sistema non è ancora stato inizializzato.
router.post('/', setupLimiter, asyncHandler(async (req, res) => {
  const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
  if (settings.initialized) {
    return res.status(400).json({ error: 'Il sistema è già stato configurato' });
  }

  const { company_name, nome, cognome, email, password, sedi } = req.body;
  if (!nome || !cognome || !email || !password) {
    return res.status(400).json({ error: 'Dati amministratore mancanti' });
  }
  if (!passwordValida(password)) {
    return res.status(400).json({ error: `Password non valida: richiesti ${REQUISITI_PASSWORD}.` });
  }

  const hash = await hashPassword(password);
  const tx = db.transaction(() => {
    // Ricontrollato dentro la transazione: durante l'hash un'altra richiesta di setup
    // potrebbe aver già inizializzato il sistema.
    if (db.prepare('SELECT initialized FROM system_settings WHERE id = 1').get().initialized) {
      throw new Error('GIA_INIZIALIZZATO');
    }
    const info = db
      .prepare(
        `INSERT INTO users (nome, cognome, email, password_hash, ruolo) VALUES (?, ?, ?, ?, 'mobility_manager')`
      )
      .run(nome, cognome, email.toLowerCase().trim(), hash);

    db.prepare(
      `UPDATE system_settings SET initialized = 1, company_name = ? WHERE id = 1`
    ).run(company_name || 'La Mia Azienda');

    if (Array.isArray(sedi)) {
      const insSede = db.prepare('INSERT INTO sedi (nome, indirizzo, lat, lon) VALUES (?, ?, ?, ?)');
      for (const s of sedi) {
        if (s && s.nome) insSede.run(s.nome, s.indirizzo || null, s.lat ?? null, s.lon ?? null);
      }
    }

    return info.lastInsertRowid;
  });

  try {
    const adminId = tx();
    const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId);
    const { id: sessioneId, segreto } = creaSessione(admin.id, req);
    impostaCookie(req, res, segreto);
    const token = signToken(admin, sessioneId);
    res.json({ token, user: sanitizeUser(admin) });
  } catch (e) {
    if (e.message === 'GIA_INIZIALIZZATO') {
      return res.status(400).json({ error: 'Il sistema è già stato configurato' });
    }
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Email già in uso' });
    }
    log.error('setup_fallito', { errore: e });
    res.status(500).json({ error: 'Errore durante il setup' });
  }
}));

function sanitizeUser(u) {
  // foto_path è un percorso interno: fuori resta solo foto_versione, e solo se la foto c'è
  // (il contatore resta anche dopo una rimozione).
  const { password_hash, foto_path, ...rest } = u;
  return { ...rest, foto_versione: foto_path ? rest.foto_versione : null };
}

module.exports = router;
