const express = require('express');
const db = require('../db');
const { rigaSicura } = require('../utils/export');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
const RITENZIONE_MESI = Number(process.env.RITENZIONE_STORICO_MESI) || 24;

// Aree del log attività: gruppi di azioni per prefisso (i nomi delle azioni seguono questa
// convenzione). "\" fa da carattere di escape, così "_" vale per sé e non come jolly di LIKE.
const AREE = {
  utenti: ['utente\\_%', 'import\\_csv\\_%', 'password\\_%', 'account\\_bloccato', 'foto\\_profilo\\_%', 'esci\\_da\\_tutti\\_i\\_dispositivi'],
  passaggi: ['passaggio\\_%', 'turno\\_fisso\\_%', 'richiesta\\_passaggio', 'richiesta\\_confermata', 'richiesta\\_rifiutata', 'richiesta\\_annullata',
    'iscrizione\\_lista\\_attesa', 'check\\_in\\_%', 'completamento\\_%', 'viaggio\\_%', 'passeggero\\_%'],
  punti: ['punti\\_%', 'punteggi\\_%', 'regola\\_punteggio\\_%', 'gamification\\_%'],
  premi: ['premio\\_%', 'riscatto\\_%', 'riscatti\\_%', 'voucher\\_%', 'contest\\_%'],
  documenti: ['documento\\_%'],
  impostazioni: ['impostazioni\\_%', 'branding\\_%', 'logo\\_%', 'icona\\_app\\_%', 'sede\\_%', 'cluster\\_%'],
  privacy: ['richiesta\\_cancellazione\\_%', 'dati\\_personali\\_%'],
};
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Filtri comuni alla consultazione e all'export. Ogni filtro è facoltativo; i valori non validi si
// ignorano (non restringono la ricerca a sorpresa).
function filtri(q) {
  let where = 'WHERE 1=1';
  const params = [];
  if (q.categoria === 'gestione' || q.categoria === 'utente') { where += ' AND a.categoria = ?'; params.push(q.categoria); }
  if (q.azione) { where += ' AND a.azione = ?'; params.push(String(q.azione)); }
  if (q.user_id) { where += ' AND a.user_id = ?'; params.push(Number(q.user_id)); }
  if (q.sede_id) { where += ' AND u.sede_id = ?'; params.push(Number(q.sede_id)); }
  if (AREE[q.area]) {
    where += ` AND (${AREE[q.area].map(() => "a.azione LIKE ? ESCAPE '\\'").join(' OR ')})`;
    params.push(...AREE[q.area]);
  }
  // Date locali (come le vede chi consulta); created_at è in UTC.
  if (DATA.test(q.dal || '')) { where += " AND datetime(a.created_at, 'localtime') >= ?"; params.push(`${q.dal} 00:00:00`); }
  if (DATA.test(q.al || '')) { where += " AND datetime(a.created_at, 'localtime') <= ?"; params.push(`${q.al} 23:59:59`); }
  const testo = String(q.q || '').trim().slice(0, 100);
  if (testo) {
    // Ricerca libera su dettagli, azione e nome di chi ha agito; % e _ cercati come caratteri.
    const like = `%${testo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where += " AND (a.dettagli LIKE ? ESCAPE '\\' OR a.azione LIKE ? ESCAPE '\\' OR (u.nome || ' ' || u.cognome) LIKE ? ESCAPE '\\')";
    params.push(like, like, like);
  }
  return { where, params };
}

router.get('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const n = Math.max(1, Math.min(500, Math.trunc(Number(req.query.limit)) || 100));
  const { where, params } = filtri(req.query);
  const log = db.prepare(`
    SELECT a.*, u.nome, u.cognome, s.nome AS sede_nome FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN sedi s ON s.id = u.sede_id
    ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?
  `).all(...params, n);
  res.json({ log, ritenzione_mesi: RITENZIONE_MESI, aree: Object.keys(AREE) });
});

// Tipi di evento presenti (per il filtro).
router.get('/tipi-evento', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const tipi = db.prepare('SELECT DISTINCT azione FROM audit_log ORDER BY azione').all().map((r) => r.azione);
  res.json({ tipi });
});

// Export per conservazione dati fuori dall'app (compliance/HR), stessi filtri della
// consultazione a schermo ma senza il limite di 500 righe.
router.get('/export/xlsx', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const { where, params } = filtri(req.query);
  const log = db.prepare(`
    SELECT a.created_at, a.categoria, a.azione, a.dettagli, u.nome, u.cognome, s.nome AS sede_nome
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN sedi s ON s.id = u.sede_id
    ${where} ORDER BY a.created_at DESC, a.id DESC
  `).all(...params);

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WayMatch';
  const sheet = wb.addWorksheet('Log attività');
  sheet.addRow(rigaSicura(['Data e ora (UTC)', 'Categoria', 'Azione', 'Utente', 'Sede', 'Dettagli']));
  sheet.getRow(1).font = { bold: true };
  for (const l of log) {
    sheet.addRow(rigaSicura([
      l.created_at,
      l.categoria === 'gestione' ? 'Mobility Manager' : 'Utente',
      l.azione,
      l.nome ? `${l.nome} ${l.cognome}` : 'Utente eliminato',
      l.sede_nome || '',
      l.dettagli || '',
    ]));
  }
  sheet.columns.forEach((c) => { c.width = 24; });
  sheet.getColumn(6).width = 50;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="log-attivita.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
module.exports.AREE = AREE;
