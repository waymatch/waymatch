// Gamification facoltativa: il Mobility Manager la attiva o la spegne (Impostazioni generali →
// Gamification) e può azzerare i punteggi. Lo storico di punti e riscatti resta in ogni caso.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { asyncHandler } = require('../utils/asyncHandler');
const { gamificationAttiva } = require('../utils/gamification');
const { generazionePunti } = require('../utils/points');
const { notificaMassiva } = require('../utils/notify');
const { rigaSicura } = require('../utils/export');

const router = express.Router();
const soloMm = [requireAuth, requireRole('mobility_manager')];

function stato() {
  const riscatti = Object.fromEntries(
    db.prepare('SELECT stato, COUNT(*) AS n FROM reward_redemptions GROUP BY stato').all().map((r) => [r.stato, r.n]),
  );
  const gen = generazionePunti();
  // Chi ha un saldo diverso da zero dall'ultimo azzeramento: è chi perderebbe dei punti azzerando.
  const conPunti = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT user_id, SUM(punti) AS s FROM (
        SELECT user_id, punti FROM points_log WHERE generazione = ?
        UNION ALL SELECT user_id, punti FROM manual_point_awards WHERE generazione = ?
      ) GROUP BY user_id HAVING s != 0
    )
  `).get(gen, gen).n;
  const azzeratiIl = db.prepare('SELECT punti_azzerati_il FROM system_settings WHERE id = 1').get().punti_azzerati_il;
  return {
    attiva: gamificationAttiva(),
    // Riscatti ancora da gestire: restano da approvare o consegnare anche con la gamification spenta.
    riscatti_in_attesa: riscatti.in_attesa || 0,
    riscatti_approvati: riscatti.approvato || 0,
    riscatti_consegnati: riscatti.consegnato || 0,
    utenti_con_punti: conPunti,
    punti_azzerati_il: azzeratiIl || null,
  };
}

router.get('/', ...soloMm, (_req, res) => res.json(stato()));

router.put('/', ...soloMm, (req, res) => {
  const { attiva } = req.body || {};
  if (typeof attiva !== 'boolean') return res.status(400).json({ error: 'Indica se attivare (true) o spegnere (false) la gamification.' });
  db.prepare('UPDATE system_settings SET gamification_attiva = ? WHERE id = 1').run(attiva ? 1 : 0);
  registraAzione(req.user.id, attiva ? 'gamification_attivata' : 'gamification_disattivata', '');
  res.json(stato());
});

// Azzeramento dei punteggi: da adesso saldi, classifiche e contest ripartono da zero (lo storico
// resta). I premi già consegnati non cambiano; quelli chiesti e non ancora consegnati si tengono
// (l'azienda li consegnerà) oppure si annullano, a scelta del Mobility Manager.
router.post('/azzera', ...soloMm, asyncHandler(async (req, res) => {
  const { premi, conferma } = req.body || {};
  if (conferma !== true) return res.status(400).json({ error: 'Conferma l\'azzeramento: l\'operazione non si annulla.' });
  if (!['tieni', 'annulla'].includes(premi)) return res.status(400).json({ error: 'Indica cosa fare dei premi non ancora consegnati (tieni o annulla).' });
  const prima = stato();
  const annullati = db.transaction(() => {
    db.prepare(`
      UPDATE system_settings SET generazione_punti = generazione_punti + 1, punti_azzerati_il = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = 1
    `).run();
    let righe = [];
    if (premi === 'annulla') {
      righe = db.prepare(`
        SELECT rr.id, rr.user_id, r.nome FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
        WHERE rr.stato IN ('in_attesa', 'approvato')
      `).all();
      const annulla = db.prepare("UPDATE reward_redemptions SET stato = 'annullato' WHERE id = ?");
      for (const r of righe) annulla.run(r.id);
    }
    const daConsegnare = prima.riscatti_in_attesa + prima.riscatti_approvati;
    registraAzione(req.user.id, 'punteggi_azzerati',
      `${prima.utenti_con_punti} utenti con punti; premi non consegnati: ${premi === 'annulla' ? `${righe.length} annullati` : `${daConsegnare} tenuti`}`);
    return righe;
  })();
  // Prima la risposta (l'azzeramento è già confermato), poi un avviso per ogni premio annullato,
  // in parallelo: push ed email lenti non fanno aspettare il Mobility Manager.
  res.json({ ...stato(), annullati: annullati.length });
  await Promise.all(annullati.map((r) =>
    notificaMassiva([r.user_id], 'riscatto_annullato', `La richiesta per "${r.nome}" è stata annullata con l'azzeramento dei punteggi.`)));
}));

// Tutti i riscatti, per consegnare a mano i premi rimasti o tenerne traccia prima di un azzeramento.
const STATI = { in_attesa: 'In attesa', approvato: 'Approvato, da consegnare', consegnato: 'Consegnato', rifiutato: 'Rifiutato', annullato: 'Annullato' };
router.get('/riscatti.xlsx', ...soloMm, asyncHandler(async (req, res) => {
  const righe = db.prepare(`
    SELECT rr.created_at, rr.stato, rr.codice_voucher, u.nome, u.cognome, u.email, s.nome AS sede, r.nome AS premio, r.tipo,
      (SELECT -COALESCE(SUM(m.punti), 0) FROM manual_point_awards m WHERE m.redemption_id = rr.id AND m.punti < 0) AS punti
    FROM reward_redemptions rr
    JOIN rewards r ON r.id = rr.reward_id
    JOIN users u ON u.id = rr.user_id
    LEFT JOIN sedi s ON s.id = u.sede_id
    ORDER BY CASE rr.stato WHEN 'approvato' THEN 0 WHEN 'in_attesa' THEN 1 ELSE 2 END, rr.created_at
  `).all();
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WayMatch';
  const foglio = wb.addWorksheet('Riscatti');
  foglio.addRow(rigaSicura(['Richiesto il', 'Stato', 'Nome', 'Cognome', 'Email', 'Sede', 'Premio', 'Tipo', 'Punti', 'Codice voucher']));
  for (const r of righe) {
    foglio.addRow(rigaSicura([r.created_at, STATI[r.stato] || r.stato, r.nome, r.cognome, r.email, r.sede || '', r.premio,
      r.tipo === 'voucher_digitale' ? 'Voucher digitale' : 'Fisico', r.punti, r.codice_voucher || '']));
  }
  foglio.getRow(1).font = { bold: true };
  foglio.columns.forEach((c) => { c.width = 20; });
  registraAzione(req.user.id, 'riscatti_esportati', `${righe.length} riscatti`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="riscatti-premi.xlsx"');
  res.setHeader('Cache-Control', 'private, no-store');
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
