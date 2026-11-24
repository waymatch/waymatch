const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const contests = db.prepare(`
    SELECT c.*, s.nome as sede_nome FROM contests c LEFT JOIN sedi s ON s.id = c.sede_id
    WHERE c.attivo = 1 ORDER BY c.data_inizio DESC
  `).all();
  res.json({ contests });
});

router.post('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, descrizione, metrica, data_inizio, data_fine, sede_id } = req.body;
  if (!nome || !data_inizio || !data_fine) return res.status(400).json({ error: 'Dati mancanti' });
  const info = db.prepare(`
    INSERT INTO contests (nome, descrizione, metrica, data_inizio, data_fine, sede_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nome, descrizione || null, metrica || 'punti', data_inizio, data_fine, sede_id || null);
  registraAzione(req.user.id, 'contest_creato', nome);
  res.json({ contest: db.prepare('SELECT * FROM contests WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  db.prepare('UPDATE contests SET attivo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Classifica di un contest specifico, in base alla metrica scelta
router.get('/:id/classifica', requireAuth, (req, res) => {
  const contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(req.params.id);
  if (!contest) return res.status(404).json({ error: 'Contest non trovato' });

  let eventoFiltro = null;
  if (contest.metrica === 'passaggi_offerti') eventoFiltro = 'offerta_creata';
  if (contest.metrica === 'passaggi_presi') eventoFiltro = 'viaggio_completato_passeggero';

  let query;
  const params = [];
  if (eventoFiltro) {
    query = `
      SELECT u.id, u.nome, u.cognome, u.sede_id, COALESCE(SUM(p.punti),0) as punteggio, COUNT(p.id) as eventi
      FROM users u
      LEFT JOIN points_log p ON p.user_id = u.id AND p.created_at BETWEEN ? AND ? AND p.tipo_evento = ?
      WHERE 1=1
    `;
    params.push(contest.data_inizio, contest.data_fine, eventoFiltro);
  } else {
    // Metrica "punti": include anche i bonus manuali del mobility manager (non i riscatti premi)
    query = `
      SELECT u.id, u.nome, u.cognome, u.sede_id,
        COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id AND p.created_at BETWEEN ? AND ?), 0)
        +
        COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id AND m.redemption_id IS NULL AND m.created_at BETWEEN ? AND ?), 0)
        as punteggio,
        0 as eventi
      FROM users u
      WHERE 1=1
    `;
    params.push(contest.data_inizio, contest.data_fine, contest.data_inizio, contest.data_fine);
  }
  if (contest.sede_id) { query += ' AND u.sede_id = ?'; params.push(contest.sede_id); }
  query += eventoFiltro
    ? ' GROUP BY u.id ORDER BY eventi DESC LIMIT 50'
    : ' ORDER BY punteggio DESC LIMIT 50';

  const classifica = db.prepare(query).all(...params);
  res.json({ contest, classifica });
});

module.exports = router;
