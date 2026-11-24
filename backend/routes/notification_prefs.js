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

// Aggiornamento parziale: si cambiano solo i campi presenti nella richiesta (inapp, push, email,
// minuti_anticipo) e gli altri restano come sono. Due modifiche ravvicinate della stessa categoria
// non si sovrascrivono a vicenda.
router.put('/:categoria', requireAuth, (req, res) => {
  if (!CATEGORIE_INFO.some((c) => c.chiave === req.params.categoria)) {
    return res.status(400).json({ error: 'Categoria non valida' });
  }
  const b = req.body || {};
  const interruttori = ['inapp', 'push', 'email'];
  for (const k of interruttori) {
    if (b[k] !== undefined && typeof b[k] !== 'boolean') {
      return res.status(400).json({ error: `Valore non valido per "${k}"` });
    }
  }
  // Anticipo del promemoria: da 0 (alla partenza) a 120 minuti, la finestra dello scheduler.
  if (b.minuti_anticipo !== undefined && b.minuti_anticipo !== null) {
    const m = Number(b.minuti_anticipo);
    if (!Number.isInteger(m) || m < 0 || m > 120) {
      return res.status(400).json({ error: 'L\'anticipo del promemoria va da 0 a 120 minuti' });
    }
  }
  // Lettura, unione e scrittura nella stessa transazione sincrona.
  db.transaction(() => {
    const att = db.prepare(`
      SELECT inapp, push, email, minuti_anticipo FROM notification_preferences WHERE user_id = ? AND categoria = ?
    `).get(req.user.id, req.params.categoria) || { inapp: 1, push: 1, email: 1, minuti_anticipo: 30 };
    const val = (k) => (b[k] === undefined ? att[k] : (b[k] ? 1 : 0));
    const anticipo = b.minuti_anticipo === undefined || b.minuti_anticipo === null ? att.minuti_anticipo : Number(b.minuti_anticipo);
    db.prepare(`
      INSERT INTO notification_preferences (user_id, categoria, inapp, push, email, minuti_anticipo) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, categoria) DO UPDATE SET inapp = excluded.inapp, push = excluded.push, email = excluded.email, minuti_anticipo = excluded.minuti_anticipo
    `).run(req.user.id, req.params.categoria, val('inapp'), val('push'), val('email'), anticipo);
  })();
  res.json({ ok: true });
});

module.exports = router;
