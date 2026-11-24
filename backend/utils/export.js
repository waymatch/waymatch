// Un testo che inizia con = + - @ (o tab / a capo) può diventare una formula quando chi
// riceve l'export modifica la cella o salva il file come CSV: con l'apice resta testo.
function neutralizzaFormula(valore) {
  if (typeof valore === 'string' && /^[=+\-@\t\r]/.test(valore)) return `'${valore}`;
  return valore;
}

const rigaSicura = (valori) => valori.map(neutralizzaFormula);

module.exports = { neutralizzaFormula, rigaSicura };
