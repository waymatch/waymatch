// Foto del profilo: cifrata su disco, ridotta e senza metadati, servita solo dopo l'accesso, tolta
// dall'utente o dal mobility manager, nell'export dei dati personali e cancellata con l'anonimizzazione.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { BACKEND, cartellaProva } = require('./ambiente');
const { Jimp } = require(path.join(BACKEND, 'node_modules/jimp'));

const DIR = cartellaProva('foto-profilo');
const PORT = 4977;
const API = `http://127.0.0.1:${PORT}/api`;
const PW = 'Password-Valida-123!';
const DB_KEY = crypto.randomBytes(32).toString('hex');

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let ip = 1;
async function call(metodo, p, { token, body, form, grezzo } = {}) {
  const headers = { 'X-Forwarded-For': `10.32.0.${ip++ % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method: metodo, headers, body: payload });
  if (grezzo) return { status: r.status, tipo: r.headers.get('content-type'), cache: r.headers.get('cache-control'), buf: Buffer.from(await r.arrayBuffer()) };
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function sql(q, ...p) {
  const d = new Database(path.join(DIR, 'data', 'carpooling.db')); d.pragma(`key='${DB_KEY}'`);
  try { return /^\s*select/i.test(q) ? d.prepare(q).all(...p) : d.prepare(q).run(...p); } finally { d.close(); }
}
const conFoto = (buf, nome = 'foto.jpg', tipo = 'image/jpeg') => { const f = new FormData(); f.append('foto', new Blob([buf], { type: tipo }), nome); return f; };

// Un JPEG con un blocco EXIF (con una "posizione GPS" riconoscibile) subito dopo l'inizio del file.
async function jpegConExif() {
  const base = await new Jimp({ width: 640, height: 480, color: 0x3366ccff }).getBuffer('image/jpeg');
  const dati = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS-POSIZIONE-SEGRETA-45.4642N-9.1900E')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(dati.length + 2) >> 8, (dati.length + 2) & 0xff]), dati]);
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}
// PNG che nell'intestazione dichiara 20000x20000 pixel (la decodifica occuperebbe gigabyte).
async function pngEnorme() {
  const p = Buffer.from(await new Jimp({ width: 10, height: 10, color: 0xffffffff }).getBuffer('image/png'));
  p.writeUInt32BE(20000, 16); p.writeUInt32BE(20000, 20);
  return p;
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'), DB_ENCRYPTION_KEY: DB_KEY, SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  try {
    const mm = (await call('POST', '/setup', { body: { company_name: 'T', nome: 'Mo', cognome: 'Ma', email: 'mm@test.it', password: PW } })).data.token;
    for (const n of ['ugo', 'eva']) await call('POST', '/users', { token: mm, body: { nome: n, cognome: 'Test', email: `${n}@test.it`, password: PW } });
    sql('UPDATE users SET password_da_cambiare = 0');
    const entra = async (e) => (await call('POST', '/auth/login', { body: { email: e, password: PW } })).data.token;
    const ugo = await entra('ugo@test.it');
    const eva = await entra('eva@test.it');
    const ugoId = sql("SELECT id FROM users WHERE email = 'ugo@test.it'")[0].id;
    const riga = () => sql('SELECT foto_path, foto_versione FROM users WHERE id = ?', ugoId)[0];

    console.log('\n[Caricamento]');
    let r = await call('PUT', '/foto', { token: ugo, form: conFoto(await jpegConExif()) });
    check('la foto si carica', r.status === 200 && r.data.foto_versione === 1, JSON.stringify(r.data));
    const file = path.join(DIR, 'uploads', riga().foto_path);
    const suDisco = fs.readFileSync(file);
    check('su disco è cifrata (niente intestazione JPEG, niente metadati in chiaro)', suDisco.subarray(0, 4).toString() === 'WMF1'
      && suDisco.indexOf(Buffer.from([0xff, 0xd8, 0xff])) === -1 && !suDisco.includes('GPS-POSIZIONE'));
    check('il file non è leggibile da altri utenti del sistema', (fs.statSync(file).mode & 0o077) === 0, (fs.statSync(file).mode & 0o777).toString(8));
    r = await call('GET', `/foto/${ugoId}`, { token: eva, grezzo: true });
    const img = r.status === 200 ? await Jimp.read(r.buf) : null;
    check('un collega la vede, come JPEG 256x256', r.status === 200 && r.tipo === 'image/jpeg' && img?.width === 256 && img?.height === 256, `${r.status} ${r.tipo}`);
    check('senza i metadati dello scatto', !r.buf.includes('GPS-POSIZIONE') && !r.buf.includes('Exif'));
    check('e solo nella cache del suo browser', /private/.test(r.cache || ''), r.cache);
    r = await call('GET', `/foto/${ugoId}`, { grezzo: true });
    check('senza accesso non si vede', r.status === 401, String(r.status));
    r = await call('GET', '/auth/me', { token: ugo });
    check('il profilo dice che c\'è una foto, senza il percorso del file', r.data.user.foto_versione === 1 && !('foto_path' in r.data.user));
    const vecchio = riga().foto_path;
    r = await call('PUT', '/foto', { token: ugo, form: conFoto(await new Jimp({ width: 300, height: 900, color: 0x00ff00ff }).getBuffer('image/png'), 'f.png', 'image/png') });
    check('una nuova foto cambia versione e cancella la precedente', r.data?.foto_versione === 2 && !fs.existsSync(path.join(DIR, 'uploads', vecchio)));

    console.log('\n[File non validi]');
    r = await call('PUT', '/foto', { token: ugo, form: conFoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml') });
    check('un file che non è JPEG o PNG è rifiutato', r.status === 400, String(r.status));
    r = await call('PUT', '/foto', { token: ugo, form: conFoto(await pngEnorme(), 'enorme.png', 'image/png') });
    check('un\'immagine dichiarata enorme è rifiutata prima di decodificarla', r.status === 400 && /troppo grande/.test(r.data?.error || ''), r.data?.error);
    r = await call('PUT', '/foto', { token: ugo, form: conFoto(Buffer.alloc(6 * 1024 * 1024, 1)) });
    check('oltre 5 MB è rifiutata', r.status === 400, String(r.status));
    check('e la foto di prima resta', riga().foto_versione === 2);

    console.log('\n[Dati personali]');
    r = await call('GET', '/privacy/export', { token: ugo });
    check('l\'export dei dati personali contiene la foto', /^data:image\/jpeg;base64,/.test(r.data?.profilo?.foto_profilo || '') && !('foto_path' in (r.data?.profilo || {})));

    console.log('\n[Rimozione]');
    r = await call('DELETE', `/foto/${ugoId}`, { token: eva });
    check('un collega non può togliere la foto di un altro', r.status === 403 && riga().foto_versione === 2, String(r.status));
    const daTogliere = riga().foto_path;
    r = await call('DELETE', `/foto/${ugoId}`, { token: mm });
    check('il mobility manager la toglie (file compreso)', r.status === 200 && riga().foto_path === null && !fs.existsSync(path.join(DIR, 'uploads', daTogliere)));
    check('e resta nel log attività', sql("SELECT COUNT(*) n FROM audit_log WHERE azione = 'foto_profilo_rimossa_mm'")[0].n === 1);
    await call('PUT', '/foto', { token: ugo, form: conFoto(await jpegConExif()) });
    r = await call('DELETE', '/foto', { token: ugo });
    check('l\'utente la toglie da sé', r.status === 200 && riga().foto_versione === null);
    check('poi non si vede più', (await call('GET', `/foto/${ugoId}`, { token: eva, grezzo: true })).status === 404);

    console.log('\n[Anonimizzazione]');
    await call('PUT', '/foto', { token: ugo, form: conFoto(await jpegConExif()) });
    const fileUgo = path.join(DIR, 'uploads', riga().foto_path);
    await call('POST', '/privacy/cancellazione', { token: ugo, body: { motivo: 'prova' } });
    const richiesta = sql("SELECT id FROM account_deletion_requests WHERE stato = 'in_attesa'")[0]?.id;
    r = await call('POST', `/privacy/cancellazioni/${richiesta}/completa`, { token: mm, body: {} });
    check('l\'anonimizzazione cancella la foto', r.status === 200 && riga().foto_path === null && !fs.existsSync(fileUgo), `${r.status} ${JSON.stringify(r.data)}`);
  } finally {
    server.kill();
    if (esito.ko) console.log(log.slice(-2000));
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    if (esito.ko) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
