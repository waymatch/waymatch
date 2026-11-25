const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { gamificationAttiva } = require('../utils/gamification');
const { registraAzione } = require('../utils/audit');
const { nomeCasuale } = require('../utils/fileCaricati');
const { percorsoSicuro } = require('../utils/safePath');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// L'estensione salvata su disco viene decisa dal mimetype validato, MAI dal nome file
// originale (che è controllato dal client): altrimenti un file "logo.svg" con
// Content-Type falsificato a "image/png" supererebbe il filtro e finirebbe comunque
// salvato con estensione .svg. SVG non è incluso: se servito con quell'estensione può
// contenere script eseguiti dal browser se l'URL viene aperto direttamente.
// Solo i formati che la libreria di immagini (Jimp) sa leggere: un WebP passerebbe il filtro
// e poi fallirebbe alla lettura.
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, nomeCasuale(MIME_EXT[file.mimetype] || '.png')),
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!MIME_EXT[file.mimetype]) return cb(new Error('Formato immagine non supportato (PNG o JPG)'));
    cb(null, true);
  },
});

const { leggi: leggiTiles } = require('../utils/tiles');
const { smtpAttivo } = require('../utils/mailer');
const { log } = require('../utils/structuredLog');
const { giorniLavorativi } = require('../utils/calendario');
const iconaApp = require('../utils/icona');
const MAPPA = (({ url, attribuzione, maxZoom }) => ({ url, attribuzione, maxZoom }))(leggiTiles());

router.get('/', (req, res) => {
  const s = db.prepare('SELECT company_name, logo_path, primary_color, accent_color FROM system_settings WHERE id = 1').get();
  // email_attive: il frontend lo usa per dire la verità (reset password, preferenze) quando
  // SMTP non è configurato.
  const imp = db.prepare('SELECT icon_path, pwa_short_name FROM system_settings WHERE id = 1').get();
  res.json({ branding: { ...s, mappa: MAPPA, email_attive: smtpAttivo(), giorni_lavorativi: giorniLavorativi(),
    icona: { personalizzata: !!iconaApp.sorgente(), caricata: !!imp.icon_path, versione: iconaApp.versione() }, pwa_short_name: imp.pwa_short_name || '',
    gamification: gamificationAttiva() } });
});

router.put('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { primary_color, accent_color, pwa_short_name } = req.body;
  const company_name = typeof req.body.company_name === 'string' ? req.body.company_name.trim() : '';
  if (!company_name || company_name.length > 100) return res.status(400).json({ error: 'Il nome dell\'azienda è obbligatorio (al massimo 100 caratteri)' });
  const coloreValido = (c) => c === undefined || c === null || c === '' || /^#[0-9a-fA-F]{6}$/.test(c);
  if (!coloreValido(primary_color) || !coloreValido(accent_color)) return res.status(400).json({ error: 'Colore non valido (formato #RRGGBB)' });
  db.prepare(`
    UPDATE system_settings SET company_name = ?, primary_color = ?, accent_color = ? WHERE id = 1
  `).run(company_name, primary_color || '#14424F', accent_color || '#3CC8B8');
  if (pwa_short_name !== undefined) {
    const breve = String(pwa_short_name || '').trim().slice(0, 12);
    db.prepare('UPDATE system_settings SET pwa_short_name = ? WHERE id = 1').run(breve || null);
  }
  registraAzione(req.user.id, 'branding_modificato', company_name);
  res.json({ ok: true });
});

