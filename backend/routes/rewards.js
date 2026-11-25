const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const { percorsoSicuro } = require('../utils/safePath');
const { requireAuth, requireRole } = require('../middleware/auth');
const { richiediGamification } = require('../utils/gamification');
const { totalePunti, generazionePunti, GENERAZIONE_ATTUALE } = require('../utils/points');
const { notifica } = require('../utils/notify');
const { registraAzione } = require('../utils/audit');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

function generaCodiceVoucher() {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
}

// Punti di un premio: intero positivo. Un valore negativo trasformerebbe il riscatto in un accredito.
function puntiValidi(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1000000 ? n : null;
}

// Importo storico di un riscatto: quanto è stato davvero addebitato, non il prezzo attuale
// del premio (che il Mobility Manager può cambiare dopo).
const PUNTI_ADDEBITATI = `(SELECT -COALESCE(SUM(m.punti), 0) FROM manual_point_awards m WHERE m.redemption_id = rr.id AND m.punti < 0)`;

router.get('/', requireAuth, richiediGamification, (req, res) => {
  const rewards = db.prepare('SELECT * FROM rewards WHERE attivo = 1 ORDER BY punti_richiesti').all();
  res.json({ rewards, punti_disponibili: totalePunti(req.user.id) });
});

// Catalogo completo per la gestione MM: include anche i premi disattivati, per poterli
// modificare o riattivare (l'elenco pubblico sopra mostra solo quelli attivi).
router.get('/admin/tutti', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const rewards = db.prepare('SELECT * FROM rewards ORDER BY attivo DESC, punti_richiesti').all();
  res.json({ rewards });
});

