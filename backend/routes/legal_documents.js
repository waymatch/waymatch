const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { percorsoSicuro } = require('../utils/safePath');
const { nomeCasuale, inviaFileCaricato } = require('../utils/fileCaricati');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const DOCS_DIR = path.join(UPLOAD_DIR, 'legal-documents');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

// Estensione decisa dal mimetype validato, non dal nome file originale (controllato dal
// client) — stesso motivo di sicurezza già applicato a logo/template voucher.
const MIME_EXT = { 'application/pdf': '.pdf' };
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOCS_DIR),
  filename: (req, file, cb) => cb(null, nomeCasuale(MIME_EXT[file.mimetype] || '.pdf')),
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!MIME_EXT[file.mimetype]) return cb(new Error('Formato non supportato (solo PDF)'));
    cb(null, true);
  },
});

// Il Content-Type dichiarato dal client è falsificabile: verifichiamo che il contenuto
// inizi davvero con la firma di un PDF prima di accettarlo.
function fileScartaSeNonPdf(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(5);
  fs.readSync(fd, buf, 0, 5, 0);
  fs.closeSync(fd);
  if (buf.toString('latin1') !== '%PDF-') {
    fs.unlink(filePath, () => {});
    return false;
  }
  return true;
}

const TIPI_VALIDI = ['generale', 'conducente'];

function conStatoAccettazione(userId) {
  return db.prepare(`
    SELECT d.*, a.versione_accettata, a.accettato_at
    FROM legal_documents d
    LEFT JOIN document_acceptances a ON a.document_id = d.id AND a.user_id = ?
    WHERE d.attivo = 1
    ORDER BY d.id
  `).all(userId);
}

// Tutti i documenti attivi con lo stato di accettazione dell'utente corrente
router.get('/', requireAuth, (req, res) => {
  res.json({ documenti: conStatoAccettazione(req.user.id) });
});

// Solo quelli ancora da accettare (o accettati in una versione precedente). tipo
// filtra per contesto: 'generale' (default, richiesto ovunque nell'app) o 'conducente'
// (richiesto solo prima di offrire un passaggio).
router.get('/pending', requireAuth, (req, res) => {
  const tipo = TIPI_VALIDI.includes(req.query.tipo) ? req.query.tipo : 'generale';
  const documenti = conStatoAccettazione(req.user.id).filter(
    (d) => d.tipo === tipo && (d.versione_accettata === null || d.versione_accettata < d.versione)
  );
  res.json({ documenti });
});

// Un <iframe> o un link non possono inviare l'header Authorization: per mostrare il PDF
// il client chiede un link firmato, valido 15 minuti e solo per questo documento e questo
// utente. Non è un token di accesso: senza sessione (jti) requireAuth lo rifiuta.
const LINK_VALIDITA_SECONDI = 15 * 60;
const SCOPO_LINK = 'file-documento-legale';

function documentoVisibile(doc, utente) {
  return doc && doc.formato === 'pdf' && doc.file_path && (doc.attivo || utente.ruolo === 'mobility_manager');
}

router.post('/:id/link', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id);
  if (!documentoVisibile(doc, req.user)) return res.status(404).json({ error: 'Documento non trovato' });
  const firma = jwt.sign({ doc: doc.id }, JWT_SECRET, {
    algorithm: 'HS256', expiresIn: LINK_VALIDITA_SECONDI, audience: SCOPO_LINK, subject: String(req.user.id),
  });
  res.json({ url: `/api/legal-documents/${doc.id}/file?firma=${encodeURIComponent(firma)}`, scade_tra_secondi: LINK_VALIDITA_SECONDI });
});

router.get('/:id/file', (req, res) => {
  let firma;
  try {
    firma = jwt.verify(String(req.query.firma || ''), JWT_SECRET, { algorithms: ['HS256'], audience: SCOPO_LINK });
  } catch {
    return res.status(401).json({ error: 'Link scaduto o non valido: riapri il documento dall\'app.' });
  }
  if (String(firma.doc) !== String(req.params.id)) return res.status(401).json({ error: 'Link non valido' });
  const utente = db.prepare('SELECT id, ruolo, attivo FROM users WHERE id = ?').get(Number(firma.sub));
  const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id);
  if (!utente || !utente.attivo) return res.status(401).json({ error: 'Link non valido' });
  if (!documentoVisibile(doc, utente)) return res.status(404).json({ error: 'Documento non trovato' });
  inviaFileCaricato(res, doc.file_path, 'application/pdf', { 'Content-Disposition': `inline; filename="documento-${doc.id}.pdf"` });
});

