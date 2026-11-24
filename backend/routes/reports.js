const express = require('express');
const db = require('../db');
const { rigaSicura } = require('../utils/export');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registraAzione } = require('../utils/audit');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  co2GramsForTrip, kmRisparmiati, costoRisparmiato, costoKmPerAlimentazione,
  getAllClusters, setClusterOverride, resetClusterOverride,
} = require('../utils/co2');

const router = express.Router();

// Calcola, per ogni viaggio completato, km/CO2/costo risparmiati grazie ai passeggeri trasportati.
// Costo e CO2 per km dipendono dal cluster di alimentazione dell'auto dell'autista (vedi
// utils/co2.js): un'utilitaria elettrica e un SUV diesel non "risparmiano" la stessa cosa.
function computeSavings(where = '', params = []) {
  const rides = db.prepare(`
    SELECT r.id, r.km_stimati, r.data, r.sede_id, s.nome as sede_nome,
           u.auto_alimentazione,
           (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.stato = 'completato') as passeggeri
    FROM rides r
    JOIN users u ON u.id = r.driver_id
    LEFT JOIN sedi s ON s.id = r.sede_id
    WHERE r.stato = 'completato' ${where}
  `).all(...params);

  let totKm = 0, totCo2g = 0, totCosto = 0, totPassaggi = rides.length, totPasseggeriTrasportati = 0;
  const perSede = {};
  const perMese = {};

  for (const r of rides) {
    if (r.passeggeri <= 0) continue;
    const km = kmRisparmiati(r.km_stimati, r.passeggeri);
    const co2g = co2GramsForTrip(km, r.auto_alimentazione);
    const costo = costoRisparmiato(km, costoKmPerAlimentazione(r.auto_alimentazione));

    totKm += km;
    totCo2g += co2g;
    totCosto += costo;
    totPasseggeriTrasportati += r.passeggeri;

    const sedeKey = r.sede_nome || 'Senza sede';
    perSede[sedeKey] ||= { km: 0, co2_kg: 0, costo: 0, passaggi: 0 };
    perSede[sedeKey].km += km;
    perSede[sedeKey].co2_kg += co2g / 1000;
    perSede[sedeKey].costo += costo;
    perSede[sedeKey].passaggi += 1;

    const mese = r.data.slice(0, 7); // YYYY-MM
    perMese[mese] ||= { km: 0, co2_kg: 0, costo: 0, passaggi: 0 };
    perMese[mese].km += km;
    perMese[mese].co2_kg += co2g / 1000;
    perMese[mese].costo += costo;
    perMese[mese].passaggi += 1;
  }

  return {
    totali: {
      km_risparmiati: Math.round(totKm),
      co2_kg_risparmiata: Math.round(totCo2g / 1000 * 10) / 10,
      costo_risparmiato_eur: Math.round(totCosto * 100) / 100,
      viaggi_completati: totPassaggi,
      passeggeri_trasportati_totali: totPasseggeriTrasportati,
    },
    per_sede: perSede,
    per_mese: perMese,
  };
}

router.get('/summary', requireAuth, requireRole('mobility_manager', 'supervisor'), (req, res) => {
  const { sede_id, dal, al } = req.query;
  let where = '';
  const params = [];
  if (sede_id) { where += ' AND r.sede_id = ?'; params.push(sede_id); }
  if (dal) { where += ' AND r.data >= ?'; params.push(dal); }
  if (al) { where += ' AND r.data <= ?'; params.push(al); }

  const report = computeSavings(where, params);

  // Statistiche aggiuntive: utenti più attivi (punti da eventi + bonus manuali, non solo
  // riscatti, coerente con la classifica di /api/points/classifica e la lista utenti).
  const topUtenti = db.prepare(`
    SELECT u.id, u.nome, u.cognome, u.sede_id,
      COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id), 0)
      + COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id AND m.redemption_id IS NULL), 0)
      as punti
    FROM users u
    ORDER BY punti DESC LIMIT 10
  `).all();

  res.json({ ...report, top_utenti: topUtenti });
});

// Cluster costo/km e CO2/km per tipo di alimentazione: valori predefiniti (stime di
// settore) personalizzabili dal Mobility Manager, con possibilità di tornare al default.
router.get('/cost-co2-clusters', requireAuth, requireRole('mobility_manager'), (req, res) => {
  res.json({ clusters: getAllClusters() });
});

router.put('/cost-co2-clusters/:alimentazione', requireAuth, requireRole('mobility_manager'), (req, res) => {
  const costo = Number(req.body.costo_km_eur);
  const co2 = Number(req.body.co2_g_km);
  if (!Number.isFinite(costo) || costo < 0 || !Number.isFinite(co2) || co2 < 0) {
    return res.status(400).json({ error: 'Valori non validi' });
  }
  setClusterOverride(req.params.alimentazione, { costo_km_eur: costo, co2_g_km: co2 });
  registraAzione(req.user.id, 'cluster_costo_co2_modificato', `${req.params.alimentazione}: €${costo}/km, ${co2} g/km`);
  res.json({ clusters: getAllClusters() });
});

router.delete('/cost-co2-clusters/:alimentazione', requireAuth, requireRole('mobility_manager'), (req, res) => {
  resetClusterOverride(req.params.alimentazione);
  registraAzione(req.user.id, 'cluster_costo_co2_ripristinato', req.params.alimentazione);
  res.json({ clusters: getAllClusters() });
});

