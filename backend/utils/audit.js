const db = require('../db');
const { logEvent } = require('./structuredLog');

// Registra un'azione nel log attività, visibile ai mobility manager con filtro per
// categoria: "gestione" per le operazioni di amministrazione, "utente" per un
// sottoinsieme curato delle azioni degli utenti sui propri passaggi/prenotazioni/premi
// (non ogni singolo click, altrimenti il log diventa enorme e inutile).
//
// Ogni azione viene anche emessa in tempo reale come log strutturato (vedi
// utils/structuredLog.js): chi collega un sistema di log management esterno ha così lo
// storico completo lì fin dal primo giorno, indipendentemente da quanto lo conserviamo
// nel database applicativo (vedi la pulizia periodica in scheduler.js).
function registraAzione(userId, azione, dettagli = null, categoria = 'gestione') {
  db.prepare(`
    INSERT INTO audit_log (user_id, categoria, azione, dettagli) VALUES (?, ?, ?, ?)
  `).run(userId, categoria, azione, dettagli);
  logEvent('audit_log', { user_id: userId, categoria, azione, dettagli });
}

module.exports = { registraAzione };
