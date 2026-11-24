const express = require('express');
const db = require('../db');
const { rigaSicura } = require('../utils/export');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const { limit, categoria, azione, user_id } = req.query;
  const n = Math.max(1, Math.min(500, Math.trunc(Number(limit)) || 100));
  let query = `
    SELECT a.*, u.nome, u.cognome FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE 1=1
  `;
  const params = [];
  if (categoria === 'gestione' || categoria === 'utente') {
    query += ' AND a.categoria = ?';
    params.push(categoria);
  }
  if (azione) {
    query += ' AND a.azione = ?';
    params.push(azione);
  }
  if (user_id) {
    query += ' AND a.user_id = ?';
    params.push(user_id);
  }
  query += ' ORDER BY a.created_at DESC LIMIT ?';
  params.push(n);
  const log = db.prepare(query).all(...params);
  res.json({ log });
});

// Elenco dei tipi di azione effettivamente presenti nel log, per popolare il filtro
router.get('/tipi-evento', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const tipi = db.prepare('SELECT DISTINCT azione FROM audit_log ORDER BY azione').all().map((r) => r.azione);
  res.json({ tipi });
});

// Export per conservazione dati fuori dall'app (compliance/HR), stessi filtri della
// consultazione a schermo ma senza il limite di 500 righe.
router.get('/export/xlsx', requireAuth, requireRole('mobility_manager'), asyncHandler(async (req, res) => {
  const { categoria, azione, user_id } = req.query;
  let query = `
    SELECT a.created_at, a.categoria, a.azione, a.dettagli, u.nome, u.cognome
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE 1=1
  `;
  const params = [];
  if (categoria === 'gestione' || categoria === 'utente') { query += ' AND a.categoria = ?'; params.push(categoria); }
  if (azione) { query += ' AND a.azione = ?'; params.push(azione); }
  if (user_id) { query += ' AND a.user_id = ?'; params.push(user_id); }
  query += ' ORDER BY a.created_at DESC';
  const log = db.prepare(query).all(...params);

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Carpooling Aziendale';
  const sheet = wb.addWorksheet('Log attività');
  sheet.addRow(rigaSicura(['Data e ora', 'Categoria', 'Azione', 'Utente', 'Dettagli']));
  sheet.getRow(1).font = { bold: true };
  for (const l of log) {
    sheet.addRow(rigaSicura([
      l.created_at,
      l.categoria === 'gestione' ? 'Mobility Manager' : 'Utente',
      l.azione,
      l.nome ? `${l.nome} ${l.cognome}` : 'Utente eliminato',
      l.dettagli || '',
    ]));
  }
  sheet.columns.forEach((c) => { c.width = 24; });
  sheet.getColumn(5).width = 50;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="log-attivita.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