function filtriDaQuery(query) {
  const { sede_id, dal, al } = query;
  let where = '';
  const params = [];
  if (sede_id) { where += ' AND r.sede_id = ?'; params.push(sede_id); }
  if (dal) { where += ' AND r.data >= ?'; params.push(dal); }
  if (al) { where += ' AND r.data <= ?'; params.push(al); }
  return { where, params };
}

router.get('/export/xlsx', requireAuth, requireRole('mobility_manager', 'supervisor'), asyncHandler(async (req, res) => {
  const { where, params } = filtriDaQuery(req.query);
  const report = computeSavings(where, params);
  const settings = db.prepare('SELECT company_name FROM system_settings WHERE id = 1').get();

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Carpooling Aziendale';

  const riepilogo = wb.addWorksheet('Riepilogo');
  riepilogo.addRow(rigaSicura([`Report carpooling — ${settings.company_name}`]));
  riepilogo.addRow(rigaSicura([`Generato il ${new Date().toLocaleString('it-IT')}`]));
  riepilogo.addRow(rigaSicura([]));
  riepilogo.addRow(rigaSicura(['Indicatore', 'Valore']));
  riepilogo.addRow(rigaSicura(['Km risparmiati', report.totali.km_risparmiati]));
  riepilogo.addRow(rigaSicura(['CO2 risparmiata (kg)', report.totali.co2_kg_risparmiata]));
  riepilogo.addRow(rigaSicura(['Costo risparmiato (€)', report.totali.costo_risparmiato_eur]));
  riepilogo.addRow(rigaSicura(['Viaggi completati', report.totali.viaggi_completati]));
  riepilogo.addRow(rigaSicura(['Passeggeri trasportati (totale)', report.totali.passeggeri_trasportati_totali]));
  riepilogo.getColumn(1).width = 32;
  riepilogo.getColumn(2).width = 18;

  const sedi = wb.addWorksheet('Per sede');
  sedi.addRow(rigaSicura(['Sede', 'Km risparmiati', 'CO2 (kg)', 'Costo (€)', 'Viaggi']));
  for (const [nome, v] of Object.entries(report.per_sede)) {
    sedi.addRow(rigaSicura([nome, Math.round(v.km), Math.round(v.co2_kg * 10) / 10, Math.round(v.costo * 100) / 100, v.passaggi]));
  }
  sedi.columns.forEach((c) => { c.width = 18; });

  const mesi = wb.addWorksheet('Per mese');
  mesi.addRow(rigaSicura(['Mese', 'Km risparmiati', 'CO2 (kg)', 'Costo (€)', 'Viaggi']));
  for (const [mese, v] of Object.entries(report.per_mese).sort()) {
    mesi.addRow(rigaSicura([mese, Math.round(v.km), Math.round(v.co2_kg * 10) / 10, Math.round(v.costo * 100) / 100, v.passaggi]));
  }
  mesi.columns.forEach((c) => { c.width = 18; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="report-carpooling.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

router.get('/export/pdf', requireAuth, requireRole('mobility_manager', 'supervisor'), (req, res) => {
  const { where, params } = filtriDaQuery(req.query);
  const report = computeSavings(where, params);
  const settings = db.prepare('SELECT company_name FROM system_settings WHERE id = 1').get();

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="report-carpooling.pdf"');
  doc.pipe(res);

  doc.fontSize(18).text(`Report carpooling — ${settings.company_name}`, { align: 'left' });
  doc.fontSize(10).fillColor('#666').text(`Generato il ${new Date().toLocaleString('it-IT')}`);
  doc.moveDown(1.5);

  doc.fillColor('#000').fontSize(13).text('Riepilogo generale');
  doc.moveDown(0.5);
  doc.fontSize(11);
  const righeSummary = [
    ['Km risparmiati', report.totali.km_risparmiati],
    ['CO2 risparmiata (kg)', report.totali.co2_kg_risparmiata],
    ['Costo risparmiato (€)', report.totali.costo_risparmiato_eur],
    ['Viaggi completati', report.totali.viaggi_completati],
    ['Passeggeri trasportati (totale)', report.totali.passeggeri_trasportati_totali],
  ];
  for (const [label, val] of righeSummary) doc.text(`${label}: ${val}`);
  doc.moveDown(1.5);

  doc.fontSize(13).text('Per sede');
  doc.moveDown(0.5);
  doc.fontSize(10);
  for (const [nome, v] of Object.entries(report.per_sede)) {
    doc.text(`${nome} — km: ${Math.round(v.km)}, CO2: ${Math.round(v.co2_kg * 10) / 10} kg, costo: € ${Math.round(v.costo * 100) / 100}, viaggi: ${v.passaggi}`);
  }
  doc.moveDown(1.5);

  doc.fontSize(13).text('Per mese');
  doc.moveDown(0.5);
  doc.fontSize(10);
  for (const [mese, v] of Object.entries(report.per_mese).sort()) {
    doc.text(`${mese} — km: ${Math.round(v.km)}, CO2: ${Math.round(v.co2_kg * 10) / 10} kg, costo: € ${Math.round(v.costo * 100) / 100}, viaggi: ${v.passaggi}`);
  }

  doc.end();
});

module.exports = router;
