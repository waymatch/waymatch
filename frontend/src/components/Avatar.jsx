import React, { useEffect, useState } from 'react';
import { caricaImmagineAutenticata } from '../api.js';

// Foto del profilo, o le iniziali se non c'è. La foto arriva da un'API autenticata (un <img> non
// può mandare il token), quindi si scarica come blob; una sola volta per utente e versione.
// La copia in memoria vale 5 minuti: poi si richiede di nuovo (il server risponde 304 se non è
// cambiata), così una foto rimossa o di un account disattivato da un'altra sessione non resta
// visibile a lungo in una scheda aperta.
const DURATA_CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // "id:versione" -> { promessa, alle }
// Quanti avatar mostrano ogni object URL: lo si revoca (liberando l'immagine) quando nessuno lo
// usa più e non è più quello in cache.
const inUso = new Map();
const correnti = () => new Set([...cache.values()].map((v) => v.url).filter(Boolean));
function forseRevoca(url) {
  if (url && !inUso.get(url) && !correnti().has(url)) URL.revokeObjectURL(url);
}
function urlFoto(id, versione) {
  const chiave = `${id}:${versione}`;
  const voce = cache.get(chiave);
  if (!voce || Date.now() - voce.alle > DURATA_CACHE_MS) {
    const nuova = { alle: Date.now(), url: null };
    nuova.promessa = caricaImmagineAutenticata(`/foto/${id}?v=${versione}`).then((url) => {
      nuova.url = url;
      return url;
    }).catch(() => {
      if (cache.get(chiave) === nuova) cache.delete(chiave); // un errore (o una foto non più disponibile) non resta per sempre
      return null;
    });
    cache.set(chiave, nuova);
    if (voce) voce.promessa.then(forseRevoca); // la copia sostituita, se nessuno la mostra
    return nuova.promessa;
  }
  return voce.promessa;
}
function usa(url) { if (url) inUso.set(url, (inUso.get(url) || 0) + 1); }
function rilascia(url) {
  if (!url) return;
  const n = (inUso.get(url) || 1) - 1;
  if (n > 0) inUso.set(url, n); else inUso.delete(url);
  forseRevoca(url);
}

const LATI = { xs: 'w-6 h-6 text-[10px]', sm: 'w-9 h-9 text-sm', lg: 'w-16 h-16 text-xl' };

export default function Avatar({ id, nome, cognome, versione, dimensione = 'sm', className = '' }) {
  const [src, setSrc] = useState(null);
  const [giro, setGiro] = useState(0); // cresce quando la foto di questo utente cambia altrove nell'app
  useEffect(() => {
    const cambiata = (e) => { if (String(e.detail) === String(id)) setGiro((g) => g + 1); };
    window.addEventListener(EVENTO, cambiata);
    return () => window.removeEventListener(EVENTO, cambiata);
  }, [id]);
  useEffect(() => {
    setSrc(null);
    if (!id || !versione) return undefined;
    let attivo = true;
    let mostrato = null; // l'object URL che questo avatar sta usando
    const aggiorna = () => urlFoto(id, versione).then((u) => {
      if (!attivo) { forseRevoca(u); return; } // arrivata dopo lo smontaggio: si libera se non serve ad altri
      if (u === mostrato) return;
      usa(u);
      rilascia(mostrato);
      mostrato = u;
      setSrc(u);
    });
    aggiorna();
    // Anche un avatar che resta a lungo sullo schermo (per esempio nel menu) si riallinea.
    const timer = setInterval(aggiorna, DURATA_CACHE_MS + 1000);
    return () => { attivo = false; clearInterval(timer); rilascia(mostrato); };
  }, [id, versione, giro]);

  const lato = LATI[dimensione] || LATI.sm;
  // Il nome è sempre scritto accanto: la foto è decorativa per chi usa un lettore di schermo.
  if (src) return <img src={src} alt="" className={`${lato} rounded-full object-cover shrink-0 ${className}`} />;
  return (
    <span aria-hidden="true" className={`${lato} rounded-full bg-accent-light text-accent-dark flex items-center justify-center font-display font-semibold shrink-0 ${className}`}>
      {nome?.[0]}{cognome?.[0]}
    </span>
  );
}

// Dopo un nuovo caricamento o una rimozione: le versioni già scaricate di quell'utente non servono più,
// e gli avatar già mostrati (per esempio quello nel menu) si aggiornano.
const EVENTO = 'waymatch:foto-cambiata';
export function dimenticaFoto(id) {
  for (const [k, v] of [...cache.entries()]) {
    // Anche un download ancora in corso: l'immagine si libera quando arriva, se nessuno la usa.
    if (k.startsWith(`${id}:`)) { cache.delete(k); v.promessa.then(forseRevoca); }
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: id }));
}
