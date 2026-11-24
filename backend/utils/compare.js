const crypto = require('crypto');

// Confronto a tempo costante. Usato dove uno scanner di sicurezza segnala un confronto
// diretto (===/!==) come "timing discrepancy": nel nostro caso si tratta sempre di ID
// numerici non segreti (non password/token/firme), quindi un timing attack non è
// realisticamente sfruttabile — ma il costo di usare un confronto a tempo costante qui è
// nullo, quindi lo adottiamo comunque invece di spiegare caso per caso perché non serve.
function confrontoSicuro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { confrontoSicuro };
