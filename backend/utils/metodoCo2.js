// Metodo di calcolo della CO2 evitata, versione 1 (docs/metodo-calcolo.md). Il metodo è uno solo,
// uguale per tutte le installazioni: i fattori non sono modificabili dal Mobility Manager. Se
// cambiano formula, confini o regole si crea una nuova versione del metodo (e del documento);
// l'aggiornamento dei valori delle fonti non cambia la versione.
//
// In breve: la CO2 che i passeggeri con check-in non hanno emesso lasciando a casa la propria auto,
// al netto dei km in più che l'autista ha fatto per prenderli. Solo CO2 allo scarico.
const tabella = require('../fattori/ispra-autovetture.json');
const { kmAffidabili } = require('./points');
const { costoKmPerAlimentazione } = require('./co2');

const METODO_VERSIONE = 1;

const ALIMENTAZIONI = Object.keys(tabella.medie).filter((k) => k !== 'sconosciuta');

// Classe Euro dall'anno di prima immatricolazione, secondo le date di obbligo per TUTTE le nuove
// immatricolazioni (non solo i nuovi tipi): Euro 1 dal 1993, 2 dal 1997, 3 dal 2001, 4 dal 2006,
// 5 dal 2011, 6 a/b/c dal 2015, 6 d-temp dal 2019, 6 d dal 2021.
function classeEuro(anno) {
  const a = Number(anno);
  if (!Number.isInteger(a) || a < 1950 || a > new Date().getFullYear() + 1) return null;
  if (a < 1993) return 'pre_euro';
  if (a <= 1996) return 'euro1';
  if (a <= 2000) return 'euro2';
  if (a <= 2005) return 'euro3';
  if (a <= 2010) return 'euro4';
  if (a <= 2014) return 'euro5';
  if (a <= 2018) return 'euro6';
  if (a <= 2020) return 'euro6d_temp';
  return 'euro6d';
}

// Fattore di CO2 (g/km) di un'auto, e da dove viene. In ordine, il primo disponibile:
// per segmento e classe Euro (ISPRA) → media per alimentazione (ISPRA) → auto media.
// (Il livello «per modello» dalla tabella EEA si aggiunge davanti agli altri quando c'è la tabella.)
function fattore({ alimentazione, segmento, anno } = {}) {
  if (!ALIMENTAZIONI.includes(alimentazione)) return { g_km: tabella.medie.sconosciuta, fonte: 'media' };
  const classe = classeEuro(anno);
  const preciso = classe && segmento ? tabella.per_segmento_euro?.[alimentazione]?.[segmento]?.[classe] : undefined;
  if (Number.isFinite(preciso)) return { g_km: preciso, fonte: 'segmento_euro' };
  return { g_km: tabella.medie[alimentazione], fonte: 'alimentazione' };
}

// Chi ha dichiarato un'auto nel profilo.
const haAuto = (u) => !!(u.auto_alimentazione || u.auto_marca || u.auto_modello);

// Il passeggero conta solo se, senza il passaggio, avrebbe usato la propria auto (§3.2).
// Ritorna null se conta, altrimenti il motivo dell'esclusione.
function motivoEsclusione(p) {
  if (p.senza_passaggio === 'auto_propria') return null;
  if (['mezzi', 'bici_piedi', 'altro'].includes(p.senza_passaggio)) return 'scenario';
  return haAuto(p) ? null : 'senza_auto';
}

function nuovaQualita() {
  return {
    viaggi_completati: 0, viaggi_con_km_verificati: 0, viaggi_con_deviazione_non_calcolabile: 0,
    passeggeri_completati: 0, passeggeri_conteggiati: 0, esclusi_scenario: 0, esclusi_senza_auto: 0,
    fattori: { modello: 0, segmento_euro: 0, alimentazione: 0, media: 0 },
  };
}

// Calcolo di un viaggio completato. `ride` ha i campi del viaggio (km_stimati, km_verificati,
// km_diretti, coordinate, soste = numero di soste) e quelli dell'auto dell'autista; `passeggeri` è
// l'elenco dei passeggeri con check-in, con i campi del profilo. Aggiorna `qualita`.
function calcolaViaggio(ride, passeggeri, qualita) {
  qualita.viaggi_completati += 1;
  if (Number(ride.km_verificati) > 0) qualita.viaggi_con_km_verificati += 1;

  // Deviazione dell'autista (§3.4): percorso con le soste meno percorso diretto, una volta per viaggio.
  let kmDeviazione = 0;
  const calcolabile = Number(ride.km_verificati) > 0 && Number(ride.km_diretti) > 0;
  if (calcolabile) kmDeviazione = Math.max(0, ride.km_verificati - ride.km_diretti);
  else if (Number(ride.soste) > 0) qualita.viaggi_con_deviazione_non_calcolabile += 1;

  // Ogni passeggero evita il tragitto diretto: i km del viaggio SENZA il giro in più dell'autista.
  // La deviazione si sottrae poi una volta sola dal totale del viaggio; se contasse anche nei km di
  // ogni passeggero, con più passeggeri il risparmio crescerebbe al crescere della deviazione.
  const km = calcolabile ? Math.max(0, kmAffidabili(ride) - kmDeviazione) : kmAffidabili(ride);
  let kmEvitati = 0, co2gEvitati = 0, costoEvitato = 0;
  for (const p of passeggeri) {
    qualita.passeggeri_completati += 1;
    const motivo = motivoEsclusione(p);
    if (motivo) { qualita[`esclusi_${motivo}`] += 1; continue; }
    const f = fattore({ alimentazione: p.auto_alimentazione, segmento: p.auto_segmento, anno: p.auto_anno });
    qualita.passeggeri_conteggiati += 1;
    qualita.fattori[f.fonte] += 1;
    kmEvitati += km;
    co2gEvitati += km * f.g_km;
    costoEvitato += km * costoKmPerAlimentazione(p.auto_alimentazione);
  }

  if (kmEvitati > 0 && kmDeviazione > 0) {
    const fa = fattore({ alimentazione: ride.auto_alimentazione, segmento: ride.auto_segmento, anno: ride.auto_anno });
    kmEvitati -= kmDeviazione;
    co2gEvitati -= kmDeviazione * fa.g_km;
    costoEvitato -= kmDeviazione * costoKmPerAlimentazione(ride.auto_alimentazione);
  }
  // Un viaggio non produce mai un risparmio negativo.
  return { km: Math.max(0, kmEvitati), co2_g: Math.max(0, co2gEvitati), costo: Math.max(0, costoEvitato) };
}

// Descrizione del metodo e delle fonti, da stampare nei report.
function descrizioneMetodo() {
  return {
    versione: METODO_VERSIONE,
    nome: `Metodo WayMatch v${METODO_VERSIONE}`,
    confine: 'CO2 allo scarico (dal serbatoio alla ruota)',
    fonte_fattori: tabella.fonte,
    fonte_url: tabella.url,
    fonte_licenza: tabella.licenza,
    fonte_anno: tabella.anno_valori,
  };
}

// Valori medi ISPRA (g CO2/km) per alimentazione, in sola lettura (pannello Costi e CO2).
const co2MediaPerAlimentazione = (chiave) => tabella.medie[chiave === 'altro' ? 'sconosciuta' : chiave];

module.exports = {
  METODO_VERSIONE, classeEuro, fattore, haAuto, motivoEsclusione, nuovaQualita, calcolaViaggio,
  descrizioneMetodo, co2MediaPerAlimentazione,
};
