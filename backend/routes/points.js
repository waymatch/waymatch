const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { richiediGamification } = require('../utils/gamification');
const { totalePunti, totaleGuadagnato, generazionePunti } = require('../utils/points');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  const eventi = db.prepare(`
    SELECT tipo_evento as tipo, punti, note, created_at FROM points_log WHERE user_id = ? AND generazione = ?
  `).all(req.user.id, generazionePunti());
  const manuali = db.prepare(`
    SELECT CASE WHEN redemption_id IS NOT NULL THEN 'riscatto_premio' ELSE 'bonus_manuale' END as tipo,
           punti, motivo as note, created_at
    FROM manual_point_awards WHERE user_id = ? AND generazione = ?
  `).all(req.user.id, generazionePunti());
  const log = [...eventi, ...manuali].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
  res.json({ punti: totalePunti(req.user.id), punti_guadagnati: totaleGuadagnato(req.user.id), log });
});

// Classifica basata sui punti GUADAGNATI (non scende quando si riscattano premi).
// periodo_giorni: 7 | 30 | 90 | 180 | 365 (facoltativo, altrimenti classifica "da sempre").
router.get('/classifica', requireAuth, richiediGamification, (req, res) => {
  const { sede_id, periodo_giorni } = req.query;
  const filtroData = periodo_giorni ? `AND p.created_at >= datetime('now', '-${Number(periodo_giorni)} days')` : '';
  const filtroDataM = periodo_giorni ? `AND m.created_at >= datetime('now', '-${Number(periodo_giorni)} days')` : '';

  let query = `
    SELECT u.id, u.nome, u.cognome, CASE WHEN u.foto_path IS NOT NULL THEN u.foto_versione END AS foto_versione, u.sede_id, s.nome as sede_nome,
      COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id AND p.generazione = ? ${filtroData}), 0)
      +
      COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id AND m.redemption_id IS NULL AND m.generazione = ? ${filtroDataM}), 0)
      as punti
    FROM users u
    LEFT JOIN sedi s ON s.id = u.sede_id
    WHERE u.attivo = 1
  `;
  const gen = generazionePunti();
  const params = [gen, gen];
  if (sede_id) { query += ' AND u.sede_id = ?'; params.push(sede_id); }
  query += ' ORDER BY punti DESC LIMIT 100';

  const classifica = db.prepare(query).all(...params);
  res.json({ classifica });
});

module.exports = router;
