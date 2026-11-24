const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COSTO = 12;

// Confrontato al posto dell'hash vero quando l'account non esiste o è disattivato: la
// risposta costa la stessa verifica bcrypt e i tempi non rivelano quali email esistono.
const HASH_FITTIZIO = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), BCRYPT_COSTO);

// Sempre asincrone: a costo 12 una chiamata sincrona blocca il processo per ~0,5 s,
// fermando nel frattempo le richieste di tutti gli altri utenti.
function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COSTO);
}

function verificaPassword(password, hash) {
  return bcrypt.compare(String(password ?? ''), hash || HASH_FITTIZIO);
}

function richiedeRehash(hash) {
  return bcrypt.getRounds(hash) < BCRYPT_COSTO;
}

module.exports = { hashPassword, verificaPassword, richiedeRehash, BCRYPT_COSTO };
