const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { totalePunti, totaleGuadagnato } = require('../utils/points');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  const eventi = db.prepare(`
    SELECT tipo_evento as tipo, punti, note, created_at FROM points_log WHERE user_id = ?
  `).all(req.user.id);
  const manuali = db.prepare(`
    SELECT CASE WHEN redemption_id IS NOT NULL THEN 'riscatto_premio' ELSE 'bonus_manuale' END as tipo,
           punti, motivo as note, created_at
    FROM manual_point_awards WHERE user_id = ?
  `).all(req.user.id);
  const log = [...eventi, ...manuali].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
  res.json({ punti: totalePunti(req.user.id), punti_guadagnati: totaleGuadagnato(req.user.id), log });
});

// Classifica basata sui punti GUADAGNATI (non scende quando si riscattano premi).
// periodo_giorni: 7 | 30 | 90 | 180 | 365 (facoltativo, altrimenti classifica "da sempre").
router.get('/classifica', requireAuth, (req, res) => {
  const { sede_id, periodo_giorni } = req.query;
  const filtroData = periodo_giorni ? `AND p.created_at >= datetime('now', '-${Number(periodo_giorni)} days')` : '';
  const filtroDataM = periodo_giorni ? `AND m.created_at >= datetime('now', '-${Number(periodo_giorni)} days')` : '';

  let query = `
    SELECT u.id, u.nome, u.cognome, u.sede_id, s.nome as sede_nome,
      COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id ${filtroData}), 0)
      +
      COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id AND m.redemption_id IS NULL ${filtroDataM}), 0)
      as punti
    FROM users u
    LEFT JOIN sedi s ON s.id = u.sede_id
    WHERE u.attivo = 1
  `;
  const params = [];
  if (sede_id) { query += ' AND u.sede_id = ?'; params.push(sede_id); }
  query += ' ORDER BY punti DESC LIMIT 100';

  const classifica = db.prepare(query).all(...params);
  res.json({ classifica });
});

module.exports = router;
