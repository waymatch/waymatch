// Foto del profilo: la carica e la toglie l'utente; la vedono i colleghi (solo dopo l'accesso)
// accanto al suo nome. Il mobility manager può toglierne una inappropriata. Il file è cifrato su
// disco (utils/fotoProfilo.js) e passa in chiaro solo nella risposta autenticata.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { asyncHandler } = require('../utils/asyncHandler');
const foto = require('../utils/fotoProfilo');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function togli(userId) {
  const u = db.prepare('SELECT foto_path FROM users WHERE id = ?').get(userId);
  if (!u) return false;
  db.prepare('UPDATE users SET foto_path = NULL, foto_versione = NULL WHERE id = ?').run(userId);
  foto.elimina(u.foto_path); // dopo l'aggiornamento: al massimo resta un file orfano, mai un riferimento a un file assente
  return true;
}

router.put('/', requireAuth, (req, res, next) => {
  upload.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La foto supera i 5 MB.' : 'Caricamento non valido.' });
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Scegli una foto.' });
  let jpeg;
  try {
    jpeg = await foto.prepara(req.file.buffer);
  } catch (e) {
    if (e instanceof foto.FotoNonValida) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rel = foto.salva(jpeg);
  const prima = db.transaction(() => {
    const u = db.prepare('SELECT foto_path FROM users WHERE id = ?').get(req.user.id);
    db.prepare('UPDATE users SET foto_path = ?, foto_versione = COALESCE(foto_versione, 0) + 1 WHERE id = ?').run(rel, req.user.id);
    return u?.foto_path;
  })();
  foto.elimina(prima);
  registraAzione(req.user.id, 'foto_profilo_caricata', '', 'utente');
  res.json({ foto_versione: db.prepare('SELECT foto_versione FROM users WHERE id = ?').get(req.user.id).foto_versione });
}));

router.delete('/', requireAuth, (req, res) => {
  togli(req.user.id);
  registraAzione(req.user.id, 'foto_profilo_rimossa', '', 'utente');
  res.json({ ok: true });
});

// Il mobility manager toglie la foto di un collega (per esempio se non è appropriata).
router.delete('/:userId', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const u = db.prepare('SELECT id, nome, cognome FROM users WHERE id = ?').get(req.params.userId);
  if (!u) return res.status(404).json({ error: 'Utente non trovato' });
  togli(u.id);
  registraAzione(req.user.id, 'foto_profilo_rimossa_mm', `${u.nome} ${u.cognome}`);
  res.json({ ok: true });
});

router.get('/:userId', requireAuth, (req, res) => {
  const u = db.prepare('SELECT foto_path, foto_versione FROM users WHERE id = ? AND attivo = 1').get(req.params.userId);
  if (!u?.foto_path) return res.status(404).json({ error: 'Nessuna foto' });
  let jpeg;
  try {
    jpeg = foto.leggi(u.foto_path);
  } catch (e) {
    console.error(`[foto profilo] utente ${req.params.userId}: ${e.message}`);
    return res.status(404).json({ error: 'Nessuna foto' });
  }
  // Cache solo nel browser di chi è autenticato; il numero di versione nell'indirizzo cambia a ogni nuova foto.
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.send(jpeg);
});

module.exports = router;
module.exports.togli = togli;
