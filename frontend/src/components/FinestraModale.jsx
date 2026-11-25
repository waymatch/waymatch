import React, { useEffect, useRef } from 'react';

// Finestra modale accessibile: role="dialog", il focus entra nella finestra all'apertura, Tab
// resta al suo interno, Esc la chiude (se è chiudibile) e alla chiusura il focus torna dove era.
export default function FinestraModale({ titoloId, onClose, className, children }) {
  const ref = useRef(null);
  // Il listener è registrato una volta sola: legge onClose da qui, così vale sempre quello attuale
  // (per esempio null mentre un invio è in corso, quando Esc non deve chiudere).
  const chiudi = useRef(onClose);
  chiudi.current = onClose;
  useEffect(() => {
    const el = ref.current;
    const precedente = document.activeElement;
    // Anche gli iframe (il visualizzatore dei PDF) fanno parte del giro del Tab.
    const focusabili = () => [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')]
      .filter((e) => e.offsetParent !== null);
    (focusabili()[0] || el).focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && chiudi.current) { e.stopPropagation(); chiudi.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusabili();
      if (!f.length) { e.preventDefault(); return; }
      const primo = f[0], ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primo) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); if (precedente && precedente.focus) precedente.focus(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titoloId} tabIndex={-1} className={`${className} outline-none`}>
      {children}
    </div>
  );
}
