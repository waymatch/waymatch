const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { CATEGORIE_INFO } = require('../utils/notify');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const righe = db.prepare(`
    SELECT categoria, inapp, push, email, minuti_anticipo FROM notification_preferences WHERE user_id = ?
  `).all(req.user.id);
  const mappa = Object.fromEntries(righe.map((r) => [r.categoria, { inapp: !!r.inapp, push: !!r.push, email: !!r.email, minuti_anticipo: r.minuti_anticipo }]));

  const categorie = CATEGORIE_INFO
    .filter((c) => !c.soloRuolo || c.soloRuolo === req.user.ruolo)
    .map((c) => ({
      ...c,
      inapp: mappa[c.chiave] ? mappa[c.chiave].inapp : true,
      push: mappa[c.chiave] ? mappa[c.chiave].push : true,
      email: mappa[c.chiave] ? mappa[c.chiave].email : true,
      minuti_anticipo: mappa[c.chiave]?.minuti_anticipo ?? 30,
    }));

  res.json({ categorie });
});

router.put('/:categoria', requireAuth, (req, res) => {
  if (!CATEGORIE_INFO.some((c) => c.chiave === req.params.categoria)) {
    return res.status(400).json({ error: 'Categoria non valida' });
  }
  const { push, email } = req.body;
  const inapp = req.body.inapp === undefined ? true : !!req.body.inapp;
  // Anticipo del promemoria: da 0 (alla partenza) a 120 minuti, la finestra dello scheduler.
  let minuti_anticipo = 30;
  if (req.body.minuti_anticipo !== undefined && req.body.minuti_anticipo !== null) {
    minuti_anticipo = Number(req.body.minuti_anticipo);
    if (!Number.isInteger(minuti_anticipo) || minuti_anticipo < 0 || minuti_anticipo > 120) {
      return res.status(400).json({ error: 'L\'anticipo del promemoria va da 0 a 120 minuti' });
    }
  }
  db.prepare(`
    INSERT INTO notification_preferences (user_id, categoria, inapp, push, email, minuti_anticipo) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, categoria) DO UPDATE SET inapp = excluded.inapp, push = excluded.push, email = excluded.email, minuti_anticipo = excluded.minuti_anticipo
  `).run(req.user.id, req.params.categoria, inapp ? 1 : 0, push ? 1 : 0, email ? 1 : 0, minuti_anticipo);
  res.json({ ok: true });
});

module.exports = router;
