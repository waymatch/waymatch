// Utility condivise per le scelte rapide di data/ora nei moduli di offerta passaggio.

// "AAAA-MM-GG" (anche con l'ora in coda) come data del calendario locale: new Date("2026-11-24")
// la leggerebbe come mezzanotte UTC e in un fuso a ovest di UTC mostrerebbe il giorno prima.
export function dataLocale(iso) {
  const [a, m, g] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(a, (m || 1) - 1, g || 1);
}

// Data locale AAAA-MM-GG (toISOString userebbe l'UTC: dopo mezzanotte darebbe il giorno prima).
export function dataISO(giorniDaOggi = 0) {
  const d = new Date();
  d.setDate(d.getDate() + giorniDaOggi);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Arrotonda un orario al prossimo quarto d'ora pieno alla mezz'ora successiva:
// 9:26 -> 9:30, 10:44 -> 11:00. Usa Date invece dell'aritmetica sui minuti così un
// arrotondamento che sfora i 60 minuti fa scattare correttamente l'ora successiva.
export function prossimoOrarioMezzora(daData = new Date()) {
  const d = new Date(daData);
  // Anche secondi e millisecondi contano: alle 10:30:20 la mezz'ora delle 10:30 è già passata.
  const minuti = d.getMinutes() + (d.getSeconds() > 0 || d.getMilliseconds() > 0 ? 1 / 60 : 0);
  d.setMinutes(Math.ceil(minuti / 30) * 30, 0, 0);
  return d.toTimeString().slice(0, 5);
}

// Se l'orario abituale (es. "08:00") è già passato rispetto ad adesso, propone il
// prossimo orario utile arrotondato invece di un default già nel passato: evita l'errore
// "orario già passato" al primo tentativo quando si offre un passaggio per oggi stesso.
// Dopo le 23:30 la mezz'ora successiva cade domani: per oggi non resta un orario utile, quindi si
// propone quello abituale (valido per i giorni successivi) invece di "00:00".
export function orarioDefaultIntelligente(orarioAbituale) {
  const adesso = new Date();
  const ora = adesso.toTimeString().slice(0, 5);
  if (orarioAbituale > ora) return orarioAbituale;
  const prossimo = prossimoOrarioMezzora(adesso);
  return prossimo > ora ? prossimo : orarioAbituale;
}
