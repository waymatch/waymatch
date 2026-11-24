// Copia coerente del database cifrato, anche con l'app in funzione.
// Uso: DATA_DIR=/percorso DB_ENCRYPTION_KEY=<64 hex> node scripts/backup-db.js <file di destinazione>
//
// Usa VACUUM INTO (istantanea coerente: con il journal WAL attivo un semplice cp del file a
// database aperto può essere incoerente) e la copia resta cifrata con la stessa chiave. Dopo la copia la verifica: si apre con la
// chiave, passa il controllo di integrità e, per sicurezza, NON si apre senza chiave (la copia
// deve essere cifrata come l'originale). La chiave non finisce mai nel backup.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3-multiple-ciphers');
const { readSecret } = require('../utils/secrets');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SORGENTE = path.join(DATA_DIR, 'carpooling.db');
const DEST = process.argv[2];
const KEY = readSecret('DB_ENCRYPTION_KEY');

function esci(m) { console.error(`\n✖ ${m}\n`); process.exit(1); }

if (!DEST) esci('Uso: node scripts/backup-db.js <file di destinazione>');
if (!KEY || !/^[0-9a-fA-F]{64}$/.test(KEY)) esci('DB_ENCRYPTION_KEY mancante o non valida (64 caratteri esadecimali).');
if (!fs.existsSync(SORGENTE)) esci(`Nessun database in ${SORGENTE}`);
if (fs.existsSync(DEST)) esci(`${DEST} esiste già: non sovrascrivo un backup.`);

// Ogni esecuzione scrive su un file temporaneo suo e lo pubblica in DEST solo alla fine, senza
// sovrascrivere: in caso di errore cancella soltanto il proprio file, mai quello di un'altra.
const TMP = `${DEST}.in-corso-${process.pid}-${Date.now()}`;

try {
  const src = new Database(SORGENTE, { readonly: false });
  src.pragma(`key='${KEY}'`);
  src.pragma('busy_timeout = 5000');
  try {
    src.exec(`VACUUM INTO '${TMP.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  // Verifica 1: si apre con la chiave ed è integro.
  const copia = new Database(TMP, { readonly: true });
  copia.pragma(`key='${KEY}'`);
  const integrita = copia.pragma('integrity_check', { simple: true });
  const utenti = copia.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  copia.close();
  if (integrita !== 'ok') { fs.rmSync(TMP, { force: true }); esci(`Controllo di integrità fallito: ${integrita}`); }

  // Verifica 2: senza chiave non deve essere leggibile.
  let leggibileSenzaChiave = false;
  let nuda;
  try {
    nuda = new Database(TMP, { readonly: true });
    nuda.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    leggibileSenzaChiave = true;
  } catch { /* atteso: file cifrato */ } finally {
    nuda?.close();
  }
  if (leggibileSenzaChiave) { fs.rmSync(TMP, { force: true }); esci('La copia risulta in chiaro: backup scartato.'); }

  // Pubblicazione senza sovrascrivere: linkSync fallisce se DEST esiste già. Sui file system che
  // non supportano i collegamenti (alcune condivisioni di rete) si copia in modo esclusivo.
  try {
    try { fs.linkSync(TMP, DEST); } catch (e) {
      if (e.code === 'EEXIST') throw e;
      fs.copyFileSync(TMP, DEST, fs.constants.COPYFILE_EXCL);
    }
  } finally { fs.rmSync(TMP, { force: true }); }

  console.log(`✔ Backup del database creato: ${DEST} (${utenti} utenti, integrità ok, cifrato)`);
} catch (e) { fs.rmSync(TMP, { force: true }); esci(`Backup fallito: ${e.message}`); }
