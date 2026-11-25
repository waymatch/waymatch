// Genera backend/fattori/ispra-autovetture.json, la tabella dei fattori di CO2 per autovetture usata
// dal metodo di calcolo (docs/metodo-calcolo.md), dal file scaricato dalla banca dati ISPRA
// (https://fetransp.isprambiente.it/, licenza CC BY 4.0).
//
//   node scripts/fattori-ispra.js fattori/fonti/<file ISPRA>.xlsx <anno dei valori>
//
// Si rilancia quando ISPRA pubblica una nuova edizione: la tabella si rigenera, il metodo no.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const [, , fileSorgente, annoArg] = process.argv;
if (!fileSorgente || !/^\d{4}$/.test(annoArg || '')) {
  console.error('Uso: node scripts/fattori-ispra.js <file.xlsx> <anno>');
  process.exit(1);
}
const ANNO = Number(annoArg);
const COLONNA = `CO2 ${ANNO} g/km TOTALE`;

// Alimentazioni di WayMatch -> voce ISPRA (autovetture)
const ALIMENTAZIONI = {
  benzina: 'Petrol', diesel: 'Diesel', gpl: 'LPG Bifuel', metano: 'CNG Bifuel',
  ibrida: 'Petrol Hybrid', ibrida_plugin: 'Petrol PHEV', elettrica: 'Battery electric',
};
// Segmenti di WayMatch -> voce ISPRA
const SEGMENTI = { mini: 'Mini', piccola: 'Small', media: 'Medium', grande: 'Large-SUV-Executive' };
// Classi Euro di WayMatch (ricavate dall'anno di immatricolazione) -> voci ISPRA, in ordine di preferenza
const CLASSI = {
  pre_euro: ['ECE 15/04', 'Conventional'],
  euro1: ['Euro 1'], euro2: ['Euro 2'], euro3: ['Euro 3'], euro4: ['Euro 4'], euro5: ['Euro 5'],
  euro6: ['Euro 6 a/b/c'], euro6d_temp: ['Euro 6 d-temp'], euro6d: ['Euro 6 d'],
};

const testo = (c) => (c && typeof c === 'object' ? (c.result ?? c.text ?? '') : c);
const arrotonda = (n) => Math.round(n * 10) / 10;

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fileSorgente);
  const leggi = (nomeFoglio) => {
    const ws = wb.getWorksheet(nomeFoglio);
    if (!ws) throw new Error(`Manca il foglio "${nomeFoglio}"`);
    const intest = ws.getRow(1).values.slice(1).map((c) => String(testo(c)));
    const j = intest.indexOf(COLONNA);
    if (j < 0) throw new Error(`Manca la colonna "${COLONNA}" nel foglio "${nomeFoglio}"`);
    const righe = [];
    ws.eachRow((r, i) => { if (i > 1) righe.push({ v: r.values.slice(1).map(testo), co2: Number(testo(r.values[j + 1])) }); });
    return righe;
  };

  const totale = leggi('categoria').find((r) => r.v[0] === 'Passenger Cars');
  if (!totale) throw new Error('Manca la riga Passenger Cars nel foglio categoria');
  const perAlimentazione = leggi('categoria_alimentazione').filter((r) => r.v[0] === 'Passenger Cars');
  const dettaglio = leggi('dettaglio').filter((r) => r.v[0] === 'Passenger Cars');

  const medie = { sconosciuta: arrotonda(totale.co2) };
  for (const [nostra, loro] of Object.entries(ALIMENTAZIONI)) {
    const r = perAlimentazione.find((x) => x.v[1] === loro);
    if (!r || !Number.isFinite(r.co2)) throw new Error(`Manca il valore medio per ${loro}`);
    medie[nostra] = arrotonda(r.co2);
  }

  const perSegmentoEuro = {};
  for (const [nostra, loro] of Object.entries(ALIMENTAZIONI)) {
    for (const [segmento, voceSegmento] of Object.entries(SEGMENTI)) {
      for (const [classe, voci] of Object.entries(CLASSI)) {
        const r = voci.map((v) => dettaglio.find((x) => x.v[1] === loro && x.v[2] === voceSegmento && x.v[3] === v)).find(Boolean);
        if (r && Number.isFinite(r.co2)) {
          perSegmentoEuro[nostra] ??= {};
          perSegmentoEuro[nostra][segmento] ??= {};
          perSegmentoEuro[nostra][segmento][classe] = arrotonda(r.co2);
        }
      }
    }
  }

  const uscita = {
    fonte: 'ISPRA, La banca dati dei fattori di emissione medi per il parco circolante in Italia',
    url: 'https://fetransp.isprambiente.it/',
    licenza: 'CC BY 4.0',
    anno_valori: ANNO,
    note: 'Autovetture, CO2 allo scarico in g/km, valore TOTALE (cicli urbano, extraurbano e autostradale). Stime COPERT sul parco circolante.',
    file_sorgente: path.basename(fileSorgente),
    sha256_sorgente: crypto.createHash('sha256').update(fs.readFileSync(fileSorgente)).digest('hex'),
    medie,
    per_segmento_euro: perSegmentoEuro,
  };
  const dest = path.join(__dirname, '..', 'fattori', 'ispra-autovetture.json');
  fs.writeFileSync(dest, `${JSON.stringify(uscita, null, 2)}\n`);
  console.log(`Scritto ${dest}: ${Object.keys(medie).length} medie, ${Object.values(perSegmentoEuro).reduce((n, s) => n + Object.values(s).reduce((m, c) => m + Object.keys(c).length, 0), 0)} valori per segmento e classe Euro.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
