// Policy password unica per tutti i punti dell'app che ne impostano una (setup iniziale,
// creazione utente, cambio password personale, reset via link o da parte di un mobility
// manager, import CSV): almeno 14 caratteri, una maiuscola, un numero, un carattere
// speciale. Requisito centralizzato qui per non doverlo tenere sincronizzato a mano in
// più file — se cambia, cambia una volta sola.
const REQUISITI_PASSWORD = 'almeno 14 caratteri, con almeno una lettera maiuscola, un numero e un carattere speciale';

function passwordValida(password) {
  if (typeof password !== 'string' || password.length < 14) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

module.exports = { passwordValida, REQUISITI_PASSWORD };
