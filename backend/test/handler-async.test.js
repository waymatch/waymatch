// In Express 4 una route async che fallisce non viene intercettata e, su Node 22,
// l'unhandled rejection termina il processo. Ogni handler async deve usare asyncHandler.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { BACKEND } = require('./ambiente');
const { asyncHandler } = require(path.join(BACKEND, 'utils/asyncHandler'));

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

async function main() {
  console.log('\n[Nessun handler async senza asyncHandler]');
  const dirRoutes = path.join(BACKEND, 'routes');
  let totale = 0;
  for (const f of fs.readdirSync(dirRoutes).filter((x) => x.endsWith('.js'))) {
    const righe = fs.readFileSync(path.join(dirRoutes, f), 'utf8').split('\n');
    const scoperti = [];
    righe.forEach((r, i) => {
      const codice = r.replace(/\/\/.*$/, '');
      const m = codice.match(/(asyncHandler\()?\basync\s*(\(|function\b)/);
      if (m) { totale++; if (!m[1]) scoperti.push(i + 1); }
    });
    check(`${f}: tutti gli handler async sono protetti`, scoperti.length === 0, scoperti.length ? `righe ${scoperti.join(', ')}` : '');
  }
  check('trovati handler async da controllare', totale >= 24, String(totale));

  console.log('\n[asyncHandler: un errore diventa una risposta 500, il processo resta vivo]');
  const rifiuti = [];
  const onRej = (e) => rifiuti.push(e);
  process.on('unhandledRejection', onRej);
  const app = express();
  app.get('/rifiuta', asyncHandler(async () => { throw new Error('boom'); }));
  app.get('/ok', asyncHandler(async (req, res) => { res.json({ ok: true }); }));
  app.use((err, req, res, next) => { res.status(500).json({ error: 'Errore interno del server' }); });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const a = await fetch(base + '/rifiuta');
  check('la route che fallisce risponde 500', a.status === 500);
  check('il messaggio è generico', (await a.json()).error === 'Errore interno del server');
  await new Promise((r) => setTimeout(r, 100));
  check('nessuna unhandled rejection', rifiuti.length === 0);
  check('il server risponde ancora dopo l\'errore', (await fetch(base + '/ok')).status === 200);
  srv.close();
  process.off('unhandledRejection', onRej);

  console.log('\n[Rete di sicurezza]');
  check('server.js registra unhandledRejection', /process\.on\('unhandledRejection'/.test(fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8')));
}

main().catch((e) => { console.error(e); esito.ko++; }).finally(() => {
  console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
  if (esito.ko) process.exitCode = 1;
});
