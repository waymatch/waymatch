const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generazionePunti } = require('../utils/points');
const { richiediGamification } = require('../utils/gamification');
const { registraAzione } = require('../utils/audit');

const router = express.Router();

router.get('/', requireAuth, richiediGamification, (req, res) => {
  const contests = db.prepare(`
    SELECT c.*, s.nome as sede_nome FROM contests c LEFT JOIN sedi s ON s.id = c.sede_id
    WHERE c.attivo = 1 ORDER BY c.data_inizio DESC
  `).all();
  res.json({ contests });
});

router.post('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, descrizione, metrica, data_inizio, data_fine, sede_id } = req.body;
  if (!nome || !data_inizio || !data_fine) return res.status(400).json({ error: 'Dati mancanti' });
  // Date di calendario reali (non "2025-13-01" né "2025-02-30"); i giorni bisestili valgono.
  const dataReale = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
    const [a, m, g] = String(v).split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1, g));
    return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === g;
  };
  if (!dataReale(data_inizio) || !dataReale(data_fine)) return res.status(400).json({ error: 'Date non valide (formato AAAA-MM-GG)' });
  if (String(data_fine) < String(data_inizio)) return res.status(400).json({ error: 'La data di fine non può precedere quella di inizio' });
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
router.get('/:id/classifica', requireAuth, richiediGamification, (req, res) => {
  const contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(req.params.id);
  if (!contest) return res.status(404).json({ error: 'Contest non trovato' });

  // Gli estremi sono giorni interi: il contest comprende tutto l'ultimo giorno.
  const inizio = contest.data_inizio;
  const fineEsclusa = db.prepare("SELECT date(?, '+1 day') AS d").get(String(contest.data_fine).slice(0, 10)).d;

  let query;
  const params = [];
  if (contest.metrica === 'passaggi_offerti' || contest.metrica === 'passaggi_presi') {
    // Si contano i viaggi veri, non le righe di punti: con la regola a 0 punti un viaggio
    // non genera punti ma conta comunque per il contest.
    const conteggio = contest.metrica === 'passaggi_offerti'
      ? `(SELECT COUNT(*) FROM rides r WHERE r.driver_id = u.id AND r.stato != 'annullato' AND r.data >= ? AND r.data < ?)`
      : `(SELECT COUNT(*) FROM bookings b JOIN rides r ON r.id = b.ride_id
           WHERE b.passenger_id = u.id AND b.stato = 'completato' AND r.data >= ? AND r.data < ?)`;
    query = `SELECT u.id, u.nome, u.cognome, CASE WHEN u.foto_path IS NOT NULL THEN u.foto_versione END AS foto_versione, u.sede_id, ${conteggio} AS eventi, ${conteggio} AS punteggio FROM users u WHERE 1=1`;
    params.push(inizio, fineEsclusa, inizio, fineEsclusa);
  } else {
    // Metrica "punti": include anche i bonus manuali del Mobility Manager (non i riscatti premi)
    query = `
      SELECT u.id, u.nome, u.cognome, CASE WHEN u.foto_path IS NOT NULL THEN u.foto_versione END AS foto_versione, u.sede_id,
        COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id AND p.created_at >= ? AND p.created_at < ? AND p.generazione = ?), 0)
        +
        COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id AND m.redemption_id IS NULL AND m.created_at >= ? AND m.created_at < ? AND m.generazione = ?), 0)
        as punteggio,
        0 as eventi
      FROM users u
      WHERE 1=1
    `;
    // Un azzeramento dei punteggi durante il contest vale anche per la sua classifica.
    const gen = generazionePunti();
    params.push(inizio, fineEsclusa, gen, inizio, fineEsclusa, gen);
  }
  if (contest.sede_id) { query += ' AND u.sede_id = ?'; params.push(contest.sede_id); }
  query += ' ORDER BY punteggio DESC LIMIT 50';

  const classifica = db.prepare(query).all(...params);
  res.json({ contest, classifica });
});

module.exports = router;
