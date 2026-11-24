const crypto = require('crypto');
const path = require('path');
const { percorsoSicuro } = require('./safePath');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// Nome su disco sempre generato dal server e non indovinabile.
function nomeCasuale(estensione) {
  return `${crypto.randomUUID()}${estensione}`;
}

// relPath è il valore salvato nel database ("/uploads/..."). Mai in cache condivise: il
// file è servito solo a chi ha i permessi.
function inviaFileCaricato(res, relPath, tipo, intestazioni = {}) {
  const file = percorsoSicuro(UPLOAD_DIR, relPath.replace(/^\/uploads\//, ''));
  res.sendFile(file, {
    headers: { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', ...intestazioni },
  }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'File non trovato' }); });
}

module.exports = { UPLOAD_DIR, nomeCasuale, inviaFileCaricato };
