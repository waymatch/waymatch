const webpush = require('web-push');
const db = require('../db');
const { inviaEmail, smtpAttivo } = require('./mailer');

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const s = db.prepare('SELECT vapid_public_key, vapid_private_key FROM system_settings WHERE id = 1').get();
  if (s.vapid_public_key && s.vapid_private_key) {
    webpush.setVapidDetails('mailto:admin@example.com', s.vapid_public_key, s.vapid_private_key);
    vapidConfigured = true;
  }
}

// Categorie di notifica esposte all'utente nelle preferenze (Profilo). Ogni tipo di
// evento di sistema appartiene a una categoria; l'utente decide, per categoria, su quali
// canali riceverla: nell'app (la campanella), push, email. Senza nessun canale non arriva.
const CATEGORIE = {
  nuova_richiesta: 'richieste_ricevute',
  richiesta_annullata: 'richieste_ricevute',
  richiesta_confermata: 'esito_richieste',
  richiesta_rifiutata: 'esito_richieste',
  viaggio_annullato: 'variazioni_viaggio',
  passaggio_modificato: 'variazioni_viaggio',
  autista_in_ritardo: 'variazioni_viaggio',
  passeggero_in_ritardo: 'ritardo_passeggero',
  completamento_approvato: 'variazioni_viaggio',
  completamento_rifiutato: 'variazioni_viaggio',
  riscatto_approvato: 'premi',
  riscatto_rifiutato: 'premi',
  riscatto_consegnato: 'premi',
  completamento_da_approvare: 'approvazioni_mm',
  promemoria_partenza: 'promemoria_partenza',
  matching_proattivo: 'matching_proattivo',
  passaggio_preferito_pubblicato: 'passaggi_preferiti',
  riepilogo_settimanale: 'riepilogo_settimanale',
  iscritto_lista_attesa: 'esito_richieste',
  promosso_da_lista_attesa: 'esito_richieste',
  richiesta_cancellazione_ricevuta: 'approvazioni_mm',
  richiesta_cancellazione_rifiutata: 'variazioni_viaggio',
  richiesta_reset_password_ricevuta: 'approvazioni_mm',
  password_reset_completata: 'variazioni_viaggio',
  turni_in_pausa: 'variazioni_viaggio',
  nuova_versione: 'nuove_versioni',
};

const CATEGORIE_INFO = [
  { chiave: 'richieste_ricevute', nome: 'Richieste ricevute', descrizione: 'Quando qualcuno richiede un posto in un tuo passaggio offerto.' },
  { chiave: 'esito_richieste', nome: 'Esito delle tue richieste', descrizione: 'Quando una tua richiesta di passaggio viene confermata o rifiutata.' },
  { chiave: 'variazioni_viaggio', nome: 'Variazioni ai viaggi', descrizione: 'Modifiche, cancellazioni ed esiti di completamento dei viaggi che ti riguardano.' },
  { chiave: 'premi', nome: 'Premi', descrizione: 'Esito delle richieste di riscatto premio.' },
  { chiave: 'promemoria_partenza', nome: 'Promemoria di partenza', descrizione: 'Un avviso prima dell\'orario di partenza di un tuo passaggio (come autista o passeggero confermato).', conMinutiAnticipo: true },
  { chiave: 'matching_proattivo', nome: 'Passaggi compatibili con il tuo turno', descrizione: 'Avviso quando viene pubblicato un passaggio compatibile con un tuo turno fisso.' },
  { chiave: 'passaggi_preferiti', nome: 'Passaggi preferiti', descrizione: 'Avviso quando un autista che segui pubblica un nuovo passaggio.' },
  { chiave: 'riepilogo_settimanale', nome: 'Riepilogo settimanale', descrizione: 'Un breve riepilogo dei punti guadagnati e dei viaggi fatti nell\'ultima settimana.' },
  { chiave: 'ritardo_passeggero', nome: 'Ritardo di un passeggero', descrizione: 'Quando un passeggero confermato ti segnala di essere in ritardo al punto di ritrovo.' },
  { chiave: 'approvazioni_mm', nome: 'Approvazioni da validare', descrizione: 'Nuovi viaggi in attesa di approvazione (solo Mobility Manager).', soloRuolo: 'mobility_manager' },
  { chiave: 'nuove_versioni', nome: 'Nuove versioni di WayMatch', descrizione: 'Quando è disponibile una nuova versione della piattaforma, da far installare all\'IT (solo Mobility Manager).', soloRuolo: 'mobility_manager' },
];

function getCategoria(tipo) {
  return CATEGORIE[tipo] || 'variazioni_viaggio';
}

function preferenza(userId, categoria) {
  const row = db.prepare(`
    SELECT inapp, push, email FROM notification_preferences WHERE user_id = ? AND categoria = ?
  `).get(userId, categoria);
  return row || { inapp: 1, push: 1, email: 1 }; // predefinito: tutti i canali attivi
}

// Aggiunge ?nid= (la notifica da segnare come letta all'apertura) prima dell'eventuale frammento:
// "/informazioni#sistema" diventa "/informazioni?nid=42#sistema", non "/informazioni#sistema?nid=42".
function conNid(url, nid) {
  const [percorso, frammento] = url.split('#');
  return `${percorso}${percorso.includes('?') ? '&' : '?'}nid=${nid}${frammento !== undefined ? `#${frammento}` : ''}`;
}

