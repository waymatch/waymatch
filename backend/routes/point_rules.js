const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { richiediGamification } = require('../utils/gamification');
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
  const rule = db.prepare('SELECT * FROM point_rules WHERE chiave = ?').get(req.params.chiave);
  if (!rule) return res.status(404).json({ error: 'Regola non trovata' });
  // Valore e stato sono entrambi facoltativi: si aggiorna solo ciò che arriva.
  const nuovoAttivo = req.body.attivo === undefined ? rule.attivo : (req.body.attivo ? 1 : 0);
  if (!rule.modificabile && nuovoAttivo === 0) {
    return res.status(400).json({ error: 'Questa regola strutturale non può essere disattivata' });
  }
  let nuoviPunti = rule.punti;
  if (req.body.punti !== undefined) {
    nuoviPunti = Number(req.body.punti);
    if (!Number.isInteger(nuoviPunti) || nuoviPunti < 0 || nuoviPunti > 100000) {
      return res.status(400).json({ error: 'Valore punti non valido' });
    }
  }
  db.prepare('UPDATE point_rules SET punti = ?, attivo = ? WHERE chiave = ?').run(nuoviPunti, nuovoAttivo, req.params.chiave);
  registraAzione(req.user.id, 'regola_punteggio_modificata', `${rule.nome}: ${nuoviPunti} pt${nuovoAttivo ? '' : ' (disattivata)'}`);
  res.json({ rule: db.prepare('SELECT * FROM point_rules WHERE chiave = ?').get(req.params.chiave) });
});

// Assegnazione manuale di punti bonus (es. premio "collega del mese", riconoscimento contest, ecc.)
router.post('/manual-award', requireAuth, requireRole('mobility_manager'), richiediGamification, (req, res) => {
  const { user_id, motivo } = req.body;
  const punti = Math.round(Number(req.body.punti));
  if (!user_id || !Number.isFinite(punti) || punti === 0 || typeof motivo !== 'string' || !motivo.trim()) {
    return res.status(400).json({ error: 'Utente, punti e motivo sono obbligatori' });
  }
  const utente = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!utente) return res.status(404).json({ error: 'Utente non trovato' });

  // Accredito e registro insieme: se il registro fallisce, l'accredito si annulla e un nuovo
  // invio non raddoppia i punti.
  db.transaction(() => {
    db.prepare(`
      INSERT INTO manual_point_awards (user_id, assegnato_da, punti, motivo, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
    `).run(user_id, req.user.id, punti, motivo.trim());
    registraAzione(req.user.id, 'punti_manuali_assegnati', `${punti} pt a utente #${user_id}: ${motivo.trim()}`);
  })();
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
