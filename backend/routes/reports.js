const express = require('express');
const db = require('../db');
const { rigaSicura } = require('../utils/export');
const { requireAuth, requireRole } = require('../middleware/auth');
const { gamificationAttiva } = require('../utils/gamification');
const { registraAzione } = require('../utils/audit');
const { asyncHandler } = require('../utils/asyncHandler');
const { generazionePunti } = require('../utils/points');
const { getAllClusters, setClusterOverride, resetClusterOverride, clusterEsistente } = require('../utils/co2');
const { nuovaQualita, calcolaViaggio, descrizioneMetodo } = require('../utils/metodoCo2');
const { scriviReport } = require('../utils/reportPdf');

const router = express.Router();

// Calcola, per ogni viaggio completato, km/CO2/costo evitati grazie ai passeggeri con check-in,
// con il metodo WayMatch v1 (utils/metodoCo2.js, docs/metodo-calcolo.md): conta chi avrebbe usato la
// propria auto, con il fattore della SUA auto, al netto della deviazione dell'autista.
function computeSavings(where = '', params = []) {
  const rides = db.prepare(`
    SELECT r.id, r.km_stimati, r.km_verificati, r.km_diretti, r.partenza_lat, r.partenza_lon, r.arrivo_lat, r.arrivo_lon,
           r.data, r.sede_id, s.nome as sede_nome,
           u.auto_alimentazione, u.auto_segmento, u.auto_anno,
           (SELECT COUNT(*) FROM ride_stops rs WHERE rs.ride_id = r.id) as soste
    FROM rides r
    JOIN users u ON u.id = r.driver_id
    LEFT JOIN sedi s ON s.id = r.sede_id
    WHERE r.stato = 'completato' ${where}
  `).all(...params);
  // Passeggeri con check-in (prenotazione "completato") di quei viaggi, con i dati del profilo che
  // servono al calcolo.
  const passeggeriPerViaggio = new Map();
  for (const b of db.prepare(`
    SELECT b.ride_id, u.auto_alimentazione, u.auto_segmento, u.auto_anno, u.auto_marca, u.auto_modello, u.senza_passaggio
    FROM bookings b JOIN users u ON u.id = b.passenger_id
    WHERE b.stato = 'completato' AND b.ride_id IN (SELECT r.id FROM rides r WHERE r.stato = 'completato' ${where})
  `).all(...params)) {
    if (!passeggeriPerViaggio.has(b.ride_id)) passeggeriPerViaggio.set(b.ride_id, []);
    passeggeriPerViaggio.get(b.ride_id).push(b);
  }

  const qualita = nuovaQualita();
  let totKm = 0, totCo2g = 0, totCosto = 0, totPassaggi = rides.length, totPasseggeriTrasportati = 0;
  // Le sedi si raggruppano per id (due sedi possono avere lo stesso nome); i viaggi senza sede
  // hanno un gruppo a parte. Le mappe evitano chiavi come "__proto__".
  const gruppiSede = new Map();
  const gruppiMese = new Map();
  const vuoto = () => ({ km: 0, co2_kg: 0, costo: 0, passaggi: 0 });
  const nomiSede = new Map();
  for (const r of rides) if (r.sede_id != null) nomiSede.set(r.sede_id, r.sede_nome);
  const conteggioNomi = new Map();
  for (const nome of nomiSede.values()) conteggioNomi.set(nome, (conteggioNomi.get(nome) || 0) + 1);
  const etichettaSede = (r) => {
    if (r.sede_id == null) return 'Senza sede';
    const nome = r.sede_nome || 'Sede';
    return conteggioNomi.get(nome) > 1 || nome === 'Senza sede' ? `${nome} (#${r.sede_id})` : nome;
  };
  for (const r of rides) {
    // Anche un viaggio senza passeggeri conta tra i viaggi completati, senza risparmi.
    const passeggeri = passeggeriPerViaggio.get(r.id) || [];
    const { km, co2_g: co2g, costo } = calcolaViaggio(r, passeggeri, qualita);
    totKm += km;
    totCo2g += co2g;
    totCosto += costo;
    totPasseggeriTrasportati += passeggeri.length;
    for (const [gruppi, chiave] of [[gruppiSede, etichettaSede(r)], [gruppiMese, r.data.slice(0, 7)]]) {
      if (!gruppi.has(chiave)) gruppi.set(chiave, vuoto());
      const g = gruppi.get(chiave);
      g.km += km;
      g.co2_kg += co2g / 1000;
      g.costo += costo;
      g.passaggi += 1;
    }
  }
  const perSede = Object.fromEntries(gruppiSede);
  const perMese = Object.fromEntries(gruppiMese);
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
    metodo: descrizioneMetodo(),
    qualita,
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
    SELECT u.id, u.nome, u.cognome, CASE WHEN u.foto_path IS NOT NULL THEN u.foto_versione END AS foto_versione, u.sede_id,
      COALESCE((SELECT SUM(p.punti) FROM points_log p WHERE p.user_id = u.id AND p.generazione = @gen), 0)
      + COALESCE((SELECT SUM(m.punti) FROM manual_point_awards m WHERE m.user_id = u.id AND m.redemption_id IS NULL AND m.generazione = @gen), 0)
      as punti,
      (SELECT COUNT(*) FROM rides r WHERE r.driver_id = u.id AND r.stato = 'completato')
      + (SELECT COUNT(*) FROM bookings b WHERE b.passenger_id = u.id AND b.stato = 'completato') as viaggi
    FROM users u
    ORDER BY ${gamificationAttiva() ? 'punti' : 'viaggi'} DESC LIMIT 10
  `).all({ gen: generazionePunti() });

  res.set('Cache-Control', 'private, no-store');
  res.json({ ...report, top_utenti: topUtenti });
});

// Costo al km per tipo di alimentazione: valori predefiniti (stime generiche) personalizzabili dal
// Mobility Manager, con possibilità di tornare al predefinito. La CO2 al km (media ISPRA) si vede ma
// non si modifica: segue il metodo di calcolo, uguale per tutti.
router.get('/cost-co2-clusters', requireAuth, requireRole('mobility_manager'), (req, res) => {
  res.json({ clusters: getAllClusters() });
});

router.put('/cost-co2-clusters/:alimentazione', requireAuth, requireRole('mobility_manager'), (req, res) => {
  if (!clusterEsistente(req.params.alimentazione)) return res.status(400).json({ error: 'Alimentazione sconosciuta' });
  const costo = Number(req.body.costo_km_eur);
  if (req.body.costo_km_eur === '' || req.body.costo_km_eur == null || !Number.isFinite(costo) || costo < 0 || costo > 100) {
    return res.status(400).json({ error: 'Valore non valido' });
  }
  setClusterOverride(req.params.alimentazione, { costo_km_eur: costo });
  registraAzione(req.user.id, 'cluster_costo_co2_modificato', `${req.params.alimentazione}: €${costo}/km`);
  res.json({ clusters: getAllClusters() });
});

router.delete('/cost-co2-clusters/:alimentazione', requireAuth, requireRole('mobility_manager'), (req, res) => {
  if (!clusterEsistente(req.params.alimentazione)) return res.status(400).json({ error: 'Alimentazione sconosciuta' });
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
  wb.creator = 'WayMatch';

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

  const m = report.metodo;
  const q = report.qualita;
  const met = wb.addWorksheet('Metodo e qualità');
  met.addRow(rigaSicura([m.nome]));
  for (const riga of [
    ['Confine', m.confine],
    ['Fonte dei fattori', `${m.fonte_fattori} (${m.fonte_url}), valori ${m.fonte_anno}, ${m.fonte_licenza}`],
    ['Testo del metodo', 'https://github.com/waymatch/waymatch/blob/main/docs/metodo-calcolo.md'],
    ['Nota', 'Stime per il reporting interno, non una certificazione. Vedi il testo del metodo per formula e limiti.'],
    [],
    ['Qualità dei dati', 'Valore'],
    ['Viaggi completati', q.viaggi_completati],
    ['Viaggi con km verificati dal server', q.viaggi_con_km_verificati],
    ['Viaggi con deviazione non calcolabile', q.viaggi_con_deviazione_non_calcolabile],
    ['Passeggeri con check-in', q.passeggeri_completati],
    ['Passeggeri conteggiati', q.passeggeri_conteggiati],
    ['Esclusi: senza il passaggio non avrebbero usato l\'auto', q.esclusi_scenario],
    ['Esclusi: nessuna auto indicata e nessuna risposta', q.esclusi_senza_auto],
    ['Fattore per segmento e classe Euro', q.fattori.segmento_euro],
    ['Fattore per alimentazione', q.fattori.alimentazione],
    ['Fattore auto media', q.fattori.media],
  ]) met.addRow(rigaSicura(riga));
  met.getColumn(1).width = 52;
  met.getColumn(2).width = 90;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="report-carpooling.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

router.get('/export/pdf', requireAuth, requireRole('mobility_manager', 'supervisor'), (req, res) => {
  const { where, params } = filtriDaQuery(req.query);
  const report = computeSavings(where, params);
  const settings = db.prepare('SELECT company_name, primary_color FROM system_settings WHERE id = 1').get();
  const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const sedeNome = req.query.sede_id ? db.prepare('SELECT nome FROM sedi WHERE id = ?').get(req.query.sede_id)?.nome : null;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="report-carpooling.pdf"');
  scriviReport(res, {
    report, azienda: settings.company_name, coloreAzienda: settings.primary_color,
    filtri: { dal: data(req.query.dal), al: data(req.query.al), sedeNome },
  });
});

module.exports = router;
