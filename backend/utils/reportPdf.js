// Report PDF «Benefici del carpooling»: copertina con periodo e perimetro, indicatori, grafici per mese
// e per sede, metodologia, qualità dei dati. Il testo usa solo caratteri dei font standard del PDF
// (Latin-1 più «—» e «€»): niente frecce, simboli matematici o apici speciali.
const PDFDocument = require('pdfkit');
const { version: VERSIONE_APP } = require('../package.json');

const REPOSITORY = 'https://github.com/waymatch/waymatch';
const LINK_METODO = `${REPOSITORY}/blob/main/docs/metodo-calcolo.md`;
const MARGINE = 50;
const GRIGIO = '#666666';
const CHIARO = '#e5e7eb';

const num = (n, dec = 0) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const perc = (a, b) => (b > 0 ? `${num((a / b) * 100)}%` : 'n.d.');
const dataIt = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT') : null);

function colore(hex) { return /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : '#14424F'; }

// Descrizione di periodo e perimetro dai filtri del report.
function perimetro({ dal, al, sedeNome }) {
  const periodo = dal && al ? `dal ${dataIt(dal)} al ${dataIt(al)}` : dal ? `dal ${dataIt(dal)}` : al ? `fino al ${dataIt(al)}` : 'tutto lo storico disponibile';
  return { periodo, sede: sedeNome || 'tutte le sedi' };
}

