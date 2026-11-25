// Scenario completo (logo, template voucher, voucher riscattato, PDF legale) su istanza
// isolata, poi verifica in Chromium headless via DevTools Protocol, senza librerie esterne.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { BACKEND, cartellaProva } = createRequire(import.meta.url)('./ambiente.js');
const require = createRequire(BACKEND + '/server.js');
const Database = require('better-sqlite3-multiple-ciphers');
const { Jimp } = require('jimp');
const PDFDocument = require('pdfkit');
const CHROME = process.env.CHROME_PATH || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const DIR = cartellaProva('upload-browser');
for (const d of ['chrome']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
const PORT = 4996;
const ORIGINE = `http://127.0.0.1:${PORT}`;
const DB_KEY = crypto.randomBytes(32).toString('hex');
const PW = 'Password-Valida-123!';
const VERSIONE_APP = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8')).version;
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const jwt = require('jsonwebtoken');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
let ipN = 1;

async function api(metodo, p, { token, body, form } = {}) {
  const headers = { 'X-Forwarded-For': `10.3.0.${ipN++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(ORIGINE + '/api' + p, { method: metodo, headers, body: payload });
  let data = null; try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(`${metodo} ${p} → ${r.status} ${JSON.stringify(data)}`);
  return data;
}
async function png(colore, w = 600, h = 300) {
  return new Jimp({ width: w, height: h, color: colore }).getBuffer('image/png');
}
function pdf() {
  return new Promise((ok) => {
    const doc = new PDFDocument();
    const parti = [];
    doc.on('data', (c) => parti.push(c));
    doc.on('end', () => ok(Buffer.concat(parti)));
    doc.text('Informativa privacy di prova');
    doc.end();
  });
}
const conFile = (campo, buf, nome, tipo, extra = {}) => {
  const f = new FormData();
  f.append(campo, new Blob([buf], { type: tipo }), nome);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};

// --- Client DevTools minimale ---
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.attese = new Map(); this.ascolti = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.attese.has(m.id)) { const { ok, ko } = this.attese.get(m.id); this.attese.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); }
      else for (const a of this.ascolti) a(m);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, ko) => this.attese.set(id, { ok, ko }));
  }
  on(f) { this.ascolti.push(f); }
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET, DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(ORIGINE + '/api/health')).ok) break; } catch {} await attendi(100); }

  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=9333',
    `--user-data-dir=${path.join(DIR, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let logChrome = ''; chrome.stderr.on('data', (d) => { logChrome += d; });
  chrome.on('error', (e) => { logChrome += `errore di avvio: ${e.message}`; });

  try {
    // --- Scenario ---
    const mm = (await api('POST', '/setup', { body: { company_name: 'Prova', nome: 'Admin', cognome: 'MM', email: 'mm@test.it', password: PW } })).token;
    await api('PUT', '/auth/me', { token: mm, body: {} });
    await api('PUT', '/gamification', { token: mm, body: { attiva: true } }); // premi e voucher: servono accesi
    const sede = await api('POST', '/sedi', { token: mm, body: { nome: 'Sede', indirizzo: 'Via Roma 1' } }).catch(() => null);
    await api('POST', '/users', { token: mm, body: { nome: 'Ugo', cognome: 'Utente', email: 'ugo@test.it', password: PW } });
    const logo = await api('POST', '/branding/logo', { token: mm, form: conFile('logo', await png(0x0e7c66ff, 200, 80), 'logo.png', 'image/png') });
    const tpl = await api('POST', '/voucher-templates', { token: mm, form: conFile('immagine', await png(0xf5a623ff), 't.png', 'image/png', { nome: 'Template' }) });
    const templateId = (tpl.template || tpl).id || (await api('GET', '/voucher-templates', { token: mm })).templates[0].id;
    const premio = (await api('POST', '/rewards', { token: mm, body: { nome: 'Buono', punti_richiesti: 10, tipo: 'voucher_digitale', voucher_template_id: templateId } })).reward;
    const doc = (await api('POST', '/legal-documents', { token: mm, form: conFile('file', await pdf(), 'info.pdf', 'application/pdf', { titolo: 'Informativa', tipo: 'generale', formato: 'pdf' }) })).documento;

    let ugo = (await api('POST', '/auth/login', { body: { email: 'ugo@test.it', password: PW } }));
    // Prima di cambiare la password obbligatoria serve una password propria.
    ugo = { token: (await api('PUT', '/auth/me/password', { token: ugo.token, body: { password_attuale: PW, password_nuova: 'Ugo-Password-456!' } })).token };
    {
      const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
      d.prepare(`INSERT INTO manual_point_awards (user_id, assegnato_da, punti, motivo) VALUES (2, 1, 100, 'test')`).run();
      d.prepare(`UPDATE users SET password_da_cambiare = 0`).run();
      d.close();
    }
    const red = await api('POST', `/rewards/${premio.id}/redeem`, { token: ugo.token });
    await api('PUT', `/rewards/redemptions/${red.redemption_id}`, { token: mm, body: { stato: 'approvato' } });
    {
      const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
      d.prepare(`UPDATE users SET password_da_cambiare = 0`).run();
      d.close();
    }
    const tplPath = (await api('GET', '/voucher-templates', { token: mm })).templates[0].immagine_path;
    const docInfo = (await api('GET', '/legal-documents', { token: ugo.token })).documenti[0];
    console.log(`\nScenario: logo ${logo.logo_path}, template ${tplPath}, PDF ${docInfo.file_path}, voucher #${red.redemption_id}`);

    // --- Accesso diretto senza login ---
    console.log('\n[Accesso ai file senza login]');
    const stato = async (u) => (u ? (await fetch(ORIGINE + u)).status : 'n/a');
    const sLogo = await stato(logo.logo_path);
    const sTpl = await stato(tplPath);
    const sPdf = await stato(docInfo.file_path);
    check('logo pubblico', sLogo === 200, `HTTP ${sLogo}`);
    check('template voucher NON accessibile senza login', sTpl !== 200, `HTTP ${sTpl}`);
    check('PDF legale NON accessibile senza login', sPdf !== 200, `HTTP ${sPdf}`);
    for (const p of ['/uploads/', '/uploads/legal-documents/', '/uploads/voucher-templates/', '/uploads/../.env', '/uploads/%2e%2e/data/carpooling.db']) {
      const r = await fetch(ORIGINE + p);
      const corpo = r.status === 200 ? await r.text() : '';
      // Né un elenco di directory né il contenuto di file protetti (.env, database), qualunque sia lo stato.
      check(`nessun elenco o traversal su ${p}`, !/Index of|JWT_SECRET|DB_ENCRYPTION_KEY|SQLite format/.test(corpo), `HTTP ${r.status}`);
    }

    console.log('\n[Endpoint autenticati]');
    const raw = async (metodo, u, token) => {
      const r = await fetch(ORIGINE + u, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Forwarded-For': `10.4.0.${ipN++ % 250}` } });
      return { status: r.status, tipo: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', nosniff: r.headers.get('x-content-type-options'), disp: r.headers.get('content-disposition') || '', json: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
    };
    const tpls = (await api('GET', '/voucher-templates', { token: mm })).templates;
    const tplId = tpls[0].id;
    check('template: senza login 401', (await raw('GET', `/api/voucher-templates/${tplId}/immagine`)).status === 401);
    check('template: utente normale 403', (await raw('GET', `/api/voucher-templates/${tplId}/immagine`, ugo.token)).status === 403);
    const rt = await raw('GET', `/api/voucher-templates/${tplId}/immagine`, mm);
    check('template: Mobility Manager 200 image/png, no-store, nosniff', rt.status === 200 && rt.tipo === 'image/png' && rt.cache.includes('no-store') && rt.nosniff === 'nosniff', `${rt.status} ${rt.tipo} ${rt.cache}`);
    check('template: id inesistente 404', (await raw('GET', '/api/voucher-templates/9999/immagine', mm)).status === 404);
    check('nome file del template generato (UUID)', /^\/uploads\/voucher-templates\/[0-9a-f-]{36}\.png$/.test(tplPath), tplPath);
    check('nome file del PDF generato (UUID)', /^\/uploads\/legal-documents\/[0-9a-f-]{36}\.pdf$/.test(docInfo.file_path), docInfo.file_path);
    check('nome file del logo generato (UUID)', /^\/uploads\/[0-9a-f-]{36}\.png$/.test(logo.logo_path), logo.logo_path);

    const link = (await api('POST', `/legal-documents/${doc.id}/link`, { token: ugo.token })).url;
    const rp = await raw('GET', link);
    check('PDF: link firmato 200 application/pdf inline, no-store', rp.status === 200 && rp.tipo.includes('application/pdf') && rp.disp.startsWith('inline') && rp.cache.includes('no-store'), `${rp.status} ${rp.tipo} ${rp.disp}`);
    check('PDF: senza firma 401', (await raw('GET', `/api/legal-documents/${doc.id}/file`)).status === 401);
    check('PDF: firma alterata 401', (await raw('GET', link.slice(0, -3) + 'abc')).status === 401);
    check('PDF: con il solo token di accesso (senza firma) 401', (await raw('GET', `/api/legal-documents/${doc.id}/file`, ugo.token)).status === 401);
    const firmaScaduta = jwt.sign({ doc: doc.id }, JWT_SECRET, { audience: 'file-documento-legale', subject: '2', expiresIn: -10 });
    check('PDF: link scaduto 401', (await raw('GET', `/api/legal-documents/${doc.id}/file?firma=${firmaScaduta}`)).status === 401);
    const firmaAltroScopo = jwt.sign({ doc: doc.id }, JWT_SECRET, { audience: 'altro', subject: '2', expiresIn: 60 });
    check('PDF: firma con altro scopo 401', (await raw('GET', `/api/legal-documents/${doc.id}/file?firma=${firmaAltroScopo}`)).status === 401);
    const firmaToken = new URL(ORIGINE + link).searchParams.get('firma');
    check('PDF: la firma non vale come token di accesso', (await raw('GET', '/api/auth/me', firmaToken)).status === 401);
    const doc2 = (await api('POST', '/legal-documents', { token: mm, form: conFile('file', await pdf(), 'b.pdf', 'application/pdf', { titolo: 'Secondo', tipo: 'conducente', formato: 'pdf' }) })).documento;
    check('PDF: firma di un documento usata su un altro 401', (await raw('GET', `/api/legal-documents/${doc2.id}/file?firma=${firmaToken}`)).status === 401);
    await api('DELETE', `/legal-documents/${doc2.id}`, { token: mm });
    check('PDF disattivato: utente non ottiene il link', (await raw('POST', `/api/legal-documents/${doc2.id}/link`, ugo.token)).status === 404);
    const linkMm = (await api('POST', `/legal-documents/${doc2.id}/link`, { token: mm })).url;
    check('PDF disattivato: il Mobility Manager lo vede ancora', (await raw('GET', linkMm)).status === 200);
    check('PDF: senza login nessun link', (await raw('POST', `/api/legal-documents/${doc.id}/link`)).status === 401);

    // --- Browser ---
    let ws;
    for (let i = 0; i < 50 && !ws; i++) {
      try { ws = (await (await fetch('http://127.0.0.1:9333/json/version')).json()).webSocketDebuggerUrl; } catch { await attendi(200); }
    }
    if (!ws) throw new Error(`Chromium non risponde sulla porta 9333. Output:\n${logChrome.slice(-1500)}`);
    const sock = new WebSocket(ws);
    await new Promise((r) => sock.addEventListener('open', r));
    const cdp = new Cdp(sock);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const nuoveSchede = [];
    cdp.on((m) => { if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') nuoveSchede.push(m.params.targetInfo.url); if (m.method === 'Target.targetInfoChanged' && m.params.targetInfo.type === 'page') nuoveSchede.push(m.params.targetInfo.url); });

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const errori = [];
    const cspLog = [];
    cdp.on((m) => {
      if (m.sessionId !== s) return;
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errori.push(`${m.params.response.status} ${m.params.response.url.replace(ORIGINE, '')}`);
      if (m.method === 'Runtime.exceptionThrown') errori.push('JS: ' + m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded' && /Content Security Policy/i.test(m.params.entry.text)) cspLog.push(m.params.entry.text.slice(0, 160));
    });
    await cdp.send('Page.enable', {}, s);
    await cdp.send('Network.enable', {}, s);
    await cdp.send('Runtime.enable', {}, s);
    await cdp.send('Log.enable', {}, s);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.effectiveDirective+' '+e.blockedURI))` }, s);
    const valuta = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s)).result.value;
    const vai = async (u) => { await cdp.send('Page.navigate', { url: ORIGINE + u }, s); await attendi(2500); };
    // Clic con eventi mouse veri: contano come gesto dell'utente (necessario per aprire schede).
    const cliccaSe = async (condizione) => {
      const r = await valuta(`(() => { const b = [...document.querySelectorAll('button,a')].find((x) => ${condizione}); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
      if (!r) return false;
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, s);
      return true;
    };
    const clicca = (testo) => cliccaSe(`x.textContent.includes(${JSON.stringify(testo)})`);
    const immagineCaricata = (sel) => valuta(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); return i ? (i.complete && i.naturalWidth > 0) : null; })()`);
    const csp = () => valuta('window.__csp || []');
    const entraCome = async (token) => { await vai('/login'); await valuta(`localStorage.setItem('carpooling_token', ${JSON.stringify(token)})`); };

    console.log('\n[Pagina di login, senza accesso]');
    await vai('/login');
    check('logo visibile nella pagina di login', await immagineCaricata('img[alt^="Logo"], img[alt="WayMatch"]') === true);

    console.log('\n[Senza SMTP l\'app lo dice (reset password e preferenze)]');
    {
      check('il server dichiara che le email non sono attive', (await api('GET', '/branding')).branding.email_attive === false);
      check('login: "Password dimenticata?" è presente', await clicca('Password dimenticata?'));
      await attendi(400);
      check('login: la richiesta spiega che risponde il Mobility Manager', await valuta(`document.body.innerText.includes('il Mobility Manager riceverà la richiesta')`) === true);
      await valuta(`(() => { const i = document.querySelector('input[type=email]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'chiunque@test.it'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await cliccaSe(`x.textContent.includes('Invia') || x.type === 'submit'`);
      await attendi(800);
      check('login: dopo l\'invio dice che le email non vengono inviate', await valuta(`document.body.innerText.includes('non vengono inviate email')`) === true);
      await valuta(`localStorage.removeItem('carpooling_token')`);
    }

    console.log('\n[Password provvisoria: cambio obbligato nel browser]');
    {
      await api('POST', '/users', { token: mm, body: { nome: 'Nina', cognome: 'Nuova', email: 'nina@test.it', password: PW } });
      const nina = await api('POST', '/auth/login', { body: { email: 'nina@test.it', password: PW } });
      await entraCome(nina.token);
      errori.length = 0;
      await vai('/');
      check('compare la richiesta di scegliere una nuova password', await valuta(`document.body.innerText.includes('Scegli una nuova password')`) === true);
      check('nessuna chiamata respinta dietro la finestra', !errori.some((e) => e.startsWith('403')), JSON.stringify(errori));
      // React legge il valore dal setter nativo: assegnare .value non basta.
      const compila = (valori) => valuta(`(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const campi = [...document.querySelectorAll('input[type=password]')];
        ${JSON.stringify(valori)}.forEach((v, i) => { set.call(campi[i], v); campi[i].dispatchEvent(new Event('input', { bubbles: true })); });
        return campi.length;
      })()`);
      // Clic veri sul bottone. Lo schermo di Chromium headless è basso (circa 440 px): con il
      // messaggio di errore la finestra lo supera, e il bottone deve restare raggiungibile.
      const invia = async () => {
        const r = await valuta(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Conferma e continua')); b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); const x = q.x + q.width / 2, y = q.y + q.height / 2; return document.elementFromPoint(x, y) === b ? { x, y } : null; })()`);
        check('bottone "Conferma e continua" visibile e raggiungibile', !!r);
        if (r) for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, s);
      };
      await compila([PW, 'Debole1!', 'Debole1!']);
      await invia(); await attendi(1500);
      check('password debole: rifiutata dal server con il messaggio dei requisiti', await valuta(`document.body.innerText.includes('Password non valida')`) === true, await valuta('document.body.innerText.slice(0, 400)'));
      await compila([PW, 'Nina-Password-789!', 'Nina-Password-789!']);
      await invia(); await attendi(2500);
      check('dopo il cambio la finestra sparisce e si entra nell\'app', await valuta(`!document.body.innerText.includes('Scegli una nuova password')`) === true, JSON.stringify(errori) + ' ' + await valuta('document.body.innerText.slice(0, 600)'));
      check('dopo il cambio le API rispondono', !!(await api('GET', '/notifications', { token: await valuta(`localStorage.getItem('carpooling_token')`) })));
    }

    console.log('\n[Utente: documento PDF da accettare al primo accesso]');
    await entraCome(ugo.token);
    await vai('/');
    const titoloGate = await valuta(`document.body.innerText.includes('Informativa')`);
    check('compare la richiesta di accettazione', titoloGate === true);
    errori.length = 0;
    await attendi(1500);
    const iframe = await valuta(`(() => { const f = document.querySelector('iframe'); if (!f) return null; let tipo = null; try { tipo = f.contentDocument && f.contentDocument.contentType; } catch (e) { tipo = 'inaccessibile'; } return { src: f.getAttribute('src'), tipo }; })()`);
    if (iframe !== null || !(await valuta(`!!document.querySelector('embed')`))) {
      const vi = await csp();
      check('anteprima PDF nella pagina (iframe) caricata come PDF, senza violazioni CSP',
        iframe && iframe.src.includes('/file?firma=') && iframe.tipo === 'application/pdf' && vi.length === 0 && !cspLog.length,
        `tipo=${iframe && iframe.tipo}, CSP ${JSON.stringify(vi)} ${JSON.stringify(cspLog)}`);
    }
    const haEmbed = await valuta(`!!document.querySelector('embed')`);
    if (haEmbed) {
      await attendi(1000);
      const v = await csp();
      check('anteprima PDF incorporata visibile', !v.some((x) => x.startsWith('object-src')), `violazioni CSP: ${JSON.stringify(v)}`);
    }
    nuoveSchede.length = 0;
    const cliccato = await clicca('Apri il PDF');
    await attendi(2000);
    const schedaPdf = nuoveSchede.find((u) => u && u !== 'about:blank' && !u.endsWith('/'));
    check('"Apri il PDF" apre il documento', cliccato && !!schedaPdf && !errori.some((e) => e.includes('legal')), `scheda: ${schedaPdf || 'nessuna'}${errori.length ? ', errori ' + errori.join(', ') : ''}`);
    if (schedaPdf && !schedaPdf.startsWith('blob:')) {
      const r = await fetch(schedaPdf.startsWith('http') ? schedaPdf : ORIGINE + schedaPdf);
      check('la scheda aperta riceve davvero il PDF', r.status === 200 && (r.headers.get('content-type') || '').includes('pdf'), `HTTP ${r.status} ${r.headers.get('content-type')}`);
    }
    await api('POST', `/legal-documents/${doc.id}/accept`, { token: ugo.token, body: { versione: doc.versione ?? 1 } });

    console.log('\n[Utente: voucher digitale in Premi]');
    await vai('/premi');
    errori.length = 0;
    await valuta('window.__csp = []');
    check('pulsante del voucher presente', await clicca('Visualizza voucher digitale'));
    await attendi(3000);
    const voucherOk = await immagineCaricata('img[alt^="Voucher"]');
    const vCsp = await csp();
    check('immagine del voucher visibile', voucherOk === true, `caricata=${voucherOk}, CSP ${JSON.stringify(vCsp)}, errori ${JSON.stringify(errori)}`);

    console.log('\n[Utente: documento PDF nel profilo]');
    await vai('/profilo');
    await clicca('Documenti');
    await attendi(800);
    await clicca('Visualizza il documento');
    await attendi(800);
    nuoveSchede.length = 0; errori.length = 0;
    const c2 = await clicca('Apri il PDF');
    await attendi(2000);
    const s2 = nuoveSchede.find((u) => u && u !== 'about:blank' && !u.endsWith('/profilo'));
    check('PDF apribile dal profilo', c2 && !!s2, `scheda: ${s2 || 'nessuna'}`);

    console.log('\n[Guida nell\'app: utente semplice]');
    {
      await vai('/informazioni');
      await cdp.send('Page.bringToFront', {}, s); // le immagini "lazy" non partono se la scheda è in secondo piano
      check('la pagina Informazioni si apre', await valuta(`document.body.innerText.includes('Guida, novità e informazioni su WayMatch')`) === true);
      check('mostra la versione dell\'app', await valuta(`/Versione \\d+\\.\\d+\\.\\d+/.test(document.body.innerText)`) === true);
      check('la guida per l\'utente ha il suo contenuto', await valuta(`document.body.innerText.includes('Primo accesso')`) === true);
      check('l\'utente semplice NON vede la guida del Mobility Manager né il Sistema', await valuta(`![...document.querySelectorAll('nav[aria-label="Sezioni"] button')].some((b) => /Mobility Manager|Sistema/.test(b.textContent))`) === true);
      // Le immagini sono caricate quando si scorre fino a loro (loading=lazy).
      await valuta(`(async () => { for (const i of document.querySelectorAll('img')) { i.scrollIntoView(); await new Promise((r) => setTimeout(r, 250)); } })()`);
      await attendi(1200);
      const img = await valuta(`(() => { const t = [...document.querySelectorAll('img')].filter((i) => !i.alt.includes('Logo') && i.closest('.card')); return { n: t.length, ok: t.filter((i) => i.complete && i.naturalWidth > 0).length, src: t.slice(0, 2).map((i) => i.getAttribute('src') + ':' + i.complete + ':' + i.naturalWidth).join(',') }; })()`);
      check('gli screenshot della guida si vedono', img.n >= 5 && img.n === img.ok, JSON.stringify(img) + ' ' + (img.src || ''));
      check('niente HTML grezzo: i titoli sono titoli', await valuta(`document.querySelectorAll('h2').length >= 5`) === true);
      await clicca('Novità e storia'); await attendi(400);
      check('la pagina Novità mostra la versione corrente', await valuta(`document.body.innerText.includes('Versione ' + ${JSON.stringify(VERSIONE_APP)})`) === true);
      check('la voce Guida è nel menu', await valuta(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/informazioni')`) === true);
    }

    console.log('\n[Mobility Manager: anteprima template voucher]');
    await entraCome(mm);
    await api('POST', `/legal-documents/${doc.id}/accept`, { token: mm, body: { versione: doc.versione ?? 1 } });
    console.log('\n[Senza SMTP: preferenze notifiche]');
    {
      await vai('/profilo');
      check('profilo: scheda Notifiche apribile', await clicca('Notifiche'));
      await attendi(1200);
      check('profilo: le preferenze sono visibili', await valuta(`document.body.innerText.includes('Preferenze notifiche')`) === true);
      check('profilo: la casella "Email" delle notifiche non c\'è', await valuta(`![...document.querySelectorAll('label')].some((l) => l.textContent.trim() === 'Email')`) === true);
      check('profilo: la nota dice che le email non sono attive', await valuta(`document.body.innerText.includes('non vengono inviate email')`) === true);
    }
    await vai('/admin/premi');
    await clicca('Template grafici');
    await attendi(2000);
    const tplOk = await immagineCaricata('img[alt="Template"]');
    check('anteprima del template visibile', tplOk === true, `caricata=${tplOk}, CSP ${JSON.stringify(await csp())}`);

    console.log('\n[Guida nell\'app: Mobility Manager]');
    {
      await vai('/guida');
      check('/guida porta a Informazioni', await valuta(`location.pathname === '/informazioni'`) === true);
      check('il Mobility Manager vede la sua guida', await clicca('Guida Mobility Manager'));
      await attendi(500);
      check('con i giorni lavorativi spiegati', await valuta(`document.body.innerText.includes('giorni lavorativi')`) === true);
      check('il Mobility Manager vede Sistema', await clicca('Sistema'));
      await attendi(800);
      check('Sistema mostra versione e stato dei servizi', await valuta(`/Versione/.test(document.body.innerText) && /Email \\(SMTP\\)/.test(document.body.innerText) && /Giorni lavorativi/.test(document.body.innerText)`) === true);
      const sis = await raw('GET', '/api/sistema', mm);
      check('/api/sistema non contiene segreti', sis.status === 200 && !/secret|password|key|token/i.test(JSON.stringify(sis.json || '')), JSON.stringify(sis.json || '').slice(0, 120));
      check('/api/sistema è vietata a un utente semplice', (await raw('GET', '/api/sistema', ugo.token)).status === 403);
      check('la scheda Il progetto ha il link a GitHub e l\'invito a fare del bene, senza pagamenti', await clicca('Il progetto') && (await attendi(400), await valuta(`[...document.querySelectorAll('a')].some((a) => a.href.startsWith('https://github.com/')) && /Fai del bene a tua volta/.test(document.body.innerText) && !/paypal|dona con|donazion/i.test(document.body.innerHTML)`)) === true);
      await vai('/informazioni#mobility-manager/impostazioni-generali');
      await attendi(600);
      check('un link diretto apre la sezione giusta', await valuta(`(() => { const e = document.getElementById('impostazioni-generali'); return !!e && e.getBoundingClientRect().top < window.innerHeight; })()`) === true);
    }

    console.log('\n[Mobility Manager: logo nella barra laterale e nelle impostazioni]');
    await vai('/');
    check('logo nella barra laterale', await immagineCaricata('aside img[alt^="Logo"], img[alt="WayMatch"]') === true);
    await vai('/admin/impostazioni');
    check('logo nelle impostazioni', await immagineCaricata('img[alt^="Logo"], img[alt="WayMatch"]') === true);

    console.log('\n[Mobility Manager: PDF attuale nella gestione documenti]');
    await vai('/admin/documenti');
    await cliccaSe(`x.title === 'Modifica'`);
    await attendi(1000);
    const linkAdmin = await valuta(`[...document.querySelectorAll('a,button')].some((x) => /apri/i.test(x.textContent) )`);
    nuoveSchede.length = 0;
    const c3 = await cliccaSe(`x.textContent.trim().toLowerCase() === 'apri' || x.textContent.includes('Apri il PDF')`);
    await attendi(2000);
    const s3 = nuoveSchede.find((u) => u && u !== 'about:blank' && !u.includes('/admin/'));
    check('PDF apribile dalla gestione documenti', linkAdmin && c3 && !!s3, `scheda: ${s3 || 'nessuna'}`);

    console.log('\n[Sostituzione del logo e file con i nomi vecchi]');
    const logo2 = await api('POST', '/branding/logo', { token: mm, form: conFile('logo', await png(0x123456ff, 100, 40), 'nuovo.png', 'image/png') });
    check('nuovo logo pubblico', (await raw('GET', logo2.logo_path)).status === 200);
    check('vecchio logo non più servito', (await raw('GET', logo.logo_path)).status === 404);
    check('vecchio logo cancellato dal disco', !fs.existsSync(path.join(DIR, 'uploads', path.basename(logo.logo_path))));    fs.copyFileSync(path.join(DIR, 'uploads', path.basename(logo2.logo_path)), path.join(DIR, 'uploads', 'logo.jpg'));
    fs.copyFileSync(path.join(DIR, 'uploads', 'voucher-templates', path.basename(tplPath)), path.join(DIR, 'uploads', 'voucher-templates', 'template-1789719388835.jpg'));
    {
      const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
      d.prepare(`UPDATE system_settings SET logo_path = '/uploads/logo.jpg' WHERE id = 1`).run();
      d.prepare(`INSERT INTO voucher_templates (nome, immagine_path) VALUES ('Vecchio', '/uploads/voucher-templates/template-1789719388835.jpg')`).run();
      d.close();
    }
    check('logo con il nome vecchio (logo.jpg) ancora pubblico', (await raw('GET', '/uploads/logo.jpg')).status === 200);
    const vecchio = (await api('GET', '/voucher-templates', { token: mm })).templates.find((t) => t.nome === 'Vecchio');
    const rv = await raw('GET', `/api/voucher-templates/${vecchio.id}/immagine`, mm);
    check('template con il nome vecchio servito dall\'API come image/jpeg', rv.status === 200 && rv.tipo === 'image/jpeg', `${rv.status} ${rv.tipo}`);
    check('template con il nome vecchio non pubblico', (await raw('GET', '/uploads/voucher-templates/template-1789719388835.jpg')).status === 404);
    check('/uploads/<nome del template> non pubblico', (await raw('GET', '/uploads/template-1789719388835.jpg')).status === 404);
    {
      const logo3 = await api('POST', '/branding/logo', { token: mm, form: conFile('logo', await png(0x654321ff, 100, 40), 'terzo.png', 'image/png') });
      const rimozione = await raw('DELETE', '/api/branding/logo', mm);
      check('il logo si rimuove: niente più logo nel branding e file cancellato', rimozione.status === 200 && (await api('GET', '/branding')).branding.logo_path === null
        && !fs.existsSync(path.join(DIR, 'uploads', path.basename(logo3.logo_path))));
      check('un utente semplice non rimuove il logo', (await raw('DELETE', '/api/branding/logo', ugo.token)).status === 403);
    }


    console.log('\n[Foto del profilo: ritaglio nel browser]');
    {
      await entraCome(ugo.token);
      await vai('/profilo');
      const fileFoto = path.join(DIR, 'foto-larga.png');
      fs.writeFileSync(fileFoto, await png(0xcc3366ff, 900, 400));
      const { root } = await cdp.send('DOM.getDocument', {}, s);
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#foto-profilo-file' }, s);
      await cdp.send('DOM.setFileInputFiles', { nodeId, files: [fileFoto] }, s);
      await attendi(800);
      check('scelta una foto, si apre la finestra per ritagliarla', await valuta(`!!document.querySelector('[role=dialog] [aria-label^="Anteprima della foto"] img')`) === true);
      await valuta(`(() => { const r = document.querySelector('[role=dialog] input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r,'2'); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await attendi(200);
      check('l\'ingrandimento allarga la foto nell\'anteprima', await valuta(`parseFloat(document.querySelector('[role=dialog] [aria-label^="Anteprima"] img').style.width) > 1000`) === true);
      check('«Usa questa foto» carica il ritaglio', await clicca('Usa questa foto'));
      await attendi(1500);
      const me = await api('GET', '/auth/me', { token: ugo.token });
      check('la foto risulta caricata', me.user.foto_versione === 1, JSON.stringify(me.user.foto_versione));
      check('e compare nel menu', await immagineCaricata('aside img[src^="blob:"]') === true);
      check('senza violazioni della CSP', (await csp()).length === 0, JSON.stringify(await csp()));
    }

    sock.close();
  } finally {
    chrome.kill(); server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1; // anche in esecuzione diretta, fuori da esegui.js
    const errLog = log.split('\n').filter((l) => l && (!l.startsWith('{"@timestamp') || /"livello":"(error|warn)"/.test(l)));
    if (errLog.length) console.log('--- log server ---\n' + errLog.slice(-20).join('\n'));
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
