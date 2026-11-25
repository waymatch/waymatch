// Backup del database cifrato (scripts/backup-db.js): coerente, cifrato, mai sovrascritto.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BACKEND, cartellaProva } = require('./ambiente');
const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3-multiple-ciphers'));

const DIR = cartellaProva('backup');
const PORT = 4985;
const API = `http://127.0.0.1:${PORT}/api`;
const KEY = crypto.randomBytes(32).toString('hex');
const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const backup = (dest, key = KEY) => spawnSync('node', ['scripts/backup-db.js', dest], {
  cwd: BACKEND, encoding: 'utf8', env: { ...process.env, DATA_DIR: path.join(DIR, 'data'), DB_ENCRYPTION_KEY: key, DB_ENCRYPTION_KEY_FILE: '' } });

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: KEY, DB_ENCRYPTION_KEY_FILE: '', SMTP_HOST: '' },
  });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const s = await fetch(API + '/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.8.0.1' },
      body: JSON.stringify({ company_name: 'T', nome: 'A', cognome: 'B', email: 'a@test.it', password: 'Password-Valida-123!' }) });
    check('database di prova creato con l\'app in funzione', s.status === 200);

    console.log('\n[Backup con l\'app in funzione]');
    const dest = path.join(DIR, 'copia.db');
    const r = backup(dest);
    check('il backup riesce', r.status === 0, (r.stderr || r.stdout).slice(0, 150));
    const hdr = fs.readFileSync(dest).subarray(0, 15).toString('latin1');
    check('la copia è cifrata (nessuna intestazione SQLite in chiaro)', hdr !== 'SQLite format 3');
    const c = new Database(dest, { readonly: true }); c.pragma(`key='${KEY}'`);
    check('si apre con la chiave e contiene i dati', c.prepare('SELECT COUNT(*) n FROM users').get().n === 1);
    check('migrazioni una tantum registrate (user_version)', c.pragma('user_version', { simple: true }) >= 1);
    check('regole punteggio predefinite tutte presenti', c.prepare('SELECT COUNT(*) n FROM point_rules').get().n === 7);
    c.close();
    let senza = true; try { new Database(dest, { readonly: true }).prepare('SELECT 1 FROM sqlite_master').get(); } catch { senza = false; }
    check('senza chiave non si apre', senza === false);

    console.log('\n[Sicurezza dello script]');
    const r2 = backup(dest);
    check('non sovrascrive un backup esistente', r2.status !== 0 && /esiste già/.test(r2.stderr), r2.stderr.trim().slice(0, 80));
    const r3 = backup(path.join(DIR, 'altra.db'), crypto.randomBytes(32).toString('hex'));
    check('con la chiave sbagliata fallisce e non lascia file', r3.status !== 0 && !fs.existsSync(path.join(DIR, 'altra.db')));
    const r4 = backup(path.join(DIR, 'x.db'), 'troppo-corta');
    check('con una chiave non valida si ferma', r4.status !== 0 && /non valida/.test(r4.stderr));
    check('nessun file temporaneo lasciato', !fs.readdirSync(DIR).some((f) => f.includes('.in-corso-')));

    console.log('\n[Migrazione di un database in chiaro]');
    const MIG = path.join(DIR, 'migrazione'); fs.mkdirSync(MIG);
    // Un processo che termina senza chiudere il database: le righe restano solo nel file WAL.
    spawnSync('node', ['-e', `const D = require(${JSON.stringify(path.join(BACKEND, 'node_modules/better-sqlite3-multiple-ciphers'))});
      const d = new D(${JSON.stringify(path.join(MIG, 'carpooling.db'))}); d.pragma('journal_mode = WAL'); d.pragma('wal_autocheckpoint = 0');
      d.exec('CREATE TABLE prova (x INTEGER)'); for (let i = 0; i < 50; i++) d.prepare('INSERT INTO prova VALUES (?)').run(i); process.exit(0);`]);
    check('scenario di prova: righe ancora nel WAL', fs.existsSync(path.join(MIG, 'carpooling.db-wal')) && fs.statSync(path.join(MIG, 'carpooling.db-wal')).size > 0);
    const cifra = spawnSync('node', ['scripts/cifra-database.js'], { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, DATA_DIR: MIG, DB_ENCRYPTION_KEY: KEY, DB_ENCRYPTION_KEY_FILE: '' } });
    check('la migrazione riesce', cifra.status === 0, (cifra.stderr || cifra.stdout).trim().slice(0, 150));
    const bak = fs.readdirSync(MIG).find((f) => f.endsWith('.bak'));
    const bakDb = bak && new Database(path.join(MIG, bak), { readonly: true });
    check('il backup in chiaro include anche le righe ancora nel WAL', bakDb && bakDb.prepare('SELECT COUNT(*) n FROM prova').get().n === 50);
    bakDb?.close();
    check('il backup in chiaro è leggibile solo dal proprietario', bak && (fs.statSync(path.join(MIG, bak)).mode & 0o077) === 0);
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