router.post('/logo', requireAuth, requireRole('mobility_manager'), upload.single('logo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
  // Il Content-Type dichiarato dal client è falsificabile: verifichiamo che il contenuto
  // sia davvero un'immagine decodificabile prima di accettarla.
  try {
    const { Jimp } = require('jimp');
    await Jimp.read(req.file.path);
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Il file caricato non è un\'immagine valida' });
  }
  const relPath = '/uploads/' + req.file.filename;
  const precedente = db.prepare('SELECT logo_path FROM system_settings WHERE id = 1').get().logo_path;
  // Se il salvataggio fallisce, il file appena caricato non resta su disco senza riferimenti.
  try {
    db.transaction(() => {
      db.prepare('UPDATE system_settings SET logo_path = ? WHERE id = 1').run(relPath);
      registraAzione(req.user.id, 'logo_aggiornato', null);
    })();
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    throw e;
  }
  if (precedente && precedente !== relPath && precedente.startsWith('/uploads/')) {
    const vecchio = path.normalize(percorsoSicuro(UPLOAD_DIR, precedente.replace('/uploads/', '')));
    if (vecchio.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) fs.unlink(vecchio, () => {});
  }
  res.json({ logo_path: relPath });
}));

// Rimozione del logo: al suo posto torna il simbolo di WayMatch (e, se non c'è un'icona caricata,
// anche l'icona dell'app torna quella di WayMatch).
router.delete('/logo', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const precedente = db.prepare('SELECT logo_path FROM system_settings WHERE id = 1').get().logo_path;
  // Prima il file, poi il riferimento: se la cancellazione non riesce il logo resta com'era e si
  // può riprovare (un file già assente va bene).
  if (precedente && precedente.startsWith('/uploads/')) {
    const vecchio = path.normalize(percorsoSicuro(UPLOAD_DIR, precedente.replace('/uploads/', '')));
    if (vecchio.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      try {
        fs.unlinkSync(vecchio);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          log.error('logo_non_cancellato', { errore: e });
          return res.status(500).json({ error: 'Non riesco a cancellare il file del logo: riprova o avvisa l\'IT.' });
        }
      }
    }
  }
  db.transaction(() => {
    db.prepare('UPDATE system_settings SET logo_path = NULL WHERE id = 1').run();
    registraAzione(req.user.id, 'logo_rimosso', null);
  })();
  res.json({ ok: true });
});

// Icona dell'app: pubblica (la scarica il telefono per installare l'app, senza accesso).
router.get('/icona/:dim', asyncHandler(async (req, res) => {
  const dimensione = Number(String(req.params.dim).replace('.png', ''));
  if (!iconaApp.DIMENSIONI.includes(dimensione) || !/^\d+\.png$/.test(req.params.dim)) return res.status(404).json({ error: 'Dimensione non disponibile' });
  const png = await iconaApp.icona(dimensione);
  if (!png) return res.status(404).json({ error: 'Nessuna icona personalizzata' });
  res.set({ 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' }).send(png);
}));

// Icona quadrata dedicata (facoltativa): ha la precedenza sul logo.
router.post('/icona', requireAuth, requireRole('mobility_manager'), upload.single('icona'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
  let master;
  try {
    master = await iconaApp.creaMaster(req.file.path);
  } catch (e) {
    return res.status(400).json({ error: 'Il file caricato non è un\'immagine valida' });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
  const rel = '/uploads/icona-' + nomeCasuale('.png').replace(/\.png$/, '') + '.png';
  fs.writeFileSync(path.join(UPLOAD_DIR, rel.replace('/uploads/', '')), master);
  const precedente = db.prepare('SELECT icon_path FROM system_settings WHERE id = 1').get().icon_path;
  db.prepare('UPDATE system_settings SET icon_path = ? WHERE id = 1').run(rel);
  if (precedente) fs.unlink(path.join(UPLOAD_DIR, precedente.replace('/uploads/', '')), () => {});
  registraAzione(req.user.id, 'icona_app_aggiornata', null);
  res.json({ ok: true });
}));

router.delete('/icona', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const precedente = db.prepare('SELECT icon_path FROM system_settings WHERE id = 1').get().icon_path;
  db.prepare('UPDATE system_settings SET icon_path = NULL WHERE id = 1').run();
  if (precedente) fs.unlink(path.join(UPLOAD_DIR, precedente.replace('/uploads/', '')), () => {});
  registraAzione(req.user.id, 'icona_app_rimossa', null);
  res.json({ ok: true });
});

module.exports = router;