router.post('/:id/accept', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ? AND attivo = 1').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  db.prepare(`
    INSERT INTO document_acceptances (user_id, document_id, versione_accettata) VALUES (?, ?, ?)
    ON CONFLICT(user_id, document_id) DO UPDATE SET versione_accettata = excluded.versione_accettata, accettato_at = datetime('now')
  `).run(req.user.id, doc.id, doc.versione);
  registraAzione(req.user.id, 'documento_accettato', `${doc.titolo} (v${doc.versione})`, 'utente');
  res.json({ ok: true });
});

router.post('/', requireAuth, requireRole('mobility_manager'), upload.single('file'), (req, res) => {
  const { titolo, contenuto } = req.body;
  const tipo = TIPI_VALIDI.includes(req.body.tipo) ? req.body.tipo : 'generale';
  const formato = req.body.formato === 'pdf' ? 'pdf' : 'testo';
  if (!titolo) return res.status(400).json({ error: 'Il titolo è obbligatorio' });

  if (formato === 'pdf') {
    if (!req.file) return res.status(400).json({ error: 'Carica un file PDF' });
    if (!fileScartaSeNonPdf(req.file.path)) return res.status(400).json({ error: 'Il file caricato non è un PDF valido' });
  } else if (!contenuto) {
    return res.status(400).json({ error: 'Il testo del documento è obbligatorio' });
  }

  const filePath = formato === 'pdf' ? '/uploads/legal-documents/' + req.file.filename : null;
  const info = db.prepare(`
    INSERT INTO legal_documents (titolo, contenuto, tipo, formato, file_path, versione) VALUES (?, ?, ?, ?, ?, 1)
  `).run(titolo, contenuto || '', tipo, formato, filePath);
  registraAzione(req.user.id, 'documento_creato', titolo);
  res.json({ documento: db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(info.lastInsertRowid) });
});

// Modificare il contenuto/PDF incrementa la versione (se richiesto), il che richiede a
// tutti di riaccettare.
router.put('/:id', requireAuth, requireRole('mobility_manager'), upload.single('file'), (req, res) => {
  const { titolo, contenuto } = req.body;
  const incrementaVersione = req.body.incrementaVersione === 'true' || req.body.incrementaVersione === true;
  const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Non trovato' });
  if (!titolo) return res.status(400).json({ error: 'Il titolo è obbligatorio' });

  const tipo = TIPI_VALIDI.includes(req.body.tipo) ? req.body.tipo : doc.tipo;
  const formato = req.body.formato === 'pdf' ? 'pdf' : req.body.formato === 'testo' ? 'testo' : doc.formato;

  let filePath = doc.file_path;
  let vecchioFile = null;
  if (formato === 'pdf' && req.file) {
    if (!fileScartaSeNonPdf(req.file.path)) return res.status(400).json({ error: 'Il file caricato non è un PDF valido' });
    if (doc.file_path) vecchioFile = percorsoSicuro(UPLOAD_DIR, doc.file_path.replace('/uploads/', ''));
    filePath = '/uploads/legal-documents/' + req.file.filename;
  } else if (formato === 'testo') {
    if (!contenuto) return res.status(400).json({ error: 'Il testo del documento è obbligatorio' });
    if (doc.formato === 'pdf' && doc.file_path) vecchioFile = percorsoSicuro(UPLOAD_DIR, doc.file_path.replace('/uploads/', ''));
    filePath = null;
  } else if (formato === 'pdf' && !req.file && !doc.file_path) {
    return res.status(400).json({ error: 'Carica un file PDF' });
  }

  const nuovaVersione = incrementaVersione ? doc.versione + 1 : doc.versione;
  db.prepare(`
    UPDATE legal_documents SET titolo = ?, contenuto = ?, tipo = ?, formato = ?, file_path = ?,
      versione = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(titolo, formato === 'pdf' ? (contenuto || '') : contenuto, tipo, formato, filePath, nuovaVersione, doc.id);

  // Ricontrollo esplicito e inline (oltre a percorsoSicuro usato per costruire vecchioFile
  // sopra) subito prima dell'operazione sul filesystem: path.normalize + startsWith contro
  // la cartella consentita, lo stesso pattern suggerito come rimedio per il path traversal.
  if (vecchioFile) {
    const normalizzato = path.normalize(vecchioFile);
    if (normalizzato.startsWith(path.normalize(UPLOAD_DIR) + path.sep)) {
      fs.unlink(normalizzato, () => {});
    }
  }

  registraAzione(req.user.id, 'documento_modificato', `${titolo}${incrementaVersione ? ` (nuova versione v${nuovaVersione}, richiede riaccettazione)` : ''}`);
  res.json({ documento: db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(doc.id) });
});

router.delete('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const doc = db.prepare('SELECT titolo FROM legal_documents WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE legal_documents SET attivo = 0 WHERE id = ?').run(req.params.id);
  if (doc) registraAzione(req.user.id, 'documento_disattivato', doc.titolo);
  res.json({ ok: true });
});

// Riepilogo accettazioni per documento (mobility manager): chi ha accettato e chi no
router.get('/:id/accettazioni', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Non trovato' });
  const utenti = db.prepare(`
    SELECT u.id, u.nome, u.cognome, a.versione_accettata, a.accettato_at
    FROM users u
    LEFT JOIN document_acceptances a ON a.user_id = u.id AND a.document_id = ?
    WHERE u.attivo = 1
    ORDER BY u.cognome, u.nome
  `).all(doc.id);
  res.json({ documento: doc, utenti });
});

module.exports = router;
