// Icona e manifest dell'app: icona caricata > logo dell'azienda > icona WayMatch.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { BACKEND, cartellaProva } = require('./ambiente');
const { Jimp } = require(path.join(BACKEND, 'node_modules/jimp'));

const DIR = cartellaProva('icona');
const PORT = 4984;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'Password-Valida-123!';
const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body, form } = {}) {
  const headers = { 'X-Forwarded-For': `10.84.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method: metodo, headers, body: payload });
  const tipo = r.headers.get('content-type') || '';
  const dati = tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, dati, tipo, cache: r.headers.get('cache-control') || '' };
}
const png = async (w, h, colore) => new Jimp({ width: w, height: h, color: colore }).getBuffer('image/png');
const file = (campo, buf, nome, tipo) => { const f = new FormData(); f.append(campo, new Blob([buf], { type: tipo }), nome); return f; };
const manifest = async () => (await call('GET', '/manifest.webmanifest')).dati;

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), SMTP_HOST: '' },
  });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const mm = (await call('POST', '/api/setup', { body: { company_name: 'Acme Mobility Italia', nome: 'A', cognome: 'B', email: 'mm@test.it', password: PW } })).dati.token;

    console.log('\n[Senza personalizzazioni: WayMatch]');
    const m0 = await manifest();
    check('il manifest è servito dal server (nome dell\'azienda, colori)', m0.name === 'Acme Mobility Italia' && m0.theme_color === '#14424F' && m0.lang === 'it', JSON.stringify(m0).slice(0, 100));
    check('il nome breve sono le prime 12 lettere', m0.short_name === 'Acme Mobilit');
    check('icone WayMatch del kit (any e maskable)', m0.icons.filter((i) => i.src.startsWith('/brand/')).length === 4 && ['any', 'maskable'].every((u) => m0.icons.some((i) => i.purpose === u)));
    check('il manifest non si tiene in cache', /no-cache/.test((await call('GET', '/manifest.webmanifest')).cache) && (await call('GET', '/manifest.webmanifest')).tipo.includes('manifest+json'));
    check('/api/branding dice che non c\'è un\'icona personalizzata', (await call('GET', '/api/branding')).dati.branding.icona.personalizzata === false);
    check('senza personalizzazioni l\'icona dinamica non esiste (404)', (await call('GET', '/api/branding/icona/192.png')).status === 404);

    console.log('\n[Logo dell\'azienda → icona]');
    const logo = await png(600, 200, 0x14424fff);
    check('il logo si carica', (await call('POST', '/api/branding/logo', { token: mm, form: file('logo', logo, 'logo.png', 'image/png') })).status === 200);
    const m1 = await manifest();
    check('ora le icone del manifest vengono dal logo', m1.icons.every((i) => i.src.startsWith('/api/branding/icona/')) && m1.icons.length === 4);
    const i512 = await call('GET', m1.icons.find((i) => i.sizes === '512x512').src);
    const ic = await Jimp.read(i512.dati);
    check('l\'icona è un PNG 512x512 pubblico, con cache', i512.status === 200 && i512.tipo === 'image/png' && ic.width === 512 && ic.height === 512 && /max-age/.test(i512.cache));
    check('il logo largo sta nella zona sicura: bordi bianchi, centro del colore del logo', ic.getPixelColor(2, 2) === 0xffffffff && ic.getPixelColor(256, 256) === 0x14424fff);
    check('la 192 ha la dimensione giusta', (await Jimp.read((await call('GET', '/api/branding/icona/192.png')).dati)).width === 192);
    check('dimensioni non previste: 404', (await call('GET', '/api/branding/icona/999.png')).status === 404 && (await call('GET', '/api/branding/icona/192')).status === 404);
    const vLogo = (await call('GET', '/api/branding')).dati.branding.icona.versione;

    console.log('\n[Icona caricata → ha la precedenza]');
    const quadrata = await png(400, 400, 0xff0000ff);
    check('un\'icona quadrata si carica', (await call('POST', '/api/branding/icona', { token: mm, form: file('icona', quadrata, 'i.png', 'image/png') })).status === 200);
    const b2 = (await call('GET', '/api/branding')).dati.branding.icona;
    check('la versione cambia (la cache si rompe) e risulta caricata', b2.caricata === true && b2.versione !== vLogo);
    const ic2 = await Jimp.read((await call('GET', '/api/branding/icona/512.png')).dati);
    check('adesso l\'icona è quella caricata (rossa, nella zona sicura)', ic2.getPixelColor(256, 256) === 0xff0000ff && ic2.getPixelColor(10, 10) === 0xffffffff);
    check('serve il login per cambiarla', (await call('POST', '/api/branding/icona', { form: file('icona', quadrata, 'i.png', 'image/png') })).status === 401);
    check('un file che non è un\'immagine è rifiutato', (await call('POST', '/api/branding/icona', { token: mm, form: file('icona', Buffer.from('<svg onload=alert(1)>'), 'x.png', 'image/png') })).status === 400);
    check('SVG non ammesso', (await call('POST', '/api/branding/icona', { token: mm, form: file('icona', Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml') })).status >= 400);
    const reale = require('fs').readdirSync(path.join(DIR, 'uploads')).find((f) => f.startsWith('icona-'));
    check('il file dell\'icona esiste su disco ma /uploads non lo espone', !!reale && (await call('GET', '/uploads/' + reale)).status === 404, reale);

    console.log('\n[Rimozione e nome breve]');
    check('rimuovendo l\'icona torna il logo', (await call('DELETE', '/api/branding/icona', { token: mm })).status === 200 && (await call('GET', '/api/branding')).dati.branding.icona.caricata === false && (await call('GET', '/api/branding')).dati.branding.icona.personalizzata === true);
    const imp = (await call('GET', '/api/branding')).dati.branding;
    await call('PUT', '/api/branding', { token: mm, body: { company_name: imp.company_name, primary_color: '#0B6E66', accent_color: imp.accent_color, pwa_short_name: 'Acme Mobility Italia lunghissimo' } });
    const m3 = await manifest();
    check('il nome breve è tagliato a 12 caratteri', m3.short_name === 'Acme Mobilit', m3.short_name);
    check('il colore del tema segue il primario dell\'azienda', m3.theme_color === '#0B6E66');
  } finally {
    server.kill();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
