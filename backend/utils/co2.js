const db = require('../db');

// Costo al km per tipo di alimentazione: stime generiche (ACI) personalizzabili dal Mobility
// Manager, perché dipendono dall'azienda (rimborsi, prezzi locali). La CO2 NON è qui: segue il metodo
// di calcolo uguale per tutti (utils/metodoCo2.js, docs/metodo-calcolo.md) e non si modifica.
const DEFAULT_COSTO_KM_EUR = {
  benzina: 0.25,
  diesel: 0.22,
  gpl: 0.16,
  metano: 0.13,
  ibrida: 0.18,
  ibrida_plugin: 0.18, // stima: come l'ibrida, finché l'azienda non indica un valore suo
  elettrica: 0.08,
  altro: 0.22,
};

const CLUSTER_KEYS = Object.keys(DEFAULT_COSTO_KM_EUR);

function chiaveCluster(alimentazione) {
  return CLUSTER_KEYS.includes(alimentazione) ? alimentazione : 'altro';
}

function overrideCluster(chiave) {
  return db.prepare('SELECT * FROM cost_co2_clusters WHERE alimentazione = ?').get(chiave);
}

// Costo effettivo (valore del Mobility Manager se presente, altrimenti il predefinito).
function getCluster(alimentazione) {
  const chiave = chiaveCluster(alimentazione);
  const o = overrideCluster(chiave);
  return { alimentazione: chiave, costo_km_eur: o?.costo_km_eur ?? DEFAULT_COSTO_KM_EUR[chiave] };
}

// Tutti i cluster per il pannello del Mobility Manager: il costo è modificabile, la CO2 (media
// ISPRA, g/km) è solo da leggere.
function getAllClusters() {
  const { co2MediaPerAlimentazione } = require('./metodoCo2');
  return CLUSTER_KEYS.map((chiave) => {
    const o = overrideCluster(chiave);
    return {
      alimentazione: chiave,
      costo_km_eur_default: DEFAULT_COSTO_KM_EUR[chiave],
      costo_km_eur: o?.costo_km_eur ?? DEFAULT_COSTO_KM_EUR[chiave],
      personalizzato: !!o,
      co2_g_km: co2MediaPerAlimentazione(chiave),
    };
  });
}

// Nelle modifiche la chiave deve essere esatta: con il ripiego su "altro" un errore di
// battitura cambierebbe o cancellerebbe i valori di un altro cluster.
function clusterEsistente(alimentazione) {
  return CLUSTER_KEYS.includes(alimentazione);
}

// (La colonna co2_g_km della tabella resta per compatibilità: i valori personalizzati delle versioni
// precedenti non si usano più.)
function setClusterOverride(alimentazione, { costo_km_eur }) {
  const chiave = chiaveCluster(alimentazione);
  db.prepare(`
    INSERT INTO cost_co2_clusters (alimentazione, costo_km_eur, co2_g_km) VALUES (?, ?, NULL)
    ON CONFLICT(alimentazione) DO UPDATE SET costo_km_eur = excluded.costo_km_eur
  `).run(chiave, costo_km_eur);
}

function resetClusterOverride(alimentazione) {
  db.prepare('DELETE FROM cost_co2_clusters WHERE alimentazione = ?').run(chiaveCluster(alimentazione));
}

function costoKmPerAlimentazione(alimentazione) {
  return getCluster(alimentazione).costo_km_eur;
}

module.exports = {
  clusterEsistente, costoKmPerAlimentazione,
  getAllClusters, setClusterOverride, resetClusterOverride, CLUSTER_KEYS,
};