router.post('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, descrizione, tipo, voucher_template_id } = req.body;
  const punti_richiesti = puntiValidi(req.body.punti_richiesti);
  if (!nome) return res.status(400).json({ error: 'Dati mancanti' });
  if (!punti_richiesti) return res.status(400).json({ error: 'I punti richiesti devono essere un numero intero positivo' });
  const tipoFinale = tipo === 'voucher_digitale' ? 'voucher_digitale' : 'fisico';
  const info = db.prepare(`
    INSERT INTO rewards (nome, descrizione, punti_richiesti, tipo, voucher_template_id) VALUES (?, ?, ?, ?, ?)
  `).run(nome, descrizione || null, punti_richiesti, tipoFinale, tipoFinale === 'voucher_digitale' ? (voucher_template_id || null) : null);
  registraAzione(req.user.id, 'premio_creato', `${nome} (${punti_richiesti} pt)`);
  res.json({ reward: db.prepare('SELECT * FROM rewards WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { nome, descrizione, attivo, tipo, voucher_template_id } = req.body;
  const punti_richiesti = puntiValidi(req.body.punti_richiesti);
  if (!nome) return res.status(400).json({ error: 'Dati mancanti' });
  if (!punti_richiesti) return res.status(400).json({ error: 'I punti richiesti devono essere un numero intero positivo' });
  const tipoFinale = tipo === 'voucher_digitale' ? 'voucher_digitale' : 'fisico';
  db.prepare(`
    UPDATE rewards SET nome = ?, descrizione = ?, punti_richiesti = ?, attivo = ?, tipo = ?, voucher_template_id = ? WHERE id = ?
  `).run(nome, descrizione || null, punti_richiesti, attivo ? 1 : 0, tipoFinale, tipoFinale === 'voucher_digitale' ? (voucher_template_id || null) : null, req.params.id);
  registraAzione(req.user.id, 'premio_modificato', nome);
  res.json({ reward: db.prepare('SELECT * FROM rewards WHERE id = ?').get(req.params.id) });
});

router.delete('/:id', requireAuth, requireRole('mobility_manager'), (req, res) => {
  db.prepare('UPDATE rewards SET attivo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Richiesta riscatto: i punti vengono decurtati subito. Se la richiesta verrà
// rifiutata, saranno riaccreditati automaticamente (vedi PUT /redemptions/:id).
router.post('/:id/redeem', requireAuth, richiediGamification, (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id = ? AND attivo = 1').get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Premio non trovato' });
  const punti = totalePunti(req.user.id);
  if (punti < reward.punti_richiesti) return res.status(400).json({ error: 'Punti insufficienti' });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO reward_redemptions (user_id, reward_id, stato, created_at) VALUES (?, ?, 'in_attesa', strftime('%Y-%m-%d %H:%M:%f', 'now'))
    `).run(req.user.id, reward.id);
    db.prepare(`
      INSERT INTO manual_point_awards (user_id, assegnato_da, punti, motivo, redemption_id, created_at, generazione)
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ${GENERAZIONE_ATTUALE})
    `).run(req.user.id, req.user.id, -reward.punti_richiesti, `Riscatto premio: ${reward.nome}`, info.lastInsertRowid);
    return info.lastInsertRowid;
  });
  const redemptionId = tx();
  registraAzione(req.user.id, 'riscatto_richiesto', `${reward.nome} (${reward.punti_richiesti} pt)`, 'utente');
  res.json({ redemption_id: redemptionId });
});

// Storico dei riscatti dell'utente corrente (per la sezione Premi)
router.get('/redemptions/mie', requireAuth, (req, res) => {
  const redemptions = db.prepare(`
    SELECT rr.*, r.nome as reward_nome, ${PUNTI_ADDEBITATI} as punti_richiesti
    FROM reward_redemptions rr
    JOIN rewards r ON r.id = rr.reward_id
    WHERE rr.user_id = ?
    ORDER BY rr.created_at DESC
  `).all(req.user.id);
  res.json({ redemptions });
});

router.get('/redemptions/list', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const redemptions = db.prepare(`
    SELECT rr.*, u.nome, u.cognome, r.nome as reward_nome, ${PUNTI_ADDEBITATI} as punti_richiesti
    FROM reward_redemptions rr
    JOIN users u ON u.id = rr.user_id
    JOIN rewards r ON r.id = rr.reward_id
    ORDER BY rr.created_at DESC
  `).all();
  res.json({ redemptions });
});

const STATI_REDEMPTION_VALIDI = ['approvato', 'rifiutato', 'consegnato'];
// Passaggi di stato ammessi: rifiutato e consegnato sono definitivi, così un riscatto non
// può essere rimborsato due volte (rifiutato → approvato → rifiutato).
const TRANSIZIONI = {
  in_attesa: ['approvato', 'rifiutato', 'consegnato'],
  approvato: ['consegnato', 'rifiutato'],
  consegnato: [],
  rifiutato: [],
  annullato: [], // annullato con l'azzeramento dei punteggi (routes/gamification.js)
};

router.put('/redemptions/:id', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const { stato } = req.body; // approvato | rifiutato | consegnato
  if (!STATI_REDEMPTION_VALIDI.includes(stato)) return res.status(400).json({ error: 'Stato non valido' });
  const redemption = db.prepare(`
    SELECT rr.*, r.nome as reward_nome, r.punti_richiesti, r.tipo as reward_tipo,
           u.nome as utente_nome, u.cognome as utente_cognome
    FROM reward_redemptions rr
    JOIN rewards r ON r.id = rr.reward_id
    JOIN users u ON u.id = rr.user_id
    WHERE rr.id = ?
  `).get(req.params.id);
  if (!redemption) return res.status(404).json({ error: 'Non trovata' });

  const statoPrecedente = redemption.stato;
  if (stato === statoPrecedente) return res.json({ ok: true, codice_voucher: redemption.codice_voucher });
  if (!(TRANSIZIONI[statoPrecedente] || []).includes(stato)) {
    return res.status(400).json({ error: `Un riscatto ${statoPrecedente.replace('_', ' ')} non può diventare ${stato}` });
  }
  let codiceVoucher = redemption.codice_voucher;
  // Anche la consegna diretta (senza passare da "approvato") genera il codice del voucher.
  if (['approvato', 'consegnato'].includes(stato) && redemption.reward_tipo === 'voucher_digitale' && !codiceVoucher) {
    codiceVoucher = generaCodiceVoucher();
  }
  // Stato, rimborso e registro in un'unica transazione: un errore a metà non lascia un
  // riscatto rifiutato senza rimborso. Le notifiche partono dopo.
  let dopoAzzeramento = true;
  db.transaction(() => {
    db.prepare('UPDATE reward_redemptions SET stato = ?, codice_voucher = COALESCE(?, codice_voucher) WHERE id = ?')
      .run(stato, codiceVoucher, redemption.id);
    if (stato === 'rifiutato') {
      // Si rimborsa quanto addebitato davvero, non il prezzo attuale del premio. Un riscatto chiesto
      // prima di un azzeramento dei punteggi non si rimborsa: quei punti non esistono più.
      const addebito = db.prepare(`
        SELECT -COALESCE(SUM(punti), 0) AS n, MAX(generazione) AS gen FROM manual_point_awards WHERE redemption_id = ? AND punti < 0
      `).get(redemption.id);
      const addebitati = addebito.n;
      // Addebitato in una generazione precedente: c'è stato un azzeramento in mezzo.
      dopoAzzeramento = addebito.gen === null || addebito.gen === generazionePunti();
      if (addebitati > 0 && dopoAzzeramento) {
        db.prepare(`
          INSERT INTO manual_point_awards (user_id, assegnato_da, punti, motivo, redemption_id, created_at, generazione)
          VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ${GENERAZIONE_ATTUALE})
        `).run(redemption.user_id, req.user.id, addebitati, `Rimborso riscatto rifiutato: ${redemption.reward_nome}`, redemption.id);
      }
    }
    registraAzione(req.user.id, `riscatto_${stato}_mm`, `${redemption.utente_nome} ${redemption.utente_cognome} — ${redemption.reward_nome}`);
  })();

  if (stato === 'rifiutato') {
    await notifica(redemption.user_id, 'riscatto_rifiutato', dopoAzzeramento
      ? `La richiesta per "${redemption.reward_nome}" è stata rifiutata: punti riaccreditati.`
      : `La richiesta per "${redemption.reward_nome}" è stata rifiutata. I punti non tornano perché nel frattempo i punteggi sono stati azzerati.`);
  }
  if (stato === 'approvato') {
    await notifica(redemption.user_id, 'riscatto_approvato', `La tua richiesta per "${redemption.reward_nome}" è stata approvata!`);
  }
  if (stato === 'consegnato') {
    await notifica(redemption.user_id, 'riscatto_consegnato', `Il premio "${redemption.reward_nome}" è pronto/consegnato.`);
  }

  res.json({ ok: true, codice_voucher: codiceVoucher });
}));

// Genera al volo l'immagine del voucher: template grafico + codice sovrapposto.
// Accessibile solo al proprietario del riscatto o a un Mobility Manager.
router.get('/redemptions/:id/voucher-image', requireAuth, asyncHandler(async (req, res) => {
  const redemption = db.prepare(`
    SELECT rr.*, r.voucher_template_id, r.nome as reward_nome FROM reward_redemptions rr
    JOIN rewards r ON r.id = rr.reward_id WHERE rr.id = ?
  `).get(req.params.id);
  if (!redemption) return res.status(404).json({ error: 'Non trovato' });
  if (redemption.user_id !== req.user.id && req.user.ruolo !== 'mobility_manager') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }
  if (!redemption.codice_voucher) return res.status(400).json({ error: 'Voucher non ancora generato' });

  const template = db.prepare('SELECT * FROM voucher_templates WHERE id = ?').get(redemption.voucher_template_id);
  if (!template) return res.status(404).json({ error: 'Template grafico non trovato' });

  try {
    const { Jimp, loadFont, measureText } = require('jimp');
    const fontPath = path.join(
      require.resolve('@jimp/plugin-print/package.json'),
      '..', 'dist', 'fonts', 'open-sans', 'open-sans-32-black', 'open-sans-32-black.fnt'
    );
    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
    const imgPath = percorsoSicuro(UPLOAD_DIR, template.immagine_path.replace('/uploads/', ''));
    const image = await Jimp.read(imgPath);
    const font = await loadFont(fontPath);
    const testo = redemption.codice_voucher;
    const larghezzaTesto = measureText(font, testo);
    // Una fascia bianca semi-opaca dietro al testo garantisce leggibilità del codice
    // qualunque sia il colore/contenuto del template caricato dal MM (senza, il testo nero
    // diventava illeggibile su sfondi scuri o "rumorosi").
    const bandHeight = 56;
    const band = new Jimp({ width: image.bitmap.width, height: bandHeight, color: 0xffffffe6 });
    image.composite(band, 0, image.bitmap.height - bandHeight);
    const x = Math.max(10, (image.bitmap.width - larghezzaTesto) / 2);
    const y = image.bitmap.height - bandHeight + (bandHeight - 32) / 2;
    image.print({ font, x, y, text: testo });
    const buffer = await image.getBuffer('image/png');
    // Contiene il codice personale del voucher: niente cache.
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
    res.send(buffer);
  } catch (e) {
    console.error('Errore generazione immagine voucher:', e.message);
    res.status(500).json({ error: 'Impossibile generare l\'immagine del voucher' });
  }
}));

module.exports = router;
