const db = require('../db');

// Cluster per tipo di alimentazione: valori medi indicativi di costo/km e CO2/km.
// Fonte: medie di settore ISPRA/EEA per il parco auto europeo (CO2) e stime ACI generiche
// per fascia di alimentazione (costo). Sono stime utili per report interni e per motivare
// la scelta del carpooling, non sostituiscono un calcolo certificato per singolo veicolo:
// il Mobility Manager può personalizzarle dal pannello (vedi getAllClusters/setClusterOverride).
const DEFAULT_CO2_G_KM = {
  benzina: 170,
  diesel: 160,
  gpl: 140,
  metano: 130,
  ibrida: 110,
  elettrica: 45, // stima "well-to-wheel" con mix energetico medio
  altro: 150,
};

const DEFAULT_COSTO_KM_EUR = {
  benzina: 0.25,
  diesel: 0.22,
  gpl: 0.16,
  metano: 0.13,
  ibrida: 0.18,
  elettrica: 0.08,
  altro: 0.22,
};

const CLUSTER_KEYS = Object.keys(DEFAULT_CO2_G_KM);

function chiaveCluster(alimentazione) {
  return CLUSTER_KEYS.includes(alimentazione) ? alimentazione : 'altro';
}

function overrideCluster(chiave) {
  return db.prepare('SELECT * FROM cost_co2_clusters WHERE alimentazione = ?').get(chiave);
}

// Valori effettivi (override del MM se presente, altrimenti il default) per un'alimentazione.
function getCluster(alimentazione) {
  const chiave = chiaveCluster(alimentazione);
  const o = overrideCluster(chiave);
  return {
    alimentazione: chiave,
    costo_km_eur: o?.costo_km_eur ?? DEFAULT_COSTO_KM_EUR[chiave],
    co2_g_km: o?.co2_g_km ?? DEFAULT_CO2_G_KM[chiave],
  };
}

// Tutti i cluster con default, valore effettivo e se sono stati personalizzati — per il
// pannello di gestione del Mobility Manager.
function getAllClusters() {
  return CLUSTER_KEYS.map((chiave) => {
    const o = overrideCluster(chiave);
    return {
      alimentazione: chiave,
      costo_km_eur_default: DEFAULT_COSTO_KM_EUR[chiave],
      co2_g_km_default: DEFAULT_CO2_G_KM[chiave],
      costo_km_eur: o?.costo_km_eur ?? DEFAULT_COSTO_KM_EUR[chiave],
      co2_g_km: o?.co2_g_km ?? DEFAULT_CO2_G_KM[chiave],
      personalizzato: !!o,
    };
  });
}

function setClusterOverride(alimentazione, { costo_km_eur, co2_g_km }) {
  const chiave = chiaveCluster(alimentazione);
  db.prepare(`
    INSERT INTO cost_co2_clusters (alimentazione, costo_km_eur, co2_g_km) VALUES (?, ?, ?)
    ON CONFLICT(alimentazione) DO UPDATE SET costo_km_eur = excluded.costo_km_eur, co2_g_km = excluded.co2_g_km
  `).run(chiave, costo_km_eur, co2_g_km);
}

function resetClusterOverride(alimentazione) {
  db.prepare('DELETE FROM cost_co2_clusters WHERE alimentazione = ?').run(chiaveCluster(alimentazione));
}

function co2GramsForTrip(km, alimentazione) {
  return Math.round(km * getCluster(alimentazione).co2_g_km);
}

function costoKmPerAlimentazione(alimentazione) {
  return getCluster(alimentazione).costo_km_eur;
}

// km "risparmiati" = km del tragitto x numero di passeggeri trasportati
// (ogni passeggero che non usa la propria auto risparmia l'intero tragitto)
function kmRisparmiati(km, numPasseggeri) {
  return km * numPasseggeri;
}

function costoRisparmiato(kmRisparmiatiTot, kmCostEur) {
  return Math.round(kmRisparmiatiTot * kmCostEur * 100) / 100;
}

module.exports = {
  co2GramsForTrip, kmRisparmiati, costoRisparmiato, costoKmPerAlimentazione,
  getAllClusters, setClusterOverride, resetClusterOverride, CLUSTER_KEYS,
};
