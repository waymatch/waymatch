// Log tecnico in JSON su stdout/stderr, una riga per evento: il formato che qualunque sistema di
// raccolta (Elastic/Kibana, Splunk, Graylog, CloudWatch, Loki...) legge senza configurazioni
// particolari. L'app non conosce il sistema a valle: chi la ospita sceglie come raccogliere il
// flusso (vedi docs/installazione.md, "Log").
//
// Livelli: error, warn, info, debug. LOG_LEVEL (predefinito info) decide da quale livello in su si
// scrive (tranne gli eventi applicativi di logEvent, sempre scritti). error e warn vanno su stderr,
// gli altri su stdout.
//
// È il log per l'IT. Gli eventi di sicurezza (accessi riusciti e falliti, uscite, sessioni) stanno
// solo qui, con area "sicurezza": il Mobility Manager vede il log attività dell'app, non gli orari
// di accesso dei colleghi.
const LIVELLI = { error: 0, warn: 1, info: 2, debug: 3 };
const soglia = () => LIVELLI[String(process.env.LOG_LEVEL || '').toLowerCase()] ?? LIVELLI.info;

// Nessun segreto nel log, nemmeno per sbaglio: i campi con questi nomi si oscurano.
const RISERVATI = /pass(word)?|token|secret|segreto|chiave|key|authorization|cookie/i;

function pulisci(valore, profondita = 0) {
  if (valore instanceof Error) {
    return { messaggio: valore.message, ...(valore.code ? { codice: valore.code } : {}), stack: valore.stack?.split('\n').slice(0, 6).join('\n') };
  }
  if (!valore || typeof valore !== 'object') return valore;
  // Oltre una certa profondità non si scende: si scrive un segnaposto, mai l'oggetto non controllato.
  if (profondita > 3) return '[troncato]';
  if (Array.isArray(valore)) return valore.slice(0, 50).map((v) => pulisci(v, profondita + 1));
  const out = {};
  for (const [k, v] of Object.entries(valore)) out[k] = RISERVATI.test(k) ? '[oscurato]' : pulisci(v, profondita + 1);
  return out;
}

function scrivi(livello, evento, dati = {}, { sempre = false } = {}) {
  if (!sempre && LIVELLI[livello] > soglia()) return;
  const riga = JSON.stringify({ '@timestamp': new Date().toISOString(), livello, evento, ...pulisci(dati) });
  if (LIVELLI[livello] <= LIVELLI.warn) process.stderr.write(`${riga}\n`);
  else process.stdout.write(`${riga}\n`);
}

const log = {
  error: (evento, dati) => scrivi('error', evento, dati),
  warn: (evento, dati) => scrivi('warn', evento, dati),
  info: (evento, dati) => scrivi('info', evento, dati),
  debug: (evento, dati) => scrivi('debug', evento, dati),
};

// Eventi di sicurezza (accessi, uscite, sessioni, permessi): solo per l'IT, con l'indirizzo di
// provenienza. Non finiscono nel log attività che vede il Mobility Manager.
function sicurezza(livello, evento, req, dati = {}) {
  scrivi(livello, evento, { area: 'sicurezza', ip: req?.ip, ...dati });
}

// Eventi applicativi (voci del log attività, righe archiviate dal database): livello info, ma
// scritti SEMPRE, qualunque sia LOG_LEVEL. L'archiviazione cancella le righe dal database dopo
// averle scritte qui: con un livello più alto andrebbero perse.
function logEvent(tipo, dati = {}) {
  scrivi('info', tipo, dati, { sempre: true });
}

module.exports = { log, logEvent, sicurezza, pulisci, LIVELLI };
