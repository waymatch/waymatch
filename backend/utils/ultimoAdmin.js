// Protezione dell'ultimo amministratore: l'app deve avere sempre almeno un
// mobility manager attivo, altrimenti nessuno può più gestire utenti, sedi e impostazioni, e
// senza SMTP né SSO non c'è modo di recuperare l'accesso dall'interno.
//
// Si usa DENTRO una transazione dopo la modifica: se non resta nessun mobility manager attivo
// si lancia l'errore e la transazione annulla tutto.
const db = require('../db');

const MESSAGGIO = 'Deve restare almeno un mobility manager attivo.';

class ErroreUltimoAdmin extends Error {
  constructor() { super(MESSAGGIO); this.ultimoAdmin = true; }
}

function mmAttivi() {
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ruolo = 'mobility_manager' AND attivo = 1`).get().n;
}

function verificaResteUnAdmin() {
  if (mmAttivi() < 1) throw new ErroreUltimoAdmin();
}

module.exports = { MESSAGGIO, ErroreUltimoAdmin, verificaResteUnAdmin };
