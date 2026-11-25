// Lancia tutte le suite una dopo l'altra (npm test). Ogni suite avvia la propria istanza
// isolata del server su una porta dedicata, con database e uploads in una cartella
// temporanea che viene cancellata alla fine.
//
// Uso: npm test                  tutte le suite
//      npm test -- accesso       solo le suite il cui nome contiene "accesso"
//
// La suite nel browser richiede Chromium (CHROME_PATH, altrimenti il percorso di
// Playwright in ~/.cache) e il frontend compilato: lo ricompila prima di partire, così
// prova il codice attuale. Senza Chromium viene saltata con un avviso.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BACKEND, FRONTEND } = require('./ambiente');

const SUITE = [
  { file: 'accesso.test.js', cosa: 'login, bcrypt, blocco, reset, import' },
  { file: 'sessioni.test.js', cosa: 'sessioni rinnovabili e revoca' },
  { file: 'client.test.mjs', cosa: 'rinnovo automatico in frontend/src/api.js' },
  { file: 'password-provvisoria.test.js', cosa: 'cambio della password provvisoria imposto dal server' },
  { file: 'configurazione.test.js', cosa: 'segreti, font, file del progetto (pubblicazione)' },
  { file: 'handler-async.test.js', cosa: 'errori negli handler async' },
  { file: 'limiti-e-anonimizzazione.test.js', cosa: 'limiti reset/setup, anonimizzazione atomica, Permissions-Policy' },
  { file: 'accessi-e-dati.test.js', cosa: 'sessioni oltre i limiti, cambio password, documenti per versione, CSV, anonimizzazione dei luoghi' },
  { file: 'regole-carpooling.test.js', cosa: 'prenotazioni, recapiti, turni fissi, premi e rimborsi, validazioni, endpoint push' },
  { file: 'ultimo-admin.test.js', cosa: 'ultimo Mobility Manager protetto' },
  { file: 'log.test.js', cosa: 'log tecnico (livelli, segreti oscurati, eventi di sicurezza) e filtri del log attività' },
  { file: 'foto-profilo.test.js', cosa: 'foto del profilo: cifrata, ridotta, senza metadati, accesso e rimozione, dati personali' },
  { file: 'gamification.test.js', cosa: 'gamification facoltativa: spenta sulle installazioni nuove, nessun punto né riscatto da spenta' },
  { file: 'aggiornamenti.test.js', cosa: 'avviso di nuova versione (release finta, nessuna chiamata a GitHub)' },
  { file: 'backup.test.js', cosa: 'backup del database cifrato (scripts/backup-db.js)' },
  { file: 'calendario.test.js', cosa: 'giorni lavorativi (domeniche e non solo)' },
  { file: 'brand.test.mjs', cosa: 'identità WayMatch, contrasto AA del tema' },
  { file: 'icona.test.js', cosa: 'icona e manifest dell\'app (logo, icona caricata, WayMatch)' },
  { file: 'accessibilita.test.mjs', cosa: 'accessibilità WCAG 2.1 AA con axe-core e prove da tastiera', browser: true },
  { file: 'export.test.js', cosa: 'formule negli export Excel' },
  { file: 'upload-browser.test.mjs', cosa: 'file caricati in Chromium', browser: true },
];

const CHROME = process.env.CHROME_PATH || `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const filtro = process.argv[2];
if (filtro && !SUITE.some((s) => s.file.includes(filtro))) {
  console.error(`Nessuna suite corrisponde a "${filtro}". Disponibili:\n  ${SUITE.map((s) => s.file).join('\n  ')}`);
  process.exit(1);
}
// Le suite non devono chiamare il servizio pubblico OSRM: un indirizzo locale chiuso fa fallire
// subito il calcolo dei km dal server, che ripiega sul limite di plausibilità. Chi vuole un
// percorso preciso avvia un OSRM finto (vedi regole-carpooling.test.js).
process.env.OSRM_URL ||= 'http://127.0.0.1:9';
// Né a GitHub per il controllo delle nuove versioni: lo prova aggiornamenti.test.js con una release finta.
process.env.CONTROLLO_AGGIORNAMENTI = '0';
const radice = fs.mkdtempSync(path.join(os.tmpdir(), 'carpooling-test-'));
const risultati = [];

try {
  for (const s of SUITE) {
    if (filtro && !s.file.includes(filtro)) continue;
    console.log(`\n=== ${s.file} — ${s.cosa}`);
    if (s.browser) {
      if (!fs.existsSync(CHROME)) {
        console.log(`    SALTATA: Chromium non trovato (${CHROME}). Imposta CHROME_PATH.`);
        risultati.push({ ...s, saltata: true });
        continue;
      }
      console.log('    compilo il frontend...');
      const build = spawnSync('npm', ['run', 'build'], { cwd: FRONTEND, encoding: 'utf8' });
      if (build.status !== 0) {
        console.log(build.stdout, build.stderr);
        risultati.push({ ...s, ok: 0, ko: 1 });
        continue;
      }
    }
    const r = spawnSync(process.execPath, [path.join(__dirname, s.file)], {
      cwd: BACKEND, encoding: 'utf8', env: { ...process.env, CP_TEST_DIR: radice, DB_ENCRYPTION_KEY_FILE: '', TILE_URL: '', TILE_ATTRIBUTION: '' }, timeout: 10 * 60 * 1000,
    });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    const m = /Risultato: (\d+) OK, (\d+) FAIL/.exec(r.stdout || '');
    const ok = m ? Number(m[1]) : 0;
    // Una suite che termina con errore senza riepilogo conta come fallita.
    const ko = m ? Number(m[2]) : 1;
    risultati.push({ ...s, ok, ko: r.status === 0 ? ko : Math.max(ko, 1) });
  }
} finally {
  fs.rmSync(radice, { recursive: true, force: true });
}

console.log('\n=== Riepilogo');
let totOk = 0, totKo = 0;
for (const r of risultati) {
  if (r.saltata) { console.log(`  SALTATA ${r.file}`); continue; }
  totOk += r.ok; totKo += r.ko;
  console.log(`  ${r.ko ? 'FAIL' : 'OK  '} ${r.file}: ${r.ok} OK, ${r.ko} FAIL`);
}
console.log(`  Totale: ${totOk} OK, ${totKo} FAIL`);
process.exitCode = totKo ? 1 : 0;
