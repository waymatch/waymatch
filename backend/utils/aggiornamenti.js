// Controllo delle nuove versioni di WayMatch: una volta al giorno il server legge l'ultima release
// pubblica su GitHub e, se è più recente di quella installata, avvisa i Mobility Manager (una volta
// per versione). È una semplice lettura: non si invia nessun dato dell'azienda, ma GitHub vede
// l'indirizzo del server. Si disattiva con CONTROLLO_AGGIORNAMENTI=0 (installazioni senza accesso
// a Internet, o per scelta).
const db = require('../db');
const { version: INSTALLATA } = require('../package.json');
const { creaNotificaInApp, inAppAttiva, consegnaEsterna } = require('./notify');

const URL_RELEASE = process.env.AGGIORNAMENTI_URL || 'https://api.github.com/repos/waymatch/waymatch/releases/latest';
const TIMEOUT_MS = 10000;

const attivo = () => process.env.CONTROLLO_AGGIORNAMENTI !== '0';

// "1.2.3" (anche "v1.2.3") → [1, 2, 3]; null se non è una versione X.Y.Z.
function numeri(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
function piuRecente(a, b) {
  const x = numeri(a), y = numeri(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function stato() {
  const s = db.prepare('SELECT ultima_versione, ultima_versione_url, aggiornamenti_controllati_il FROM system_settings WHERE id = 1').get();
  return {
    attivo: attivo(),
    installata: INSTALLATA,
    ultima: s.ultima_versione || null,
    url: s.ultima_versione_url || null,
    disponibile: !!s.ultima_versione && piuRecente(s.ultima_versione, INSTALLATA),
    controllato_il: s.aggiornamenti_controllati_il || null,
  };
}

// Legge l'ultima release e la registra; ritorna lo stato aggiornato. Un errore di rete non è grave:
// si riprova al giro successivo.
async function controlla() {
  if (!attivo()) return stato();
  const r = await fetch(URL_RELEASE, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'WayMatch' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`risposta ${r.status}`);
  const d = await r.json();
  const versione = String(d.tag_name || '').replace(/^v/, '');
  if (!numeri(versione)) throw new Error('versione non riconosciuta');
  // Solo un link a GitHub: il valore arriva dall'esterno e finisce in un href.
  const url = typeof d.html_url === 'string' && d.html_url.startsWith('https://github.com/') ? d.html_url : null;
  db.prepare(`UPDATE system_settings SET ultima_versione = ?, ultima_versione_url = ?, aggiornamenti_controllati_il = datetime('now') WHERE id = 1`)
    .run(versione, url);
  await avvisaMobilityManager();
  return stato();
}

// Un avviso a ogni Mobility Manager attivo, una volta per versione.
async function avvisaMobilityManager() {
  const s = stato();
  if (!s.disponibile) return 0;
  const messaggio = `È disponibile WayMatch ${s.ultima} (installata: ${s.installata}). Note di rilascio e istruzioni in Informazioni → Sistema.`;
  const mm = db.prepare("SELECT id FROM users WHERE attivo = 1 AND ruolo = 'mobility_manager'").all().map((u) => u.id);
  let avvisati = 0;
  for (const id of mm) {
    let esito;
    try {
      esito = db.transaction(() => {
        const nuovo = db.prepare('INSERT OR IGNORE INTO avvisi_nuova_versione (user_id, versione) VALUES (?, ?)').run(id, s.ultima).changes === 1;
        if (!nuovo) return null;
        return { inApp: inAppAttiva(id, 'nuova_versione') ? creaNotificaInApp(id, 'nuova_versione', messaggio) : null };
      })();
    } catch (e) {
      console.error(`[aggiornamenti] avviso al Mobility Manager ${id} non salvato:`, e.message);
      continue;
    }
    if (!esito) continue;
    avvisati++;
    await consegnaEsterna(id, 'nuova_versione', messaggio, esito.inApp);
  }
  return avvisati;
}

module.exports = { controlla, stato, piuRecente, attivo };
