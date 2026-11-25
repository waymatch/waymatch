// Avviso di nuova versione (utils/aggiornamenti.js): con una release finta servita in locale,
// senza chiamare GitHub. Gira nello stesso processo, su un database di prova.
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { BACKEND, cartellaProva } = require('./ambiente');

const DIR = cartellaProva('aggiornamenti');
const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

let release = {};
const finta = http.createServer((req, res) => {
  res.writeHead(release.status || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(release.corpo || {}));
});

async function main() {
  await new Promise((r) => finta.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATA_DIR: path.join(DIR, 'data'), UPLOAD_DIR: path.join(DIR, 'uploads'), DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), SMTP_HOST: '', CONTROLLO_AGGIORNAMENTI: '1',
    AGGIORNAMENTI_URL: `http://127.0.0.1:${finta.address().port}/releases/latest`,
  });
  const db = require(path.join(BACKEND, 'db'));
  const agg = require(path.join(BACKEND, 'utils/aggiornamenti'));
  const { version } = require(path.join(BACKEND, 'package.json'));
  const [M, m, p] = version.split('.').map(Number);
  const piuNuova = `${M}.${m}.${p + 1}`;
  const mm = db.prepare("INSERT INTO users (nome, cognome, email, password_hash, ruolo) VALUES ('M', 'M', 'mm@test.it', 'x', 'mobility_manager')").run().lastInsertRowid;
  db.prepare("INSERT INTO users (nome, cognome, email, password_hash, ruolo) VALUES ('U', 'U', 'u@test.it', 'x', 'utente')").run();
  const avvisi = () => db.prepare("SELECT COUNT(*) n FROM notifications WHERE tipo = 'nuova_versione'").get().n;

  console.log('\n[Confronto delle versioni]');
  check('1.0.0 è più recente di 0.9.1', agg.piuRecente('1.0.0', '0.9.1'));
  check('0.10.0 è più recente di 0.9.9 (confronto numerico)', agg.piuRecente('0.10.0', '0.9.9'));
  check('la stessa versione non è più recente', !agg.piuRecente('0.9.1', '0.9.1'));
  check('una versione non riconosciuta non conta', !agg.piuRecente('1.0.0-beta', '0.9.1'));

  console.log('\n[Nessuna versione nuova]');
  release = { corpo: { tag_name: `v${version}`, html_url: 'https://github.com/waymatch/waymatch/releases/tag/x' } };
  let s = await agg.controlla();
  check('con la stessa versione non c\'è niente da installare', s.disponibile === false && s.ultima === version && !!s.controllato_il);
  check('e nessun avviso', avvisi() === 0);

  console.log('\n[Versione nuova]');
  release = { corpo: { tag_name: `v${piuNuova}`, html_url: `https://github.com/waymatch/waymatch/releases/tag/v${piuNuova}` } };
  s = await agg.controlla();
  check('una release più recente risulta disponibile', s.disponibile === true && s.ultima === piuNuova, JSON.stringify(s));
  check('il Mobility Manager riceve un avviso (e solo lui)', avvisi() === 1
    && db.prepare("SELECT user_id FROM notifications WHERE tipo = 'nuova_versione'").get().user_id === mm);
  await agg.controlla();
  check('al controllo successivo l\'avviso non si ripete', avvisi() === 1, String(avvisi()));

  console.log('\n[Risposte non valide]');
  release = { corpo: { tag_name: 'v9.9.9', html_url: 'https://esempio.it/trappola' } };
  s = await agg.controlla();
  check('un link che non porta a GitHub non viene mostrato', s.url === null);
  release = { corpo: { tag_name: 'ultima' } };
  let errore = null;
  try { await agg.controlla(); } catch (e) { errore = e.message; }
  check('un tag che non è una versione viene rifiutato', /versione/.test(errore || ''), errore || 'nessun errore');
  release = { status: 503 };
  errore = null;
  try { await agg.controlla(); } catch (e) { errore = e.message; }
  check('un errore del servizio non cambia lo stato registrato', /503/.test(errore || '') && agg.stato().ultima === '9.9.9');

  console.log('\n[Controllo disattivato]');
  process.env.CONTROLLO_AGGIORNAMENTI = '0';
  release = { corpo: { tag_name: 'v99.0.0' } };
  s = await agg.controlla();
  check('con CONTROLLO_AGGIORNAMENTI=0 non si legge niente', s.attivo === false && s.ultima === '9.9.9');
}

main()
  .catch((e) => { console.error(e); esito.ko++; })
  .finally(() => {
    finta.close();
    console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
    process.exit(esito.ko ? 1 : 0);
  });
