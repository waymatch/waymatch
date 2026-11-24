const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/public-key', requireAuth, (req, res) => {
  const s = db.prepare('SELECT vapid_public_key FROM system_settings WHERE id = 1').get();
  res.json({ publicKey: s.vapid_public_key });
});

router.post('/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Sottoscrizione non valida' });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(req.user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

router.get('/status', requireAuth, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) as n FROM push_subscriptions WHERE user_id = ?').get(req.user.id).n;
  res.json({ attivo: n > 0 });
});

module.exports = router;
