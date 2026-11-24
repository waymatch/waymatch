// Giorni della settimana: 1 = lunedì ... 7 = domenica (come nel server).
export const GIORNI_SETTIMANA = [
  { value: 1, label: 'Lun', nome: 'lunedì' }, { value: 2, label: 'Mar', nome: 'martedì' },
  { value: 3, label: 'Mer', nome: 'mercoledì' }, { value: 4, label: 'Gio', nome: 'giovedì' },
  { value: 5, label: 'Ven', nome: 'venerdì' }, { value: 6, label: 'Sab', nome: 'sabato' },
  { value: 7, label: 'Dom', nome: 'domenica' },
];

// "lun-sab" se i giorni sono consecutivi, altrimenti "lun, mer, ven".
export function descriviGiorni(giorni) {
  const g = [...giorni].sort((a, b) => a - b);
  const etichetta = (n) => GIORNI_SETTIMANA[n - 1].label.toLowerCase();
  if (g.length === 0) return '';
  if (g.length === 7) return 'tutti i giorni';
  const consecutivi = g.every((n, i) => i === 0 || n === g[i - 1] + 1);
  if (consecutivi && g.length > 2) return `${etichetta(g[0])}-${etichetta(g[g.length - 1])}`;
  return g.map(etichetta).join(', ');
}
