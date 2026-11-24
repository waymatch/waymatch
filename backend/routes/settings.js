const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');

const { normalizza, giorniLavorativi, NOMI } = require('../utils/calendario');

const router = express.Router();

router.get('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const s = db.prepare(`
    SELECT richiede_approvazione_completamento FROM system_settings WHERE id = 1
  `).get();
  res.json({ settings: { ...s, giorni_lavorativi: giorniLavorativi() } });
});

// Aggiornamento parziale: si cambia solo ciò che è presente nella richiesta.
router.put('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { richiede_approvazione_completamento, giorni_lavorativi } = req.body;

  if (giorni_lavorativi !== undefined) {
    const giorni = normalizza(giorni_lavorativi);
    if (!Array.isArray(giorni_lavorativi) || giorni.length === 0) {
      return res.status(400).json({ error: 'Indica almeno un giorno lavorativo.' });
    }
    db.prepare('UPDATE system_settings SET giorni_lavorativi = ? WHERE id = 1').run(giorni.join(','));
    registraAzione(req.user.id, 'impostazioni_modificate', `giorni lavorativi: ${giorni.map((g) => NOMI[g]).join(', ')}`);
  }
  if (richiede_approvazione_completamento !== undefined) {
    db.prepare('UPDATE system_settings SET richiede_approvazione_completamento = ? WHERE id = 1')
      .run(richiede_approvazione_completamento ? 1 : 0);
    registraAzione(req.user.id, 'impostazioni_modificate', `approvazione completamento: ${richiede_approvazione_completamento ? 'attiva' : 'disattivata'}`);
  }
  res.json({ ok: true });
});

module.exports = router;
