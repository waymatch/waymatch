// Foto del profilo: facoltativa, scelta dall'utente. Si salva solo cifrata (AES-256-GCM, chiave
// derivata da DB_ENCRYPTION_KEY: niente chiavi nuove da gestire, e un backup senza quella chiave
// non la rivela). Prima di cifrarla la si riduce a un quadrato 256x256 in JPEG: la nuova codifica
// toglie i metadati dello scatto (posizione GPS, modello del telefono, data).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { readSecret } = require('./secrets');
const { UPLOAD_DIR, nomeCasuale } = require('./fileCaricati');
const { percorsoSicuro } = require('./safePath');

const LATO = 256;
const MAX_LATO_ORIGINALE = 4096; // oltre, la decodifica occuperebbe troppa memoria
const CARTELLA = 'foto-profilo';
const MAGIA = Buffer.from('WMF1'); // formato del file cifrato: WMF1 | iv (12) | tag (16) | dati

let chiaveCache = null;
function chiave() {
  if (!chiaveCache) {
    chiaveCache = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(readSecret('DB_ENCRYPTION_KEY'), 'utf8'),
      Buffer.alloc(0), Buffer.from('waymatch/foto-profilo/v1'), 32));
  }
  return chiaveCache;
}

// Larghezza e altezza dall'intestazione, prima di decodificare: un file piccolo può dichiarare
// un'immagine enorme ("bomba" di decompressione). null se non è un PNG o un JPEG riconoscibile.
function dimensioni(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { tipo: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marcatore = buf[i + 1];
      if (marcatore === 0xd8 || marcatore === 0x01 || (marcatore >= 0xd0 && marcatore <= 0xd7)) { i += 2; continue; }
      const lunghezza = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, esclusi DHT (C4), JPG (C8) e DAC (CC)
      if (marcatore >= 0xc0 && marcatore <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcatore)) {
        return { tipo: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + lunghezza;
    }
  }
  return null;
}

class FotoNonValida extends Error {}

// Dal file caricato al JPEG 256x256 da salvare.
async function prepara(buf) {
  const d = dimensioni(buf);
  if (!d) throw new FotoNonValida('La foto deve essere un\'immagine JPEG o PNG.');
  if (!d.w || !d.h || d.w > MAX_LATO_ORIGINALE || d.h > MAX_LATO_ORIGINALE) {
    throw new FotoNonValida(`La foto è troppo grande: al massimo ${MAX_LATO_ORIGINALE}×${MAX_LATO_ORIGINALE} pixel.`);
  }
  let img;
  try { img = await Jimp.read(buf); } catch { throw new FotoNonValida('Non riesco a leggere l\'immagine.'); }
  img.cover({ w: LATO, h: LATO });
  return img.getBuffer('image/jpeg', { quality: 85 });
}

function cifra(dati) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chiave(), iv);
  const corpo = Buffer.concat([c.update(dati), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), corpo]);
}

function decifra(buf) {
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIA)) throw new Error('formato della foto non riconosciuto');
  const d = crypto.createDecipheriv('aes-256-gcm', chiave(), buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

const percorso = (rel) => percorsoSicuro(UPLOAD_DIR, rel);

// Salva la foto cifrata e restituisce il percorso relativo da registrare nel database. La
// scrittura passa da un file temporaneo: un'interruzione non lascia un file a metà.
function salva(jpeg) {
  fs.mkdirSync(path.join(UPLOAD_DIR, CARTELLA), { recursive: true });
  const rel = `${CARTELLA}/${nomeCasuale('.bin')}`;
  const tmp = `${percorso(rel)}.tmp`;
  fs.writeFileSync(tmp, cifra(jpeg), { mode: 0o600 });
  fs.renameSync(tmp, percorso(rel));
  return rel;
}

const leggi = (rel) => decifra(fs.readFileSync(percorso(rel)));

function elimina(rel) {
  if (!rel) return;
  try { fs.unlinkSync(percorso(rel)); } catch (e) { if (e.code !== 'ENOENT') console.error('[foto profilo] file non eliminato:', e.message); }
}

module.exports = { prepara, salva, leggi, elimina, cifra, decifra, dimensioni, FotoNonValida, LATO };