// Un blocco intero sta nella pagina corrente? Altrimenti se ne apre una nuova.
function spazio(doc, altezza) {
  if (doc.y + altezza > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function titolo(doc, testo, c) {
  spazio(doc, 60);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(c).text(testo);
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
}

function paragrafo(doc, testo, opzioni = {}) {
  doc.font('Helvetica').fontSize(opzioni.size || 10).fillColor(opzioni.colore || '#000000').text(testo, { lineGap: 2, ...opzioni.testo });
  doc.moveDown(0.4);
}

function elenco(doc, voci) {
  for (const v of voci) {
    spazio(doc, 24);
    doc.font('Helvetica').fontSize(10).fillColor('#000000').text(`- ${v}`, { indent: 8, lineGap: 2 });
  }
  doc.moveDown(0.4);
}

// Quattro/cinque indicatori in riquadri affiancati.
function indicatori(doc, voci, c) {
  spazio(doc, 70);
  const larghezza = doc.page.width - 2 * MARGINE;
  const w = (larghezza - (voci.length - 1) * 8) / voci.length;
  const y = doc.y;
  voci.forEach((v, i) => {
    const x = MARGINE + i * (w + 8);
    doc.roundedRect(x, y, w, 58, 6).lineWidth(1).strokeColor(CHIARO).stroke();
    doc.font('Helvetica-Bold').fontSize(17).fillColor(c).text(v.valore, x + 6, y + 9, { width: w - 12, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(GRIGIO).text(v.etichetta, x + 6, y + 34, { width: w - 12, align: 'center' });
  });
  doc.y = y + 70;
  doc.x = MARGINE;
}

// Grafico a barre verticali (per mese): al massimo gli ultimi 12 mesi.
function graficoMesi(doc, perMese, c) {
  const tutti = Object.entries(perMese).sort(([a], [b]) => a.localeCompare(b));
  if (!tutti.length) { paragrafo(doc, 'Nessun viaggio completato nel periodo.', { colore: GRIGIO }); return; }
  const voci = tutti.slice(-12);
  spazio(doc, 190);
  const larghezza = doc.page.width - 2 * MARGINE;
  const altezza = 120;
  const y0 = doc.y + 14;
  const max = Math.max(...voci.map(([, v]) => v.co2_kg), 0.1);
  const passo = larghezza / voci.length;
  doc.moveTo(MARGINE, y0 + altezza).lineTo(MARGINE + larghezza, y0 + altezza).lineWidth(0.5).strokeColor('#999999').stroke();
  voci.forEach(([mese, v], i) => {
    const h = Math.max(1, (v.co2_kg / max) * altezza);
    const x = MARGINE + i * passo + passo * 0.15;
    const w = passo * 0.7;
    doc.rect(x, y0 + altezza - h, w, h).fill(c);
    doc.font('Helvetica').fontSize(7).fillColor('#000000').text(num(v.co2_kg, 1), x - 6, y0 + altezza - h - 10, { width: w + 12, align: 'center', lineBreak: false });
    doc.fillColor(GRIGIO).text(`${mese.slice(5)}/${mese.slice(2, 4)}`, x - 6, y0 + altezza + 4, { width: w + 12, align: 'center', lineBreak: false });
  });
  doc.y = y0 + altezza + 20;
  doc.x = MARGINE;
  doc.font('Helvetica').fontSize(8).fillColor(GRIGIO)
    .text(`CO2 evitata per mese, in kg${tutti.length > voci.length ? ` (ultimi ${voci.length} mesi di ${tutti.length})` : ''}.`);
  doc.moveDown(0.5);
}

// Barre orizzontali per sede, in ordine decrescente di CO2 (al massimo 12, il resto sommato).
function graficoSedi(doc, perSede, c) {
  let voci = Object.entries(perSede).sort(([, a], [, b]) => b.co2_kg - a.co2_kg);
  if (!voci.length) return;
  if (voci.length > 12) {
    const resto = voci.slice(11).reduce((s, [, v]) => ({ km: s.km + v.km, co2_kg: s.co2_kg + v.co2_kg, costo: s.costo + v.costo, passaggi: s.passaggi + v.passaggi }), { km: 0, co2_kg: 0, costo: 0, passaggi: 0 });
    voci = [...voci.slice(0, 11), [`Altre ${voci.length - 11} sedi`, resto]];
  }
  const max = Math.max(...voci.map(([, v]) => v.co2_kg), 0.1);
  const etichette = 150;
  const barra = doc.page.width - 2 * MARGINE - etichette - 90;
  for (const [nome, v] of voci) {
    spazio(doc, 20);
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#000000').text(nome, MARGINE, y, { width: etichette - 8, height: 12, ellipsis: true, lineBreak: false });
    doc.rect(MARGINE + etichette, y + 1, Math.max(1, (v.co2_kg / max) * barra), 9).fill(c);
    doc.fillColor(GRIGIO).fontSize(8).text(`${num(v.co2_kg, 1)} kg - ${num(v.passaggi)} viaggi`, MARGINE + etichette + barra + 6, y + 1, { lineBreak: false });
    doc.y = y + 16;
  }
  doc.x = MARGINE;
  doc.moveDown(0.3);
}

function riquadroQualita(doc, q) {
  const righe = [
    [`Viaggi completati nel periodo`, num(q.viaggi_completati)],
    [`  con chilometri verificati dal server`, `${num(q.viaggi_con_km_verificati)} (${perc(q.viaggi_con_km_verificati, q.viaggi_completati)})`],
    [`  con deviazione dell'autista non calcolabile`, num(q.viaggi_con_deviazione_non_calcolabile)],
    [`Passeggeri con check-in`, num(q.passeggeri_completati)],
    [`  conteggiati nel calcolo`, `${num(q.passeggeri_conteggiati)} (${perc(q.passeggeri_conteggiati, q.passeggeri_completati)})`],
    [`  esclusi: senza il passaggio non avrebbero usato l'auto`, num(q.esclusi_scenario)],
    [`  esclusi: nessuna auto indicata e nessuna risposta`, num(q.esclusi_senza_auto)],
    [`Fattore di emissione dei passeggeri conteggiati`, ''],
    [`  per segmento e classe Euro (il più preciso)`, num(q.fattori.segmento_euro)],
    [`  per alimentazione`, num(q.fattori.alimentazione)],
    [`  auto media (alimentazione non indicata)`, num(q.fattori.media)],
  ];
  const w = doc.page.width - 2 * MARGINE;
  for (const [etichetta, valore] of righe) {
    spazio(doc, 16);
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(etichetta.startsWith('  ') ? GRIGIO : '#000000').text(etichetta, MARGINE, y, { width: w - 110, lineBreak: false });
    doc.fillColor('#000000').text(String(valore), MARGINE + w - 100, y, { width: 100, align: 'right', lineBreak: false });
    doc.y = y + 14;
  }
  doc.x = MARGINE;
}

// Piè di pagina su tutte le pagine: marchio, versione del metodo e numero di pagina.
function pieDiPagina(doc, metodo) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const margini = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // sennò scrivere nel margine aprirebbe una pagina nuova
    const y = doc.page.height - 34;
    doc.moveTo(MARGINE, y - 6).lineTo(doc.page.width - MARGINE, y - 6).lineWidth(0.5).strokeColor(CHIARO).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(GRIGIO)
      .text(`Realizzato con WayMatch ${VERSIONE_APP} - ${REPOSITORY}`, MARGINE, y, { lineBreak: false, link: REPOSITORY })
      .text(`${metodo.nome} - pagina ${i - range.start + 1} di ${range.count}`, MARGINE, y, { width: doc.page.width - 2 * MARGINE, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margini;
  }
}

// Scrive il report nello stream `uscita` (una risposta HTTP o un file).
function scriviReport(uscita, { report, azienda, coloreAzienda, filtri }, { comprimi = true } = {}) {
  const c = colore(coloreAzienda);
  const { totali, per_sede: perSede, per_mese: perMese, metodo, qualita } = report;
  const { periodo, sede } = perimetro(filtri);
  const doc = new PDFDocument({ margin: MARGINE, bufferPages: true, compress: comprimi, info: { Title: `Benefici del carpooling - ${azienda}`, Author: 'WayMatch', Creator: `WayMatch ${VERSIONE_APP}` } });
  doc.pipe(uscita);

  // Copertina
  doc.rect(0, 0, doc.page.width, 8).fill(c);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(c).text('Benefici del carpooling', MARGINE, 60);
  doc.font('Helvetica').fontSize(13).fillColor('#000000').text(azienda);
  doc.moveDown(0.6);
  doc.fontSize(10).fillColor(GRIGIO)
    .text(`Periodo: ${periodo}`)
    .text(`Sedi: ${sede}`)
    .text(`Generato il ${new Date().toLocaleString('it-IT')}`)
    .text(`${metodo.nome} - fattori ${metodo.fonte_anno} (${metodo.fonte_licenza})`);
  doc.moveDown(1);

  indicatori(doc, [
    { valore: `${num(totali.co2_kg_risparmiata, 1)} kg`, etichetta: 'CO2 evitata' },
    { valore: num(totali.km_risparmiati), etichetta: 'km evitati' },
    { valore: `${num(totali.costo_risparmiato_eur, 2)} €`, etichetta: 'costi evitati' },
    { valore: num(totali.viaggi_completati), etichetta: 'viaggi condivisi' },
    { valore: num(qualita.passeggeri_conteggiati), etichetta: 'passeggeri conteggiati' },
  ], c);
  paragrafo(doc, `Sono i risultati di ${num(totali.viaggi_completati)} viaggi completati con ${num(totali.passeggeri_trasportati_totali)} passeggeri con check-in. Nel calcolo contano i ${num(qualita.passeggeri_conteggiati)} che, senza il passaggio, avrebbero usato la propria auto. Sono stime per il reporting interno, non una certificazione: leggi la sezione «Metodologia» e i limiti.`, { colore: GRIGIO, size: 9 });

  titolo(doc, 'CO2 evitata per mese', c);
  graficoMesi(doc, perMese, c);

  titolo(doc, 'Per sede', c);
  graficoSedi(doc, perSede, c);

  // Metodologia
  doc.addPage();
  titolo(doc, `Metodologia - ${metodo.nome}`, c);
  paragrafo(doc, 'Che cosa si misura. La CO2 che non è stata emessa perché un collega ha viaggiato come passeggero invece di usare la propria auto, al netto dei chilometri in più che l\'autista ha percorso per passarlo a prendere. L\'auto dell\'autista non produce risparmio: avrebbe fatto quel viaggio comunque. L\'impostazione è quella della categoria 7 dello Scope 3 del GHG Protocol (spostamenti casa-lavoro dei dipendenti).');
  paragrafo(doc, 'Come si calcola. Per ogni viaggio completato e per ogni passeggero con check-in che senza il passaggio avrebbe usato la propria auto: chilometri del tragitto per il fattore di emissione della sua auto. Dal totale del viaggio si sottrae la deviazione dell\'autista (percorso con le soste meno percorso diretto, per il fattore della sua auto); un viaggio non produce mai un risparmio negativo.');
  paragrafo(doc, `Fattore di emissione. Il primo disponibile: per segmento e classe Euro dell'auto (in base all'anno di immatricolazione), per alimentazione, auto media. Fonte: ${metodo.fonte_fattori} (${metodo.fonte_url}), valori ${metodo.fonte_anno}, licenza ${metodo.fonte_licenza}. Sono stime su strada del parco circolante italiano, non valori di omologazione. I fattori non sono modificabili.`);
  paragrafo(doc, `Confine. ${metodo.confine}, solo CO2: né la produzione dei carburanti né quella dell'energia elettrica. Un'auto elettrica evitata vale quindi 0 g/km: il risparmio legato all'elettrico è sottostimato, mai gonfiato.`);
  titolo(doc, 'Limiti', c);
  elenco(doc, [
    'Stime per segmento, classe Euro e alimentazione, non misure su ogni veicolo; nessun correttivo sui consumi reali.',
    'Lo scenario alternativo (come il collega verrebbe al lavoro senza il passaggio) è dichiarato dagli utenti, non verificato.',
    'I chilometri sono quelli del tragitto stimato, non misurati; il passeggero conta per l\'intero tragitto anche se sale o scende a metà.',
    'Il tratto per raggiungere il punto di ritrovo non si conta: se il passeggero lo fa in auto, il risparmio è sovrastimato.',
    'Non si considerano effetti indiretti.',
  ]);
  doc.font('Helvetica').fontSize(9).fillColor(c).text(`Testo completo del metodo e storico delle versioni: ${LINK_METODO}`, { link: LINK_METODO, underline: true });
  doc.moveDown(0.5);

  titolo(doc, 'Qualità dei dati', c);
  riquadroQualita(doc, qualita);

  pieDiPagina(doc, metodo);
  doc.end();
}

module.exports = { scriviReport };
