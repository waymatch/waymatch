import React, { useEffect, useState } from 'react';
import { caricaImmagineAutenticata } from '../api.js';

// Foto del profilo, o le iniziali se non c'è. La foto arriva da un'API autenticata (un <img> non
// può mandare il token), quindi si scarica come blob; una sola volta per utente e versione.
const cache = new Map();
function urlFoto(id, versione) {
  const chiave = `${id}:${versione}`;
  if (!cache.has(chiave)) {
    cache.set(chiave, caricaImmagineAutenticata(`/foto/${id}?v=${versione}`).catch(() => {
      cache.delete(chiave); // un errore temporaneo non resta per sempre
      return null;
    }));
  }
  return cache.get(chiave);
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
    urlFoto(id, versione).then((u) => { if (attivo) setSrc(u); });
    return () => { attivo = false; };
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
  for (const k of cache.keys()) if (k.startsWith(`${id}:`)) cache.delete(k);
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: id }));
}
