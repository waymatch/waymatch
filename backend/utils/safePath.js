const path = require('path');

// Garantisce che un percorso costruito a partire da un nome file (anche se già salvato in
// DB) non possa mai risolversi fuori dalla cartella consentita. In questo progetto il nome
// file è sempre generato lato server (mai dal nome fornito dal client, vedi i commenti nei
// moduli di upload), quindi un path traversal reale non è possibile — questo controllo
// rende la garanzia esplicita e verificabile anche da un'analisi statica del codice, non
// solo "per costruzione", ed è un secondo livello di difesa nel caso quell'invariante
// venisse mai rotto da una modifica futura.
function percorsoSicuro(baseDir, percorsoRelativo) {
  const baseRisolta = path.resolve(baseDir);
  const risolto = path.resolve(baseRisolta, percorsoRelativo);
  if (risolto !== baseRisolta && !risolto.startsWith(baseRisolta + path.sep)) {
    throw new Error('Percorso non consentito');
  }
  return risolto;
}

module.exports = { percorsoSicuro };
