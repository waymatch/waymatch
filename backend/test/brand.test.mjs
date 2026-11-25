// Identità WayMatch: asset del kit copiati senza modifiche, tema con contrasto AA, nessun residuo
// del vecchio nome o dei vecchi font nell'interfaccia.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { BACKEND, FRONTEND } = createRequire(import.meta.url)('./ambiente.js');
const RADICE = path.resolve(BACKEND, '..');
const { contrasto, TEMA, hexToRgb, scurisci, schiarisci, controllaColorePrimario, derivatiAccento } = await import(pathToFileURL(path.join(FRONTEND, 'src/colori.js')).href);

const esito = { ok: 0, ko: 0 };
const check = (n, c, x = '') => { c ? esito.ok++ : esito.ko++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const leggi = (f) => fs.readFileSync(path.join(RADICE, f), 'utf8');

console.log('\n[Asset del kit]');
const COPIE = { 'favicon/favicon.ico': 'favicon.ico', 'favicon/favicon.svg': 'favicon.svg', 'favicon/apple-touch-icon.png': 'apple-touch-icon.png',
  'png/icon/waymatch-icon-dark-192.png': 'icon-192.png', 'png/icon/waymatch-icon-dark-512.png': 'icon-512.png',
  'png/icon/waymatch-icon-dark-maskable-192.png': 'icon-maskable-192.png', 'png/icon/waymatch-icon-dark-maskable-512.png': 'icon-maskable-512.png',
  'png/icon/waymatch-icon-badge-96.png': 'badge-96.png' };
for (const [src, dst] of Object.entries(COPIE)) {
  const a = path.join(RADICE, 'assets/brand', src), b = path.join(RADICE, 'frontend/public/brand', dst);
  check(`public/brand/${dst} è identico al kit`, fs.existsSync(a) && fs.existsSync(b) && sha(a) === sha(b));
}
const svgs = [];
(function scan(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? scan(p) : p.endsWith('.svg') && svgs.push(p); } })(path.join(RADICE, 'assets/brand'));
const sporchi = svgs.filter((f) => /<script|onload|<!--|<metadata|<foreignObject|xlink:href="http/i.test(fs.readFileSync(f, 'utf8')));
check(`${svgs.length} SVG del kit senza script, commenti né metadati`, svgs.length > 0 && sporchi.length === 0, sporchi.join(', '));
{
  // Il componente Simbolo fissa la larghezza dal rapporto del viewBox: se il kit cambia
  // disegno, il rapporto nel codice deve seguirlo.
  const vb = leggi('assets/brand/svg/symbol/waymatch-symbol-on-light.svg').match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
  const rc = leggi('frontend/src/components/MarcaWayMatch.jsx').match(/RAPPORTO_SIMBOLO = ([\d.]+) \/ ([\d.]+)/);
  check('Simbolo usa le proporzioni del viewBox del kit', vb && rc && Math.abs(vb[1] / vb[2] - rc[1] / rc[2]) < 0.001, `${vb?.slice(1).join('x')} vs ${rc?.slice(1).join('/')}`);
}
check('le vecchie icone con la "C" non ci sono più', !fs.existsSync(path.join(RADICE, 'frontend/public/icons')));

console.log('\n[Tema: contrasto WCAG AA]');
const p = TEMA.petrolio, ac = TEMA.acqua;
const accDer = derivatiAccento(ac);
const coppie = [
  ['testo (petrolio) su nebbia', p, TEMA.nebbia, 4.5], ['testo su bianco', p, TEMA.bianco, 4.5],
  ['testo secondario su nebbia', TEMA.muted, TEMA.nebbia, 4.5], ['testo secondario su bianco', TEMA.muted, TEMA.bianco, 4.5],
  ['bianco su primario (pulsanti)', TEMA.bianco, p, 4.5], ['bianco su primario scuro (hover)', TEMA.bianco, scurisci(p), 4.5],
  ['primario su bianco (link)', p, TEMA.bianco, 4.5], ['primario su nebbia', p, TEMA.nebbia, 4.5],
  ['primario scuro su primario chiaro (badge)', scurisci(p), schiarisci(p), 4.5],
  ['acqua scuro su nebbia (link)', TEMA.acquaScuro, TEMA.nebbia, 4.5], ['acqua scuro su bianco', TEMA.acquaScuro, TEMA.bianco, 4.5],
  ['testo dei badge accento su accento chiaro', accDer.scuro, accDer.chiaro, 4.5],
  ['testo sopra l\'accento (pulsanti)', accDer.su, ac, 4.5],
  ['errore su bianco', TEMA.danger, TEMA.bianco, 4.5], ['errore su nebbia', TEMA.danger, TEMA.nebbia, 4.5],
  ['acqua su petrolio (testo/segni su scuro)', ac, p, 4.5],
];
for (const [n, x, y, min] of coppie) { const c = contrasto(x, y); check(`${n}: ${c.toFixed(2)}:1 (min ${min})`, c >= min); }
check('l\'acqua NON è mai usata come testo su chiaro (1,9:1)', contrasto(ac, TEMA.nebbia) < 3 && accDer.scuro.some((v, i) => v !== ac[i]));
const tw = leggi('frontend/tailwind.config.js');
check('tailwind.config usa i colori del tema (nebbia, petrolio)', /bg: '#F3F7F5'/.test(tw) && /ink: '#14424F'/.test(tw) && /muted: '#4A6670'/.test(tw) && /danger: '#B02E2E'/.test(tw));
const css = leggi('frontend/src/styles/index.css');
check('index.css: primario petrolio, accento acqua, acqua scuro per il testo', /--color-primary: 20 66 79/.test(css) && /--color-accent: 60 200 184/.test(css) && /--color-accent-dark: 11 110 102/.test(css));
check('nessun colore della vecchia palette nell\'interfaccia', !/22211F|A8763E|7A5228|F3EEE4|0E7C66|F5A623|5E594F/i.test(['frontend/index.html', 'frontend/vite.config.js', 'frontend/tailwind.config.js', 'frontend/src/styles/index.css', 'frontend/src/context/BrandingContext.jsx', 'frontend/src/components/RouteMap.jsx', 'frontend/src/pages/Reports.jsx', 'backend/db.js'].map(leggi).join('\n').replace(/'#0E7C66', '#7A5228'|'#F5A623', '#A8763E'/g, '')));

console.log('\n[Avviso sul colore primario scelto dall\'azienda]');
check('il petrolio del tema è accettato', controllaColorePrimario('#14424F').ok === true);
const giallo = controllaColorePrimario('#F5A623');
check('un giallo chiaro è segnalato con una proposta più scura', giallo.ok === false && /^#[0-9a-f]{6}$/.test(giallo.proposta) && controllaColorePrimario(giallo.proposta).ok === true, JSON.stringify(giallo));
check('un valore non valido non manda in errore', controllaColorePrimario('xyz').valido === false);
for (const hex of ['#F5A623', '#FFFF00', '#0E7C66', '#CC0000', '#222222']) {
  const d = derivatiAccento(hexToRgb(hex));
  check(`accento ${hex}: testo badge ≥ 4,5 su chiaro e bianco, testo sui pulsanti ≥ 4,5`, contrasto(d.scuro, d.chiaro) >= 4.5 && contrasto(d.scuro, TEMA.bianco) >= 4.5 && contrasto(d.su, hexToRgb(hex)) >= 4.5, `${contrasto(d.scuro, d.chiaro).toFixed(1)} / ${contrasto(d.su, hexToRgb(hex)).toFixed(1)}`);
}

console.log('\n[Nome e font]');
const viste = ['frontend/index.html', 'frontend/vite.config.js', 'frontend/src/pages/Setup.jsx', 'frontend/src/pages/Login.jsx', 'frontend/src/context/BrandingContext.jsx', 'frontend/src/progetto.js'];
const vecchi = viste.filter((f) => /Carpooling Aziendale/.test(leggi(f)));
check('nessun "Carpooling Aziendale" nell\'interfaccia', vecchi.length === 0, vecchi.join(', '));
const manifest = leggi('frontend/vite.config.js');
check('il manifest si chiama WayMatch', /name: 'WayMatch'/.test(manifest) && /theme_color: '#14424F'/.test(manifest));
check('il manifest ha icone "any" e "maskable" (192 e 512)', ['any', 'maskable'].every((u) => ['192', '512'].every((d) => new RegExp(`icon-${u === 'any' ? '' : 'maskable-'}${d}\\.png[^}]*purpose: '${u}'`).test(manifest))));
check('le notifiche usano l\'icona badge del kit', /badge-96\.png/.test(leggi('frontend/src/sw.js')));
check('il banner del README è quello nuovo (senza "open source")', /readme-banner-1600x400\.png/.test(leggi('README.md')) && !/open.?source corporate/i.test(leggi('assets/brand/README.md')));
check('font: nessun riferimento a Sora', !/Sora/.test(leggi('frontend/tailwind.config.js') + leggi('frontend/src/styles/index.css') + leggi('frontend/src/main.jsx') + leggi('frontend/package.json')));
check('font: Space Grotesk incluso nel progetto', /space-grotesk\/500\.css/.test(leggi('frontend/src/main.jsx')));

console.log(`\nRisultato: ${esito.ok} OK, ${esito.ko} FAIL`);
if (esito.ko) process.exitCode = 1;
