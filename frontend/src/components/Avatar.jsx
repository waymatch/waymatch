import React, { useEffect, useState } from 'react';
import { caricaImmagineAutenticata } from '../api.js';

// Foto del profilo, o le iniziali se non c'è. La foto arriva da un'API autenticata (un <img> non
// può mandare il token), quindi si scarica come blob; una sola volta per utente e versione.
// La copia in memoria vale 5 minuti: poi si richiede di nuovo (il server risponde 304 se non è
// cambiata), così una foto rimossa o di un account disattivato da un'altra sessione non resta
// visibile a lungo in una scheda aperta.
const DURATA_CACHE_MS = 5 * 60 * 1000;
// Ogni download è una "voce" con il conteggio degli avatar che la usano o la stanno aspettando:
// il conteggio sale nel momento della richiesta, non all'arrivo dell'immagine, così una voce non si
// libera mentre qualcuno la attende ancora. L'immagine (object URL) si revoca quando la voce non è
// più in cache e nessuno la tiene.
const cache = new Map(); // "id:versione" -> voce { promessa, alle, url, tenuta, fuori }
function liberaSePuoi(voce) {
  if (voce.fuori && voce.tenuta === 0) voce.promessa.then((url) => { if (url && voce.tenuta === 0) URL.revokeObjectURL(url); });
}
function togliDallaCache(chiave, voce) {
  if (cache.get(chiave) === voce) cache.delete(chiave);
  voce.fuori = true;
  liberaSePuoi(voce);
}
// Prende (e tiene) la voce attuale per un utente e una versione; va restituita con lascia().
function prendi(id, versione) {
  const chiave = `${id}:${versione}`;
  let voce = cache.get(chiave);
  if (!voce || Date.now() - voce.alle > DURATA_CACHE_MS) {
    const vecchia = voce;
    voce = { alle: Date.now(), url: null, tenuta: 0, fuori: false };
    const questa = voce;
    voce.promessa = caricaImmagineAutenticata(`/foto/${id}?v=${versione}`).then((url) => {
      questa.url = url;
      return url;
    }).catch(() => {
      togliDallaCache(chiave, questa); // un errore (o una foto non più disponibile) non resta per sempre
      return null;
    });
    cache.set(chiave, voce);
    if (vecchia) togliDallaCache(chiave, vecchia); // la copia sostituita, appena nessuno la tiene
  }
  voce.tenuta += 1;
  return voce;
}
function lascia(voce) {
  if (!voce) return;
  voce.tenuta -= 1;
  liberaSePuoi(voce);
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
    let tenuta = null; // la voce che questo avatar tiene (quella mostrata o in arrivo)
    const aggiorna = () => {
      const voce = prendi(id, versione);
      if (voce === tenuta) { lascia(voce); return; }
      voce.promessa.then((u) => {
        if (!attivo) { lascia(voce); return; } // arrivata dopo lo smontaggio
        lascia(tenuta);
        tenuta = voce;
        setSrc(u);
      });
    };
    aggiorna();
    // Anche un avatar che resta a lungo sullo schermo (per esempio nel menu) si riallinea.
    const timer = setInterval(aggiorna, DURATA_CACHE_MS + 1000);
    return () => { attivo = false; clearInterval(timer); lascia(tenuta); };
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
  for (const [k, v] of [...cache.entries()]) if (k.startsWith(`${id}:`)) togliDallaCache(k, v);
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: id }));
}
