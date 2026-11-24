const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { statoSmtp, inviaEmailTest } = require('../utils/mailer');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Le credenziali SMTP restano nel file .env del server (non nel database): questa pagina
// serve solo a verificarne lo stato e a inviare un'email di prova, senza dover accedere
// al server per farlo.
router.get('/stato', requireAuth, requireRole('mobility_manager'), (req, res) => {
  res.json(statoSmtp());
});

router.post('/test', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  try {
    await inviaEmailTest(
      req.user.email, 'Carpooling — email di prova',
      'Se leggi questo messaggio, la configurazione SMTP funziona correttamente.'
    );
    res.json({ ok: true, inviata_a: req.user.email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

module.exports = router;
