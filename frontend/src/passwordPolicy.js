// Testo mostrato accanto a ogni campo dove si imposta una nuova password: deve restare
// identico al requisito applicato lato server (vedi backend/utils/passwordPolicy.js), che
// resta comunque l'unica fonte di verità reale (qui è solo un aiuto per l'utente).
export const REQUISITI_PASSWORD = 'Almeno 14 caratteri (al massimo 72), con una lettera maiuscola, un numero e un carattere speciale.';

// Stessi requisiti che applica il server (backend/utils/passwordPolicy.js): servono a non far
// partire richieste che il server rifiuterebbe; il server resta comunque la fonte di verità.
export function passwordValida(password) {
  if (typeof password !== 'string' || password.length < 14) return false;
  if (new TextEncoder().encode(password).length > 72) return false;
  return /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}
