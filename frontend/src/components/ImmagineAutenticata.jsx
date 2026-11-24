import React, { useEffect, useState } from 'react';
import { caricaImmagineAutenticata } from '../api.js';

// Per immagini caricate che si scaricano solo con il login: <img src> da solo non invia
// l'header Authorization.
export default function ImmagineAutenticata({ path, alt, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let attivo = true;
    caricaImmagineAutenticata(path)
      .then((u) => { url = u; if (attivo) setSrc(u); else URL.revokeObjectURL(u); })
      .catch(() => {});
    return () => { attivo = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (!src) return <div className={`${className || ''} bg-bg animate-pulse`} />;
  return <img src={src} alt={alt} className={className} />;
}
