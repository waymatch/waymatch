// Log strutturato in JSON su stdout: il meccanismo "standard" e agnostico rispetto al
// sistema di raccolta log usato a valle (Elastic/Kibana, Splunk, Graylog, CloudWatch,
// Loki...). L'app non sa nulla del backend specifico: si limita a scrivere una riga JSON
// per evento su stdout, come qualunque applicazione containerizzata ben scritta (12-factor
// app: i log sono un flusso di eventi, non un file che l'app gestisce da sola). Chi ospita
// l'app sceglie come intercettare questo flusso — vedi il README ("Log management").
function logEvent(tipo, dati = {}) {
  console.log(JSON.stringify({ '@timestamp': new Date().toISOString(), evento: tipo, ...dati }));
}

module.exports = { logEvent };
