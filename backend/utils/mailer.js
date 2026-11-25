const nodemailer = require('nodemailer');
const { readSecret } = require('./secrets');
const { log } = require('./structuredLog');

// Configurazione SMTP tramite variabili d'ambiente (docker-compose / .env):
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE (true/false),
// SMTP_REQUIRE_TLS (true/false; predefinito true quando c'è SMTP_USER)
// Se SMTP_HOST non è impostato, l'invio email è semplicemente disattivato: l'app
// continua a funzionare normalmente con le sole notifiche in-app e push.
let transporter = null;
let configurato = false;

function getTransporter() {
  if (configurato) return transporter;
  configurato = true;
  if (!process.env.SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    // Con le credenziali, STARTTLS è obbligatorio: se il server non lo offre, l'invio fallisce
    // invece di mandare password e link di reset in chiaro. SMTP_REQUIRE_TLS=false lo
    // disattiva, per i relay interni senza TLS (sconsigliato).
    // Un server di posta lento o irraggiungibile non deve tenere in sospeso le richieste.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    requireTLS: process.env.SMTP_REQUIRE_TLS ? process.env.SMTP_REQUIRE_TLS !== 'false' : !!process.env.SMTP_USER,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: readSecret('SMTP_PASS') }
      : undefined,
  });
  return transporter;
}

function smtpAttivo() {
  return !!process.env.SMTP_HOST;
}

async function inviaEmail(to, subject, testo) {
  const t = getTransporter();
  if (!t || !to) return;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'carpooling@azienda.it',
      to,
      subject,
      text: testo,
    });
  } catch (e) {
    log.warn('email_non_inviata', { errore: e });
  }
}

// Come inviaEmail, ma per la pagina di diagnostica: qui l'errore deve arrivare
// all'amministratore che sta verificando la configurazione, non essere solo loggato.
async function inviaEmailTest(to, subject, testo) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP non configurato: imposta SMTP_HOST nel file .env del server e riavvia.');
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'carpooling@azienda.it',
    to,
    subject,
    text: testo,
  });
}

function statoSmtp() {
  return {
    configurato: smtpAttivo(),
    host: process.env.SMTP_HOST || null,
    porta: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    sicuro: process.env.SMTP_SECURE === 'true',
    mittente: process.env.SMTP_FROM || process.env.SMTP_USER || null,
  };
}

module.exports = { inviaEmail, smtpAttivo, inviaEmailTest, statoSmtp };
