const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');

const router = express.Router();

router.get('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const rules = db.prepare('SELECT * FROM point_rules ORDER BY id').all();
  res.json({ rules });
});

// Aggiorna valore punti e/o stato attivo di una regola esistente.
// Le chiavi disponibili sono fisse (corrispondono agli eventi gestiti dal sistema):
// offerta_creata, viaggio_completato_autista, viaggio_completato_passeggero,
// punto_per_km, km_cap_bonus.
router.put('/:chiave', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { punti, attivo } = req.body;
  const rule = db.prepare('SELECT * FROM point_rules WHERE chiave = ?').get(req.params.chiave);
  if (!rule) return res.status(404).json({ error: 'Regola non trovata' });
  if (!rule.modificabile && attivo === 0) {
    return res.status(400).json({ error: 'Questa regola strutturale non può essere disattivata' });
  }
  if (punti === undefined || Number(punti) < 0) {
    return res.status(400).json({ error: 'Valore punti non valido' });
  }
  db.prepare('UPDATE point_rules SET punti = ?, attivo = ? WHERE chiave = ?')
    .run(Number(punti), attivo === undefined ? rule.attivo : (attivo ? 1 : 0), req.params.chiave);
  registraAzione(req.user.id, 'regola_punteggio_modificata', `${rule.nome}: ${punti} pt`);
  res.json({ rule: db.prepare('SELECT * FROM point_rules WHERE chiave = ?').get(req.params.chiave) });
});

// Assegnazione manuale di punti bonus (es. premio "collega del mese", riconoscimento contest, ecc.)
router.post('/manual-award', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { user_id, punti, motivo } = req.body;
  if (!user_id || !punti || !motivo) {
    return res.status(400).json({ error: 'Utente, punti e motivo sono obbligatori' });
  }
  const utente = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!utente) return res.status(404).json({ error: 'Utente non trovato' });

  db.prepare(`
    INSERT INTO manual_point_awards (user_id, assegnato_da, punti, motivo) VALUES (?, ?, ?, ?)
  `).run(user_id, req.user.id, Math.round(Number(punti)), motivo);
  registraAzione(req.user.id, 'punti_manuali_assegnati', `${punti} pt a utente #${user_id}: ${motivo}`);
  res.json({ ok: true });
});

router.get('/manual-award/storico', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const storico = db.prepare(`
    SELECT m.*, u.nome, u.cognome, a.nome as assegnato_da_nome, a.cognome as assegnato_da_cognome
    FROM manual_point_awards m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN users a ON a.id = m.assegnato_da
    ORDER BY m.created_at DESC LIMIT 100
  `).all();
  res.json({ storico });
});

module.exports = router;
