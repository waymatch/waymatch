const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const sedi = db.prepare('SELECT * FROM sedi ORDER BY nome').all();
  res.json({ sedi });
});

router.post('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, indirizzo, lat, lon } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome sede richiesto' });
  const info = db.prepare('INSERT INTO sedi (nome, indirizzo, lat, lon) VALUES (?, ?, ?, ?)')
    .run(nome, indirizzo || null, lat || null, lon || null);
  registraAzione(req.user.id, 'sede_creata', nome);
  res.json({ sede: db.prepare('SELECT * FROM sedi WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, indirizzo, lat, lon } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome sede richiesto' });
  db.prepare('UPDATE sedi SET nome = ?, indirizzo = ?, lat = ?, lon = ? WHERE id = ?')
    .run(nome, indirizzo || null, lat || null, lon || null, req.params.id);
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
