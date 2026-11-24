const fs = require('fs');

// Convenzione "Docker/Podman secrets": se <NOME>_FILE è impostata, il valore viene letto da
// quel file (montato come secret, mai passato in chiaro nell'ambiente del processo);
// altrimenti si usa la variabile d'ambiente diretta <NOME>. Così lo stesso codice funziona
// sia con un semplice .env (oggi) sia con un secrets manager che monta file — Podman
// secrets, Docker secrets, un Vault Agent, o Kubernetes — senza modifiche.
function readSecret(nome) {
  const percorsoFile = process.env[`${nome}_FILE`];
  if (percorsoFile) return fs.readFileSync(percorsoFile, 'utf8').trim();
  return process.env[nome];
}

module.exports = { readSecret };
