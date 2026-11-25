const db = require('../db');

// Documenti attivi di un tipo che l'utente non ha ancora accettato (o ha accettato in una
// versione precedente). Tipi: 'generale' (richiesto ovunque nell'app) e 'conducente' (richiesto
// prima di offrire un passaggio).
function documentiPendenti(userId, tipo) {
  return db.prepare(`
    SELECT d.id, d.titolo, d.versione FROM legal_documents d
    LEFT JOIN document_acceptances a ON a.document_id = d.id AND a.user_id = ?
    WHERE d.attivo = 1 AND d.tipo = ? AND (a.versione_accettata IS NULL OR a.versione_accettata < d.versione)
    ORDER BY d.id
  `).all(userId, tipo);
}

// Middleware: chi non ha accettato i documenti del conducente non può pubblicare offerte, anche
// chiamando direttamente le API (il blocco nell'interfaccia non basta).
function richiediDocumentiConducente(req, res, next) {
  const pendenti = documentiPendenti(req.user.id, 'conducente');
  if (pendenti.length > 0) {
    return res.status(403).json({
      error: 'Prima di offrire un passaggio devi accettare i documenti del conducente.',
      codice: 'DOCUMENTI_DA_ACCETTARE',
    });
  }
  next();
}

module.exports = { documentiPendenti, richiediDocumentiConducente };
