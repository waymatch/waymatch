const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const preferiti = db.prepare(`
    SELECT f.driver_id, f.tipo, u.nome, u.cognome
    FROM favorite_rides f JOIN users u ON u.id = f.driver_id
    WHERE f.follower_id = ? ORDER BY u.cognome, u.nome
  `).all(req.user.id);
  res.json({ preferiti });
});

router.post('/', requireAuth, (req, res) => {
  const { driver_id, tipo } = req.body;
  if (!driver_id || !['andata', 'ritorno'].includes(tipo)) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  if (Number(driver_id) === req.user.id) {
    return res.status(400).json({ error: 'Non puoi seguire i tuoi stessi passaggi' });
  }
  try {
    db.prepare('INSERT INTO favorite_rides (follower_id, driver_id, tipo) VALUES (?, ?, ?)').run(req.user.id, driver_id, tipo);
  } catch (e) {
    if (!String(e.message).includes('UNIQUE')) throw e; // già seguito: nessun errore, idempotente
  }
  res.json({ ok: true });
});

router.delete('/:driverId/:tipo', requireAuth, (req, res) => {
  db.prepare('DELETE FROM favorite_rides WHERE follower_id = ? AND driver_id = ? AND tipo = ?')
    .run(req.user.id, req.params.driverId, req.params.tipo);
  res.json({ ok: true });
});

module.exports = router;
