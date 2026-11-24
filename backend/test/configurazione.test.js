// Pubblicazione del progetto: il server non parte con segreti deboli o d'esempio, il
// frontend non chiama servizi esterni per i font, i file del progetto ci sono.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BACKEND, FRONTEND, cartellaProva } = require('./ambiente');

const RADICE = path.resolve(BACKEND, '..');
const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

// Avvia il server con un JWT_SECRET dato; "parte" se dopo 3 secondi è ancora in vita.
function avvia(jwtSecret, nome, extra = {}) {
  const dir = cartellaProva(nome);
  const r = spawnSync('node', ['server.js'], {
    cwd: BACKEND, timeout: 3000, encoding: 'utf8',
    env: { ...process.env, PORT: '4993', DATA_DIR: path.join(dir, 'data'), UPLOAD_DIR: path.join(dir, 'uploads'),
      JWT_SECRET: jwtSecret, DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY_FILE: '', TILE_URL: '', TILE_ATTRIBUTION: '', SMTP_HOST: '', ...extra },
  });
  return { partito: r.error && r.error.code === 'ETIMEDOUT', uscita: (r.stderr || '') + (r.stdout || '') };
}

(async () => {
console.log('\n[Segreto JWT]');
let r = avvia('cambia-questo-secret-in-produzione', 's1');
check('il valore di .env.example viene rifiutato', !r.partito && /JWT_SECRET non valido/.test(r.uscita));
r = avvia('troppo-corto', 's2');
check('un segreto corto viene rifiutato', !r.partito && /JWT_SECRET non valido/.test(r.uscita));
r = avvia(crypto.randomBytes(32).toString('hex'), 's3');
check('un segreto casuale di 64 caratteri è accettato', r.partito, r.uscita.slice(0, 200));

console.log('\n[Provider dei tile configurabile]');
const SEGRETO = crypto.randomBytes(32).toString('hex');
r = avvia(SEGRETO, 't1', { TILE_URL: 'https://esempio.it/tile/{z}/{x}.png', TILE_ATTRIBUTION: 'x' });
check('TILE_URL senza {y} viene rifiutato', !r.partito && /manca \{y\}/.test(r.uscita), r.uscita.slice(0, 120));
r = avvia(SEGRETO, 't2', { TILE_URL: 'ftp://esempio.it/{z}/{x}/{y}.png', TILE_ATTRIBUTION: 'x' });
check('TILE_URL non http(s) viene rifiutato', !r.partito && /TILE_URL non valido/.test(r.uscita));
r = avvia(SEGRETO, 't3', { TILE_URL: 'https://esempio.it/{z}/{x}/{y}.png' });
check('TILE_URL personalizzato senza attribuzione viene rifiutato', !r.partito && /TILE_ATTRIBUTION mancante/.test(r.uscita));

async function conServer(extra, nome, porta, fn) {
  const dir = cartellaProva(nome);
  const srv = spawn('node', ['server.js'], {
    cwd: BACKEND, stdio: 'ignore',
    env: { ...process.env, PORT: String(porta), DATA_DIR: path.join(dir, 'data'), UPLOAD_DIR: path.join(dir, 'uploads'),
      JWT_SECRET: SEGRETO, DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY_FILE: '', TILE_URL: '', TILE_ATTRIBUTION: '', SMTP_HOST: '', ...extra },
  });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${porta}/api/health`)).ok) break; } catch {} await new Promise((x) => setTimeout(x, 100)); }
    return await fn(`http://127.0.0.1:${porta}`);
  } finally { srv.kill(); }
}
const csp = (res) => res.headers.get('content-security-policy') || '';
await conServer({}, 't4', 4990, async (base) => {
  const b = (await (await fetch(base + '/api/branding')).json()).branding;
  check('predefinito: OpenStreetMap con attribuzione', /tile\.openstreetmap\.org/.test(b.mappa.url) && /OpenStreetMap/.test(b.mappa.attribuzione), b.mappa.url);
  const c = csp(await fetch(base + '/api/branding'));
  check('predefinito: la CSP ammette solo il provider dei tile', /img-src[^;]*tile\.openstreetmap\.org/.test(c) && !/arcgisonline/.test(c));
});
await conServer({ SMTP_HOST: 'smtp.esempio.it' }, 't7', 4987, async (base) => {
  check('con SMTP configurato email_attive è true', (await (await fetch(base + '/api/branding')).json()).branding.email_attive === true);
});
await conServer({}, 't8', 4986, async (base) => {
  check('senza SMTP email_attive è false', (await (await fetch(base + '/api/branding')).json()).branding.email_attive === false);
});
await conServer({ TILE_URL: 'https://tiles.provider.example/v1/{z}/{x}/{y}.png?key=abc', TILE_ATTRIBUTION: '&copy; Provider', TILE_MAX_ZOOM: '18' }, 't5', 4989, async (base) => {
  const b = (await (await fetch(base + '/api/branding')).json()).branding;
  check('personalizzato: url, attribuzione e zoom arrivano al frontend', b.mappa.url.includes('tiles.provider.example') && b.mappa.attribuzione === '&copy; Provider' && b.mappa.maxZoom === 18);
  const c = csp(await fetch(base + '/api/branding'));
  check('personalizzato: la CSP ammette il suo host e non quello di OSM', /img-src[^;]*tiles\.provider\.example/.test(c) && !/openstreetmap/.test(c));
});

console.log('\n[Colonna mappa_stile rimossa dai database esistenti]');
{
  const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3-multiple-ciphers'));
  const dir = cartellaProva('t6');
  const chiave = crypto.randomBytes(32).toString('hex');
  const env = { ...process.env, PORT: '4988', DB_ENCRYPTION_KEY_FILE: '', TILE_URL: '', TILE_ATTRIBUTION: '', DATA_DIR: path.join(dir, 'data'), UPLOAD_DIR: path.join(dir, 'uploads'), JWT_SECRET: SEGRETO, DB_ENCRYPTION_KEY: chiave, SMTP_HOST: '' };
  const colonne = () => { const d = new Database(path.join(dir, 'data', 'carpooling.db')); d.pragma(`key='${chiave}'`); const c = d.prepare('PRAGMA table_info(system_settings)').all().map((x) => x.name); d.close(); return c; };
  spawnSync('node', ['server.js'], { cwd: BACKEND, timeout: 3000, env });
  {
    const d = new Database(path.join(dir, 'data', 'carpooling.db')); d.pragma(`key='${chiave}'`);
    d.exec("ALTER TABLE system_settings ADD COLUMN mappa_stile TEXT DEFAULT 'topo'"); d.close();
  }
  check('prima: il vecchio database ha la colonna', colonne().includes('mappa_stile'));
  spawnSync('node', ['server.js'], { cwd: BACKEND, timeout: 3000, env });
  check('dopo l\'avvio la colonna non c\'è più', !colonne().includes('mappa_stile'));
  check('le altre colonne sono intatte', colonne().includes('company_name') && colonne().includes('primary_color'));
  const r2 = spawnSync('node', ['server.js'], { cwd: BACKEND, timeout: 3000, env, encoding: 'utf8' });
  check('un secondo avvio funziona (nessun errore)', r2.error && r2.error.code === 'ETIMEDOUT' && !/Error/.test((r2.stderr || '')), (r2.stderr || '').slice(0, 100));
}

console.log('\n[Tile della mappa con il Referer]');
{
  // Con Referrer-Policy: no-referrer globale, OpenStreetMap risponde ai browser con la tile
  // "403 Access blocked". Le tile devono mandare l'origine del sito (e solo quella).
  const tl = fs.readFileSync(path.join(FRONTEND, 'src/components/MapTileLayers.jsx'), 'utf8');
  check('le tile mandano l\'origine del sito come Referer', /referrerPolicy="strict-origin-when-cross-origin"/.test(tl));
  check('nessun\'altra immagine di tile fuori da MapTileLayers', !fs.readdirSync(path.join(FRONTEND, 'src'), { recursive: true })
    .filter((f) => /\.(jsx?|mjs)$/.test(f) && !f.endsWith('MapTileLayers.jsx'))
    .some((f) => /<TileLayer\b/.test(fs.readFileSync(path.join(FRONTEND, 'src', f), 'utf8'))));
}

console.log('\n[Nessuna chiamata a servizi esterni per i font]');
const html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');
check('index.html non punta a Google Fonts', !/fonts\.(googleapis|gstatic)\.com/.test(html));
await conServer({}, 't-csp', 4986, async (base) => {
  const c = csp(await fetch(base + '/api/branding'));
  check('la CSP (header reale) è presente', c.length > 0);
  check('la CSP non ammette Google Fonts', !/fonts\.(googleapis|gstatic)\.com/.test(c));
});

console.log('\n[Nessuna richiesta di denaro]');
{
  const filtra = (f) => !/node_modules|package-lock|public\/|docs\/img|assets\/brand|CHANGELOG/.test(f);
  const elenco = [];
  (function scan(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', '.git', 'backups', 'public'].includes(e.name)) scan(p); } else if (/\.(jsx?|mjs|md|yml|json|html)$/.test(e.name) && filtra(p)) elenco.push(p); } })(RADICE);
  const trovati = elenco.filter((f) => !/PRICING\.md|ADOPTERS\.md|[\\/]test[\\/]/.test(f) && /paypal|dona con|sostieni il progetto/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(RADICE, f));
  check('nessun PayPal, "Dona con" né richiesta di donazioni al progetto', trovati.length === 0, trovati.join(', '));
  check('non esiste .github/FUNDING.yml (nessun pulsante Sponsor)', !fs.existsSync(path.join(RADICE, '.github/FUNDING.yml')));
  const pr = fs.readFileSync(path.join(RADICE, 'PRICING.md'), 'utf8');
  check('PRICING.md dice che non è una condizione della licenza e che non si chiedono ricevute', /non è una condizione della\s+licenza/.test(pr) && /Non la voglio e non la raccolgo/.test(pr));
  check('PRICING.md non presenta gli alberi come compensazione della CO2', /Non è una compensazione della CO2/.test(pr));
}

console.log('\n[README da vetrina]');
{
  const rd = fs.readFileSync(path.join(RADICE, 'README.md'), 'utf8');
  check('README breve (sotto le 160 righe): il dettaglio sta in docs/', rd.split('\n').length < 160, String(rd.split('\n').length));
  const tutto = ['README.md', 'docs/sicurezza.md', 'docs/funzionalita.md', 'docs/installazione.md'].map((f) => fs.readFileSync(path.join(RADICE, f), 'utf8')).join('\n');
  check('nessuna frase superata sui dati "in chiaro nel database"', !/sono invece in chiaro\s+nel database/.test(tutto));
  check('nessun percorso di menu superato ("pannello Branding", "Admin → Email")', !/pannello Branding|Admin → Email/.test(tutto));
}

console.log('\n[File del progetto]');
{
  // Ogni immagine e ogni link relativo delle guide deve esistere.
  const mancanti = [];
  for (const f of ['README.md', ...fs.readdirSync(path.join(RADICE, 'docs')).filter((x) => x.endsWith('.md')).map((x) => 'docs/' + x)]) {
    const testo = fs.readFileSync(path.join(RADICE, f), 'utf8');
    for (const m of testo.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      if (!fs.existsSync(path.resolve(RADICE, path.dirname(f), m[1]))) mancanti.push(`${f} → ${m[1]}`);
    }
  }
  check('i link e le immagini relative di README e docs esistono', mancanti.length === 0, mancanti.join('; '));
}
for (const f of ['LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'PRICING.md', 'ADOPTERS.md', '.github/ISSUE_TEMPLATE/adozione.yml', '.github/ISSUE_TEMPLATE/segnalazione.yml', '.github/workflows/test.yml',
  'docs/README.md', 'docs/guida-utente.md', 'docs/guida-mobility-manager.md', 'docs/installazione.md', 'docs/tile-self-hosted.md', 'docs/sviluppo.md', 'docs/novita.md', 'docs/funzionalita.md', 'docs/sicurezza.md', 'README.en.md',
  'scripts/backup.sh', 'scripts/ripristina.sh', 'docker-compose.produzione.yml', 'Caddyfile']) {
  check(`${f} presente`, fs.existsSync(path.join(RADICE, f)));
}
const licenza = fs.existsSync(path.join(RADICE, 'LICENSE')) ? fs.readFileSync(path.join(RADICE, 'LICENSE'), 'utf8') : '';
check('LICENSE è PolyForm Internal Use con la nota di copyright', /^Required Notice: Copyright .*Andrea Crestani/m.test(licenza) && /PolyForm Internal Use License 1\.0\.0/.test(licenza));
const ignore = fs.readFileSync(path.join(RADICE, '.gitignore'), 'utf8');
check('.gitignore esclude PROFILO.md e .env', /^PROFILO\.md$/m.test(ignore) && /^\.env$/m.test(ignore));

console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
if (esito.ko) process.exitCode = 1;
})();
