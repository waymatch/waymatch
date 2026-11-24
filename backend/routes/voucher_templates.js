const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { nomeCasuale, inviaFileCaricato } = require('../utils/fileCaricati');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const TEMPLATES_DIR = path.join(UPLOAD_DIR, 'voucher-templates');
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

// Estensione decisa dal mimetype validato, non dal nome file originale (controllato dal
// client) — vedi lo stesso commento in routes/branding.js.
// Solo i formati che la libreria di immagini (Jimp) sa leggere: un WebP passerebbe il filtro
// e poi fallirebbe alla lettura.
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMPLATES_DIR),
  filename: (req, file, cb) => cb(null, nomeCasuale(MIME_EXT[file.mimetype] || '.png')),
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!MIME_EXT[file.mimetype]) return cb(new Error('Formato immagine non supportato (PNG o JPG)'));
    cb(null, true);
  },
});

router.get('/', requireAuth, (req, res) => {
  const templates = db.prepare('SELECT * FROM voucher_templates ORDER BY created_at DESC').all();
  res.json({ templates });
});

// Anteprima per la gestione premi. L'utente vede solo il voucher già generato
// (GET /api/rewards/redemptions/:id/voucher-image).
const TIPO_DA_ESTENSIONE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
router.get('/:id/immagine', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const t = db.prepare('SELECT immagine_path FROM voucher_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template non trovato' });
  const tipo = TIPO_DA_ESTENSIONE[path.extname(t.immagine_path).toLowerCase()];
  if (!tipo) return res.status(404).json({ error: 'Template non trovato' });
  inviaFileCaricato(res, t.immagine_path, tipo);
});

router.post('/', requireAuth, requireRole('mobility_manager'), upload.single('immagine'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessuna immagine caricata' });
  try {
    const { Jimp } = require('jimp');
    await Jimp.read(req.file.path);
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Il file caricato non è un\'immagine valida' });
  }
  const { nome } = req.body;
  const relPath = '/uploads/voucher-templates/' + req.file.filename;
  const info = db.prepare('INSERT INTO voucher_templates (nome, immagine_path) VALUES (?, ?)').run(nome || 'Template', relPath);
  registraAzione(req.user.id, 'voucher_template_creato', nome || 'Template');
  res.json({ template: db.prepare('SELECT * FROM voucher_templates WHERE id = ?').get(info.lastInsertRowid) });
}));

router.delete('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  // Anche un premio disattivato può avere voucher già emessi che usano questo template.
  const inUso = db.prepare('SELECT COUNT(*) as n FROM rewards WHERE voucher_template_id = ?').get(req.params.id).n;
  if (inUso > 0) return res.status(400).json({ error: 'Template usato da uno o più premi, anche disattivati: assegna prima un altro template a quei premi.' });
  db.prepare('DELETE FROM voucher_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
