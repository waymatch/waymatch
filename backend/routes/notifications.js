const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const notifiche = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  const nonLette = db.prepare(`
    SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND letta = 0
  `).get(req.user.id).n;
  res.json({ notifiche, non_lette: nonLette });
});

router.put('/:id/letta', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET letta = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.put('/leggi-tutte', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET letta = 1 WHERE user_id = ? AND letta = 0').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