function destinazionePer(tipo) {
  switch (tipo) {
    case 'nuova_richiesta':
    case 'richiesta_annullata':
    case 'completamento_approvato':
    case 'completamento_rifiutato':
      return '/i-miei-viaggi?tab=offerti';
    case 'richiesta_confermata':
    case 'richiesta_rifiutata':
    case 'viaggio_annullato':
    case 'passaggio_modificato':
    case 'iscritto_lista_attesa':
    case 'promosso_da_lista_attesa':
    case 'autista_in_ritardo':
      return '/i-miei-viaggi?tab=prenotati';
    case 'passeggero_in_ritardo':
      return '/i-miei-viaggi?tab=offerti';
    case 'completamento_da_approvare':
      return '/admin/approvazioni';
    case 'richiesta_cancellazione_ricevuta':
      return '/admin/cancellazioni';
    case 'richiesta_cancellazione_rifiutata':
      return '/profilo';
    case 'richiesta_reset_password_ricevuta':
      return '/admin/reset-password';
    case 'password_reset_completata':
      return '/profilo';
    case 'promemoria_partenza':
      return '/i-miei-viaggi';
    case 'nuova_versione':
      return '/informazioni#sistema';
    case 'turni_in_pausa':
      return '/offri'; // la pagina chiede di accettare i documenti del conducente
    case 'matching_proattivo':
    case 'passaggio_preferito_pubblicato':
      return '/cerca';
    case 'riepilogo_settimanale':
      return '/premi';
    case 'riscatto_approvato':
    case 'riscatto_rifiutato':
    case 'riscatto_consegnato':
      return '/premi';
    default:
      return '/';
  }
}

// Crea sempre la notifica in-app; invia push e/o email solo se l'utente non li ha
// disattivati per la categoria dell'evento.
function iconaPush() {
  const ic = require('./icona');
  return ic.sorgente() ? `/api/branding/icona/192.png?v=${ic.versione()}` : undefined;
}

// Tempo massimo per un invio push: un servizio che non risponde non deve bloccare gli invii
// successivi (né i cicli dello scheduler).
const TIMEOUT_PUSH_MS = 10000;

// Una notifica non fa mai fallire l'operazione che l'ha generata: la notifica in-app è
// scritta subito, push ed email sono un tentativo in più. Gli errori finiscono nel log e la
// funzione non rifiuta mai, quindi chi la chiama non deve proteggersi.
// La campanella per questa categoria è attiva? (Predefinito: sì.)
function inAppAttiva(userId, tipo) {
  return !!preferenza(userId, getCategoria(tipo)).inapp;
}

// Notifica in-app: sincrona, si può chiamare dentro una transazione insieme ad altre scritture.
function creaNotificaInApp(userId, tipo, messaggio, rideId = null) {
  const url = destinazionePer(tipo);
  const info = db.prepare(`
    INSERT INTO notifications (user_id, tipo, messaggio, ride_id, url) VALUES (?, ?, ?, ?, ?)
  `).run(userId, tipo, messaggio, rideId, url);
  return { id: info.lastInsertRowid, url };
}

// Push ed email per una notifica, secondo le preferenze dell'utente. inApp è la notifica nella
// campanella (o null, se l'utente l'ha disattivata per questa categoria). Non rifiuta mai.
async function consegnaEsterna(userId, tipo, messaggio, inApp) {
  try {
    const pref = preferenza(userId, getCategoria(tipo));
    const url = inApp?.url || destinazionePer(tipo);

    if (pref.push) {
      ensureVapid();
      const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
      const payload = JSON.stringify({
        title: 'WayMatch',
        body: messaggio,
        icon: iconaPush(),
        // Con la notifica nella campanella, aprire il push la segna come letta.
        url: inApp ? conNid(url, inApp.id) : url,
      });
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { timeout: TIMEOUT_PUSH_MS }
          );
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          } else {
            console.error('Errore invio push:', e.message);
          }
        }
      }
    }

    if (pref.email && smtpAttivo()) {
      const utente = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
      if (utente?.email) {
        try {
          await inviaEmail(utente.email, 'WayMatch — nuova notifica', messaggio);
        } catch (e) {
          console.error('Errore invio email di notifica:', e.message);
        }
      }
    }
  } catch (e) {
    console.error(`[notifiche] consegna di "${tipo}" all'utente ${userId} non completata:`, e.message);
  }
}

// Una notifica non fa mai fallire l'operazione che l'ha generata: la notifica in-app è
// scritta subito, push ed email sono un tentativo in più. Gli errori finiscono nel log e la
// funzione non rifiuta mai, quindi chi la chiama non deve proteggersi.
async function notifica(userId, tipo, messaggio, rideId = null) {
  let inApp = null;
  try {
    if (inAppAttiva(userId, tipo)) inApp = creaNotificaInApp(userId, tipo, messaggio, rideId);
  } catch (e) {
    console.error(`[notifiche] notifica "${tipo}" all'utente ${userId} non salvata:`, e.message);
    return;
  }
  await consegnaEsterna(userId, tipo, messaggio, inApp);
}

// In parallelo invece che in sequenza: chi annulla un viaggio con più passeggeri non deve
// aspettare un invio push/email dopo l'altro. Come notifica, non rifiuta mai.
async function notificaMassiva(userIds, tipo, messaggio, rideId = null) {
  await Promise.all(
    [...new Set(userIds)].map((uid) => notifica(uid, tipo, messaggio, rideId))
  );
}

module.exports = { notifica, notificaMassiva, creaNotificaInApp, inAppAttiva, consegnaEsterna, CATEGORIE_INFO };
