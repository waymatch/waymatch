// Porta prima i passaggi il cui percorso reale passa entro `sogliaMetri` da casa
// dell'utente (vedi ride.distanza_casa_m, calcolato dal backend), ordinati dal più
// vicino; il resto resta nell'ordine originale (cronologico).
export function ordinaPerPertinenza(rides, sogliaMetri) {
  const pertinenti = [];
  const altri = [];
  for (const r of rides) {
    if (r.distanza_casa_m != null && r.distanza_casa_m <= sogliaMetri) pertinenti.push(r);
    else altri.push(r);
  }
  pertinenti.sort((a, b) => a.distanza_casa_m - b.distanza_casa_m);
  return [...pertinenti, ...altri];
}

export const SOGLIA_DEFAULT_M = 700;
export const SOGLIA_STORAGE_KEY = 'soglia_pertinenza_m';

export function leggiSogliaSalvata() {
  try {
    const v = Number(localStorage.getItem(SOGLIA_STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : SOGLIA_DEFAULT_M;
  } catch (e) {
    return SOGLIA_DEFAULT_M;
  }
}

export function salvaSoglia(v) {
  try { localStorage.setItem(SOGLIA_STORAGE_KEY, String(v)); } catch (e) { /* ignora */ }
}
