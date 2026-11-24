// Migra il database SQLite esistente (in chiaro) a un database cifrato, IN PLACE.
// Uso: DATA_DIR=/percorso DB_ENCRYPTION_KEY=<64 hex> node scripts/cifra-database.js
//
// Sicurezza del procedimento:
// 1. Rifiuta di procedere se il DB target risulta già cifrato (o se il file non è un
//    normale database SQLite leggibile) — non sovrascrive mai qualcosa che non capisce.
// 2. Crea SEMPRE una copia di backup del file originale in chiaro prima di toccarlo.
// 3. Esegue la cifratura vera e propria con PRAGMA rekey (nativo del driver), che opera
//    in place sul file.
// 4. Verifica che il numero di righe di ogni tabella coincida esattamente tra prima e
//    dopo, riaprendo il file cifrato con la chiave: se anche una sola tabella non
//    corrisponde, segnala l'errore e NON cancella il backup (va investigato a mano).
//
// Va eseguito una tantum, con l'app ferma (nessuna scrittura concorrente sul DB durante
// la migrazione).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3-multiple-ciphers');
const { readSecret } = require('../utils/secrets');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'carpooling.db');
const KEY = readSecret('DB_ENCRYPTION_KEY');

function erroreEsci(messaggio) {
  console.error(`\n✖ ${messaggio}\n`);
  process.exit(1);
}

if (!KEY) erroreEsci('DB_ENCRYPTION_KEY non impostata (o DB_ENCRYPTION_KEY_FILE). Genera un valore con: openssl rand -hex 32');
if (!/^[0-9a-fA-F]{64}$/.test(KEY)) erroreEsci('DB_ENCRYPTION_KEY non valida: deve essere una stringa esadecimale di 64 caratteri.');
if (!fs.existsSync(DB_PATH)) erroreEsci(`Nessun database trovato in ${DB_PATH}`);

function elencoTabelle(db) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name);
}

function conteggiPerTabella(db, tabelle) {
  const conteggi = {};
  for (const t of tabelle) conteggi[t] = db.prepare(`SELECT COUNT(*) as n FROM "${t}"`).get().n;
  return conteggi;
}

console.log(`Database target: ${DB_PATH}`);

// 1. Verifica che il DB sia davvero in chiaro e leggibile (non già cifrato, non corrotto).
let dbCheck;
try {
  dbCheck = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  dbCheck.prepare('SELECT COUNT(*) FROM sqlite_master').get();
} catch (e) {
  erroreEsci(`Il database non sembra un file SQLite in chiaro leggibile (potrebbe essere già cifrato, o corrotto): ${e.message}`);
}
const tabelle = elencoTabelle(dbCheck);
const conteggiPrima = conteggiPerTabella(dbCheck, tabelle);
dbCheck.close();
console.log(`Trovate ${tabelle.length} tabelle, ${Object.values(conteggiPrima).reduce((a, b) => a + b, 0)} righe totali.`);

// 2. Backup del file originale in chiaro, prima di qualunque modifica.
const backupPath = `${DB_PATH}.prima-della-cifratura-${Date.now()}.bak`;
fs.copyFileSync(DB_PATH, backupPath);
console.log(`Backup del database in chiaro salvato in: ${backupPath}`);

// 3. Cifratura in place. journal_mode va riportato a DELETE prima del rekey (il driver
//    non supporta il rekey in modalità WAL), poi ripristinato a WAL per l'uso normale.
try {
  const db = new Database(DB_PATH);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.pragma(`rekey='${KEY}'`);
  db.pragma('journal_mode = WAL');
  db.close();
  console.log('Cifratura completata.');
} catch (e) {
  erroreEsci(`Cifratura fallita: ${e.message}. Il file originale è comunque al sicuro in ${backupPath} (il DB target potrebbe essere in uno stato incerto: ripristina dal backup prima di riprovare).`);
}

// 4. Verifica: riapertura con la chiave, confronto dei conteggi tabella per tabella.
try {
  const dbVerifica = new Database(DB_PATH);
  dbVerifica.pragma(`key='${KEY}'`);
  const conteggiDopo = conteggiPerTabella(dbVerifica, tabelle);
  dbVerifica.close();

  const differenze = tabelle.filter((t) => conteggiPrima[t] !== conteggiDopo[t]);
  if (differenze.length > 0) {
    erroreEsci(
      `Verifica fallita: conteggi diversi dopo la cifratura in ${differenze.join(', ')}. ` +
      `NON eliminare ${backupPath}. Ripristina da lì e indaga prima di riprovare.`
    );
  }
  console.log('Verifica riuscita: tutte le tabelle hanno lo stesso numero di righe di prima.');
  console.log(`\n✔ Migrazione completata. Il backup in chiaro resta in ${backupPath} finché non lo elimini a mano.`);
} catch (e) {
  erroreEsci(`Impossibile riaprire il database cifrato per la verifica: ${e.message}. NON eliminare ${backupPath}.`);
}
