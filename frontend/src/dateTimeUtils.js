// Utility condivise per le scelte rapide di data/ora nei moduli di offerta passaggio.

export function dataISO(giorniDaOggi = 0) {
  const d = new Date();
  d.setDate(d.getDate() + giorniDaOggi);
  return d.toISOString().slice(0, 10);
}

// Arrotonda un orario al prossimo quarto d'ora pieno alla mezz'ora successiva:
// 9:26 -> 9:30, 10:44 -> 11:00. Usa Date invece dell'aritmetica sui minuti così un
// arrotondamento che sfora i 60 minuti fa scattare correttamente l'ora successiva.
export function prossimoOrarioMezzora(daData = new Date()) {
  const d = new Date(daData);
  d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30, 0, 0);
  return d.toTimeString().slice(0, 5);
}

// Se l'orario abituale (es. "08:00") è già passato rispetto ad adesso, propone il
// prossimo orario utile arrotondato invece di un default già nel passato: evita l'errore
// "orario già passato" al primo tentativo quando si offre un passaggio per oggi stesso.
export function orarioDefaultIntelligente(orarioAbituale) {
  const ora = new Date().toTimeString().slice(0, 5);
  return orarioAbituale > ora ? orarioAbituale : prossimoOrarioMezzora();
}
