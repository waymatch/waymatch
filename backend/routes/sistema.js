// Stato dell'installazione per il mobility manager (pagina Informazioni → Sistema).
// Solo informazioni di servizio: nessun segreto, nessuna chiave, nessun hostname. Dell'indirizzo
// dei tile si mostra l'host, perché l'URL completo può contenere la chiave del provider.
const express = require('express');
const os = require('os');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { smtpAttivo } = require('../utils/mailer');
const { giorniLavorativi, NOMI } = require('../utils/calendario');
const { leggi: leggiTiles } = require('../utils/tiles');
const { version } = require('../package.json');
const aggiornamenti = require('../utils/aggiornamenti');

const router = express.Router();
const RITENZIONE_MESI = Number(process.env.RITENZIONE_STORICO_MESI) || 24;

router.get('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const s = db.prepare('SELECT vapid_public_key, richiede_approvazione_completamento FROM system_settings WHERE id = 1').get();
  const conta = (sql) => db.prepare(sql).get().n;
  const tile = leggiTiles();
  res.json({
    versione: version,
    aggiornamenti: aggiornamenti.stato(),
    ambiente: { node: process.version, sistema: `${os.type()} ${os.arch()}`, attivo_da_secondi: Math.floor(process.uptime()) },
    database: { cifrato: true },
    integrazioni: {
      email: smtpAttivo(),
      notifiche_push: !!s.vapid_public_key,
    },
    mappa: { provider: new URL(tile.origine).host, personalizzato: !!process.env.TILE_URL },
    calendario: { giorni_lavorativi: giorniLavorativi().map((g) => NOMI[g]) },
    validazione_viaggi: !!s.richiede_approvazione_completamento,
    ritenzione_storico_mesi: RITENZIONE_MESI,
    numeri: {
      utenti_attivi: conta('SELECT COUNT(*) AS n FROM users WHERE attivo = 1'),
      mobility_manager_attivi: conta("SELECT COUNT(*) AS n FROM users WHERE attivo = 1 AND ruolo = 'mobility_manager'"),
      sedi: conta('SELECT COUNT(*) AS n FROM sedi'),
    },
  });
});

module.exports = router;
