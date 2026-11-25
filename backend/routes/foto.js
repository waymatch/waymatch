// Foto del profilo: la carica e la toglie l'utente; la vedono i colleghi (solo dopo l'accesso)
// accanto al suo nome. Il Mobility Manager può toglierne una inappropriata. Il file è cifrato su
// disco (utils/fotoProfilo.js) e passa in chiaro solo nella risposta autenticata.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { asyncHandler } = require('../utils/asyncHandler');
const foto = require('../utils/fotoProfilo');
const { log } = require('../utils/structuredLog');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function togli(userId) {
  const u = db.prepare('SELECT foto_path FROM users WHERE id = ?').get(userId);
  if (!u) return false;
  // foto_versione resta: una foto caricata dopo avrà comunque un numero nuovo (vedi sotto).
  db.prepare('UPDATE users SET foto_path = NULL WHERE id = ?').run(userId);
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
  const esito = db.transaction(() => {
    const u = db.prepare('SELECT foto_path FROM users WHERE id = ? AND attivo = 1').get(req.user.id);
    if (!u) return null; // account disattivato o anonimizzato mentre la foto si caricava
    // La versione cresce sempre, anche dopo una rimozione: un indirizzo già visto non torna mai a
    // indicare una foto diversa (cache del browser).
    db.prepare('UPDATE users SET foto_path = ?, foto_versione = COALESCE(foto_versione, 0) + 1 WHERE id = ? AND attivo = 1').run(rel, req.user.id);
    return { prima: u.foto_path };
  })();
  if (!esito) {
    foto.elimina(rel);
    return res.status(403).json({ error: 'Account non attivo.' });
  }
  foto.elimina(esito.prima);
  registraAzione(req.user.id, 'foto_profilo_caricata', '', 'utente');
  res.json({ foto_versione: db.prepare('SELECT foto_versione FROM users WHERE id = ?').get(req.user.id).foto_versione });
}));

router.delete('/', requireAuth, (req, res) => {
  togli(req.user.id);
  registraAzione(req.user.id, 'foto_profilo_rimossa', '', 'utente');
  res.json({ ok: true });
});

// Il Mobility Manager toglie la foto di un collega (per esempio se non è appropriata).
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
  // Il browser la tiene ma la riconvalida ogni volta: una foto rimossa o di un account disattivato
  // non resta visibile dalla cache; se non è cambiata la risposta è un 304, senza decifrarla.
  const etag = `"foto-${req.params.userId}-${u.foto_versione}"`;
  res.set({ 'Cache-Control': 'private, no-cache', ETag: etag });
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  let jpeg;
  try {
    jpeg = foto.leggi(u.foto_path);
  } catch (e) {
    log.error('foto_profilo_non_leggibile', { errore: e, user_id: req.params.userId });
    return res.status(404).json({ error: 'Nessuna foto' });
  }
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' });
  res.send(jpeg);
});

module.exports = router;
module.exports.togli = togli;
