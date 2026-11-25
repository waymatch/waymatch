// Accessibilità (WCAG 2.1 A/AA + buone pratiche) con axe-core in Chromium, sulle schermate
// principali e nei vari stati (schede, finestre, menu da telefono), più prove da tastiera.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { BACKEND, cartellaProva } = createRequire(import.meta.url)('./ambiente.js');
const require = createRequire(BACKEND + '/server.js');
const Database = require('better-sqlite3-multiple-ciphers');
const AXE = fs.readFileSync(path.join(BACKEND, 'node_modules/axe-core/axe.min.js'), 'utf8');
const CHROME = process.env.CHROME_PATH || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const DIR = cartellaProva('accessibilita');
fs.mkdirSync(path.join(DIR, 'chrome'), { recursive: true });
const PORT = 4983, ORIGINE = `http://127.0.0.1:${PORT}`;
const KEY = crypto.randomBytes(32).toString('hex'), PW = 'Password-Valida-123!';
const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
let ip = 1;
async function api(m, p, { token, body } = {}) {
  const h = { 'X-Forwarded-For': `10.83.0.${ip++ % 250}` }; if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(ORIGINE + '/api' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(d)}`); return d;
}
class Cdp { constructor(ws) { this.ws = ws; this.id = 0; this.a = new Map(); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.a.has(m.id)) { const { ok, ko } = this.a.get(m.id); this.a.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); } }); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return new Promise((ok, ko) => this.a.set(id, { ok, ko })); } }

const server = spawn('node', ['server.js'], { cwd: BACKEND, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'), JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: KEY, DB_ENCRYPTION_KEY_FILE: '', SMTP_HOST: '' } });
// Chromium sulle macchine condivise della CI a volte non parte al primo colpo: si riprova con un
// profilo nuovo, e l'output del browser finisce nell'errore se non risponde mai.
let chrome = null;
let logChrome = '';
const avviaChrome = (n) => {
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=9335', `--user-data-dir=${path.join(DIR, `chrome-${n}`)}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', (d) => { logChrome += d; });
};
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(ORIGINE + '/api/health')).ok) break; } catch {} await attendi(100); }
  let ws;
  for (let tentativo = 1; tentativo <= 3 && !ws; tentativo++) {
    if (chrome) {
      // Si aspetta che il browser precedente sia davvero uscito (al massimo 5 s, poi SIGKILL):
      // altrimenti la porta 9335 potrebbe rispondere ancora con il suo WebSocket.
      const vecchio = chrome;
      const uscito = new Promise((r) => { if (vecchio.exitCode !== null || vecchio.signalCode !== null) r(); else vecchio.once('exit', r); });
      vecchio.kill();
      await Promise.race([uscito, attendi(5000)]);
      if (vecchio.exitCode === null && vecchio.signalCode === null) { vecchio.kill('SIGKILL'); await Promise.race([uscito, attendi(2000)]); }
    }
    avviaChrome(tentativo);
    for (let i = 0; i < 100 && !ws; i++) { try { ws = (await (await fetch('http://127.0.0.1:9335/json/version')).json()).webSocketDebuggerUrl; } catch { await attendi(200); } }
  }
  if (!ws) throw new Error(`Chromium non risponde sulla porta 9335. Output:\n${logChrome.slice(-1500)}`);
  const sock = new WebSocket(ws); await new Promise((r) => sock.addEventListener('open', r)); const cdp = new Cdp(sock);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, s); await cdp.send('Runtime.enable', {}, s); await cdp.send('Page.bringToFront', {}, s);
  const valuta = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, s)).result.value;
  const vai = async (u, ms = 2200) => { await cdp.send('Page.navigate', { url: ORIGINE + u }, s); await attendi(ms); };
  const tasto = async (key, code) => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code: code || key, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0 }, s); await attendi(150); };
  const desk = () => cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, s);
  const mob = () => cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
  const clicca = async (t) => {
    const trovato = await valuta(`(() => { const b = [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim().includes(${JSON.stringify(t)})); if (b) { b.click(); return true; } return false; })()`);
    // Se il controllo non c'è (o ha cambiato etichetta) la scansione successiva analizzerebbe la pagina di prima.
    if (trovato !== true) check(`trovato il controllo «${t}»`, false);
    return trovato;
  };
  const entra = async (token) => { await vai('/login', 600); await valuta(`localStorage.setItem('carpooling_token', ${JSON.stringify(token)}); localStorage.setItem('push_prompt_dismesso','1'); localStorage.setItem('pwa_install_dismesso','1')`); };
  const analizza = async (nome) => {
    await valuta(AXE);
    const v = await valuta(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }).then((x) => x.violations.map((v) => v.id + ' (' + v.impact + ') x' + v.nodes.length + ' ' + v.nodes.slice(0, 2).map((n) => n.html.slice(0, 80)).join(' | ')))`);
    check(`${nome}: nessuna violazione`, v.length === 0, v.join(' ;; '));
  };

  console.log('\n[Configurazione iniziale]');
  await desk(); await vai('/', 2500); await analizza('setup');
  const setup = await api('POST', '/setup', { body: { company_name: 'Acme Mobility', nome: 'Giulia', cognome: 'Rossi', email: 'giulia@acme.example', password: PW,
    sedi: [{ nome: 'Milano', indirizzo: 'Via Torino 10', lat: 45.46, lon: 9.18 }, { nome: 'Bergamo', indirizzo: 'Via Camozzi 5', lat: 45.69, lon: 9.67 }] } });
  const mm = setup.token;
  await api('PUT', '/gamification', { token: mm, body: { attiva: true } }); // anche le pagine di punti e premi vanno controllate
  const sedi = (await api('GET', '/sedi', { token: mm })).sedi;
  for (const [n, c] of [['Marco', 'Bianchi'], ['Sara', 'Verdi']]) await api('POST', '/users', { token: mm, body: { nome: n, cognome: c, email: `${n.toLowerCase()}@acme.example`, password: PW, sede_id: sedi[0].id } });
  await api('POST', '/users', { token: mm, body: { nome: 'Nina', cognome: 'Nuova', email: 'nina@acme.example', password: PW } });
  const d0 = new Database(path.join(DIR, 'data', 'carpooling.db')); d0.pragma(`key='${KEY}'`);
  d0.prepare("UPDATE users SET password_da_cambiare = 0 WHERE email != 'nina@acme.example'").run();
  const uid = (e) => d0.prepare('SELECT id FROM users WHERE email = ?').get(e).id;
  const data = new Date(Date.now() + 864e5 * 2).toISOString().slice(0, 10);
  const r1 = d0.prepare(`INSERT INTO rides (driver_id, sede_id, tipo, data, ora, punto_partenza, punto_arrivo, partenza_lat, partenza_lon, arrivo_lat, arrivo_lon, km_stimati, posti_totali, posti_disponibili) VALUES (?, ?, 'andata', ?, '08:00', 'Via Roma 1', 'Milano', 45.6, 9.5, 45.46, 9.18, 30, 3, 2)`).run(uid('marco@acme.example'), sedi[0].id, data).lastInsertRowid;
  d0.prepare("INSERT INTO bookings (ride_id, passenger_id, stato) VALUES (?, ?, 'richiesto')").run(r1, uid('sara@acme.example'));
  d0.close();
  await api('POST', '/rewards', { token: mm, body: { nome: 'Buono caffè', descrizione: 'Un caffè', punti_richiesti: 50, tipo: 'fisico' } }).catch(() => {});
  const tok = async (e, p = PW) => (await api('POST', '/auth/login', { body: { email: e, password: p } })).token;
  const marco = await tok('marco@acme.example'), nina = await tok('nina@acme.example');

  console.log('\n[Accesso]');
  await vai('/login', 2000); await analizza('login');
  await clicca('Password dimenticata'); await attendi(400); await analizza('login: recupero password');
  await vai('/reimposta-password?token=prova', 1500); await analizza('reimposta password');
  await entra(nina); await vai('/', 2500); await analizza('cambio password obbligatorio (finestra)');
  check('la finestra del cambio password è un dialog con titolo', await valuta(`(() => { const d = document.querySelector('[role=dialog]'); return !!d && !!document.getElementById(d.getAttribute('aria-labelledby')); })()`) === true);
  check('il focus è dentro la finestra', await valuta(`!!document.activeElement.closest('[role=dialog]')`) === true);

  console.log('\n[Utente: schermate]');
  await entra(marco);
  for (const u of ['/', '/offri', '/cerca', '/i-miei-viaggi', '/premi', '/profilo', '/informazioni']) { await vai(u, 2400); await analizza(u); }
  await vai('/offri', 2000); await clicca('Andata e ritorno'); await attendi(500); await analizza('/offri: andata e ritorno');
  await clicca('Turno fisso'); await attendi(500); await analizza('/offri: turno fisso');
  for (const scheda of ['La tua auto', 'Notifiche', 'Documenti', 'Privacy', 'Sicurezza']) { await vai('/profilo', 1800); await clicca(scheda); await attendi(700); await analizza(`/profilo: ${scheda}`); }
  for (const scheda of ['Novità e storia', 'Il progetto']) { await vai('/informazioni', 1800); await clicca(scheda); await attendi(500); await analizza(`/informazioni: ${scheda}`); }
  await vai('/i-miei-viaggi', 2000); for (const t of ['Turni fissi', 'Storico']) { await clicca(t); await attendi(600); await analizza(`/i-miei-viaggi: ${t}`); }

  console.log('\n[Mobility Manager: schermate]');
  await entra(mm);
  for (const u of ['/admin/utenti', '/admin/impostazioni', '/admin/sedi', '/admin/premi', '/report', '/admin/punteggio', '/admin/documenti', '/admin/log', '/admin/approvazioni', '/admin/contest', '/admin/cancellazioni', '/admin/reset-password']) { await vai(u, 2200); await analizza(u); }
  for (const scheda of ['Validazione viaggi', 'Calendario', 'Costi e CO2', 'Gamification', 'Email']) { await vai('/admin/impostazioni', 1800); await clicca(scheda); await attendi(700); await analizza(`/admin/impostazioni: ${scheda}`); }
  await vai('/admin/impostazioni', 1800); await clicca('Gamification'); await attendi(700); await clicca('Azzera i punteggi'); await attendi(500); await analizza('/admin/impostazioni: finestra di azzeramento dei punteggi');
  await vai('/informazioni', 1800); for (const t of ['Guida Mobility Manager', 'Sistema']) { await clicca(t); await attendi(700); await analizza(`/informazioni: ${t}`); }

  console.log('\n[Telefono]');
  await mob(); await entra(marco);
  await vai('/', 2400); await analizza('home (telefono)');
  await valuta(`document.querySelector('button[aria-label="Apri il menu"]').click()`); await attendi(500); await analizza('menu (telefono)');
  await vai('/informazioni', 2000); await analizza('informazioni (telefono)');
  await desk();

  console.log('\n[Tastiera]');
  await entra(marco); await vai('/', 2200);
  await valuta('document.body.focus(); document.activeElement.blur()');
  await tasto('Tab');
  check('il primo Tab porta al link "Salta al contenuto"', await valuta(`document.activeElement.textContent.trim() === 'Salta al contenuto'`) === true);
  await tasto('Enter');
  await valuta(`document.querySelector('#contenuto').scrollIntoView()`);
  check('"Salta al contenuto" esiste e punta al contenuto principale', await valuta(`!!document.querySelector('a[href="#contenuto"]') && !!document.querySelector('main#contenuto')`) === true);
  check('il pulsante delle notifiche ha un nome', await valuta(`[...document.querySelectorAll('button')].some((b) => /^Notifiche/.test(b.getAttribute('aria-label') || ''))`) === true);
  await clicca('Offerta rapida'); await attendi(600);
  check('"Offerta rapida" si apre come finestra (dialog) con il focus dentro', await valuta(`!!document.querySelector('[role=dialog][aria-modal=true]') && !!document.activeElement.closest('[role=dialog]')`) === true);
  for (let i = 0; i < 25; i++) await tasto('Tab');
  check('con Tab il focus non esce dalla finestra', await valuta(`!!document.activeElement.closest('[role=dialog]')`) === true);
  await tasto('Escape');
  check('Esc chiude la finestra', await valuta(`!document.querySelector('[role=dialog]')`) === true);
  sock.close();
} catch (e) {
  check('il test non deve fallire per errori', false, e.message);
} finally {
  chrome?.kill(); server.kill();
  console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
  if (esito.ko) process.exitCode = 1;
}
