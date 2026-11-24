// Express 4 non intercetta le promise rifiutate: senza questo un errore in una route
// async diventa un "unhandled rejection", che su Node 22 termina l'intero processo.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
