// Icona dell'app (PWA): usa quella caricata dall'azienda, altrimenti il suo logo, altrimenti
// l'icona WayMatch. Qualsiasi immagine diventa un quadrato 512x512 su fondo bianco, con il contenuto
// entro l'80% centrale: è la "zona sicura" delle icone maskable, che i telefoni ritagliano in forme
// diverse (cerchio, squircle...). Il logo di un'azienda è spesso largo: in un quadrato resta piccolo,
// per questo c'è anche la possibilità di caricare un'icona quadrata dedicata.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Jimp } = require('jimp');
const db = require('../db');
const { percorsoSicuro } = require('./safePath');

const LATO = 512;
// Zona sicura delle icone "maskable": un cerchio di diametro pari all'80% del lato.
const ZONA_SICURA = 0.8;
const DIMENSIONI = [32, 180, 192, 512];
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// Converte un'immagine (qualsiasi formato decodificabile e proporzione) nel master 512x512.
async function creaMaster(sorgente) {
  const img = await Jimp.read(sorgente);
  // Il logo, qualunque proporzione abbia, deve stare tutto dentro il cerchio: la sua
  // diagonale non supera il diametro della zona sicura (un quadrato pieno ne sporgerebbe
  // con gli angoli, tagliati dalla maschera rotonda di Android).
  const diametro = LATO * ZONA_SICURA;
  const rapporto = img.width / img.height;
  const altezza = Math.max(1, Math.floor(diametro / Math.sqrt(1 + rapporto * rapporto)));
  const larghezza = Math.max(1, Math.floor(altezza * rapporto));
  img.resize({ w: larghezza, h: altezza });
  const base = new Jimp({ width: LATO, height: LATO, color: 0xffffffff });
  base.composite(img, Math.round((LATO - img.width) / 2), Math.round((LATO - img.height) / 2));
  return base.getBuffer('image/png');
}

function impostazioni() {
  return db.prepare('SELECT company_name, logo_path, icon_path, pwa_short_name, primary_color FROM system_settings WHERE id = 1').get();
}

// Percorso del file sorgente e tipo: 'icona' (già master), 'logo' (da convertire) o null (WayMatch).
function sorgente(s = impostazioni()) {
  if (s.icon_path) return { tipo: 'icona', rel: s.icon_path };
  if (s.logo_path) return { tipo: 'logo', rel: s.logo_path };
  return null;
}

// Segno di versione per rompere la cache di browser e telefoni quando l'icona cambia.
function versione(s = impostazioni()) {
  const src = sorgente(s);
  return src ? crypto.createHash('sha1').update(src.rel).digest('hex').slice(0, 10) : 'wm';
}

const cache = new Map();
async function icona(dimensione) {
  const s = impostazioni();
  const src = sorgente(s);
  if (!src) return null;
  const chiave = `${src.rel}:${dimensione}`;
  if (cache.has(chiave)) return cache.get(chiave);
  const file = percorsoSicuro(UPLOAD_DIR, src.rel.replace('/uploads/', ''));
  if (!fs.existsSync(file)) return null;
  let png = src.tipo === 'icona' ? fs.readFileSync(file) : await creaMaster(file);
  if (dimensione !== LATO) {
    const img = await Jimp.read(png);
    img.resize({ w: dimensione, h: dimensione });
    png = await img.getBuffer('image/png');
  }
  if (cache.size > 40) cache.clear();
  cache.set(chiave, png);
  return png;
}

function manifest() {
  const s = impostazioni();
  const nome = (s.company_name || 'WayMatch').trim();
  const breve = (s.pwa_short_name || '').trim() || nome.slice(0, 12);
  const personalizzata = !!sorgente(s);
  const v = versione(s);
  const icone = personalizzata
    ? [
      { src: `/api/branding/icona/192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/api/branding/icona/512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/api/branding/icona/192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: `/api/branding/icona/512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
    : [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
  return {
    name: nome,
    short_name: breve,
    description: 'Piattaforma di carpooling aziendale. Due strade, una via.',
    start_url: '/', scope: '/', display: 'standalone', lang: 'it',
    background_color: '#F3F7F5',
    theme_color: /^#[0-9a-fA-F]{6}$/.test(s.primary_color || '') ? s.primary_color : '#14424F',
    icons: icone,
  };
}

module.exports = { creaMaster, icona, manifest, versione, sorgente, DIMENSIONI, UPLOAD_DIR };
