// Giorni lavorativi dell'azienda (1 = lunedì ... 7 = domenica), scelti dal mobility manager in
// Impostazioni → Calendario. Valore predefinito: lunedì-sabato.
const db = require('../db');

const PREDEFINITO = [1, 2, 3, 4, 5, 6];
const NOMI = { 1: 'lunedì', 2: 'martedì', 3: 'mercoledì', 4: 'giovedì', 5: 'venerdì', 6: 'sabato', 7: 'domenica' };

function normalizza(valore) {
  const lista = (Array.isArray(valore) ? valore : String(valore || '').split(','))
    .map(Number).filter((g) => Number.isInteger(g) && g >= 1 && g <= 7);
  return [...new Set(lista)].sort((a, b) => a - b);
}

function giorniLavorativi() {
  const r = db.prepare('SELECT giorni_lavorativi FROM system_settings WHERE id = 1').get();
  const g = normalizza(r && r.giorni_lavorativi);
  return g.length ? g : PREDEFINITO;
}

// "YYYY-MM-DD" → numero del giorno (1 = lunedì ... 7 = domenica), senza fusi orari.
function giornoDellaSettimana(dataISO) {
  const [y, m, d] = String(dataISO).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function dataLavorativa(dataISO) {
  return giorniLavorativi().includes(giornoDellaSettimana(dataISO));
}

function messaggioGiornoNonLavorativo(dataISO) {
  return `La tua azienda non prevede passaggi di ${NOMI[giornoDellaSettimana(dataISO)]}. Scegli un altro giorno.`;
}

module.exports = { PREDEFINITO, NOMI, normalizza, giorniLavorativi, giornoDellaSettimana, dataLavorativa, messaggioGiornoNonLavorativo };
