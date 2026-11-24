const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');

const router = express.Router();

// Coordinate facoltative; lo zero è un valore valido (meridiano di Greenwich, equatore).
function coordinate(lat, lon) {
  const vuoto = (v) => v === undefined || v === null || v === '';
  if (vuoto(lat) && vuoto(lon)) return { lat: null, lon: null };
  if (vuoto(lat) || vuoto(lon)) return null; // una sola coordinata non basta
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: la, lon: lo };
}

router.get('/', requireAuth, (req, res) => {
  const sedi = db.prepare('SELECT * FROM sedi ORDER BY nome').all();
  res.json({ sedi });
});

router.post('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, indirizzo } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome sede richiesto' });
  const c = coordinate(req.body.lat, req.body.lon);
  if (!c) return res.status(400).json({ error: 'Coordinate non valide' });
  const info = db.prepare('INSERT INTO sedi (nome, indirizzo, lat, lon) VALUES (?, ?, ?, ?)')
    .run(nome, indirizzo || null, c.lat, c.lon);
  registraAzione(req.user.id, 'sede_creata', nome);
  res.json({ sede: db.prepare('SELECT * FROM sedi WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, indirizzo } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome sede richiesto' });
  const c = coordinate(req.body.lat, req.body.lon);
  if (!c) return res.status(400).json({ error: 'Coordinate non valide' });
  const info = db.prepare('UPDATE sedi SET nome = ?, indirizzo = ?, lat = ?, lon = ? WHERE id = ?')
    .run(nome, indirizzo || null, c.lat, c.lon, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Sede non trovata' });
  registraAzione(req.user.id, 'sede_modificata', nome);
  res.json({ sede: db.prepare('SELECT * FROM sedi WHERE id = ?').get(req.params.id) });
});

router.delete('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const sede = db.prepare('SELECT nome FROM sedi WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM sedi WHERE id = ?').run(req.params.id);
  if (sede) registraAzione(req.user.id, 'sede_eliminata', sede.nome);
  res.json({ ok: true });
});

module.exports = router;
