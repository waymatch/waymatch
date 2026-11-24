import React, { useEffect, useState } from 'react';
import { caricaImmagineAutenticata } from '../api.js';

// Per immagini caricate che si scaricano solo con il login: <img src> da solo non invia
// l'header Authorization.
export default function ImmagineAutenticata({ path, alt, className }) {
  // L'URL è legato al percorso da cui viene: cambiando immagine non resta visibile la precedente.
  const [stato, setStato] = useState({ path: null, src: null, errore: false });
  const [tentativo, setTentativo] = useState(0);
  useEffect(() => {
    let url = null;
    let attivo = true;
    setStato({ path, src: null, errore: false });
    caricaImmagineAutenticata(path)
      .then((u) => { url = u; if (attivo) setStato({ path, src: u, errore: false }); else URL.revokeObjectURL(u); })
      .catch(() => { if (attivo) setStato({ path, src: null, errore: true }); });
    return () => { attivo = false; if (url) URL.revokeObjectURL(url); };
  }, [path, tentativo]);
  if (stato.path === path && stato.errore) {
    return (
      <div className={`${className || ''} bg-bg flex flex-col items-center justify-center gap-1 text-xs text-muted p-2`} role="alert">
        <span>Immagine non disponibile.</span>
        <button type="button" className="underline text-primary" onClick={() => setTentativo((t) => t + 1)}>Riprova</button>
      </div>
    );
  }
  if (stato.path !== path || !stato.src) return <div className={`${className || ''} bg-bg animate-pulse`} aria-busy="true" />;
  return <img src={stato.src} alt={alt} className={className} />;
}
