import React, { useEffect, useRef, useState } from 'react';
import FinestraModale from './FinestraModale.jsx';

// Scelta della parte di foto da usare nel profilo: si sposta trascinando (o con le frecce) e si
// ingrandisce con il cursore, dentro il cerchio in cui la foto comparirà. Il ritaglio si fa nel
// browser; il server poi la riduce comunque e ne toglie i metadati.
const LATO = 256; // lato dell'anteprima, in pixel
const USCITA = 512; // lato dell'immagine mandata al server
const ZOOM_MAX = 4;
const PASSO = 10; // pixel per freccia

export default function RitaglioFoto({ file, onAnnulla, onConferma }) {
  const [img, setImg] = useState(null); // { el, w, h, url }
  const [errore, setErrore] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // angolo in alto a sinistra della foto nell'anteprima
  const trascina = useRef(null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const w = el.naturalWidth, h = el.naturalHeight;
      const s = LATO / Math.min(w, h);
      setImg({ el, w, h, url });
      setPos({ x: (LATO - w * s) / 2, y: (LATO - h * s) / 2 });
    };
    el.onerror = () => setErrore('Non riesco ad aprire questa immagine: usa un JPEG o un PNG.');
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scala = img ? (LATO / Math.min(img.w, img.h)) * zoom : 1;
  // La foto deve sempre coprire tutto il cerchio: niente bordi vuoti.
  const limita = (p, s = scala) => {
    if (!img) return p;
    const W = img.w * s, H = img.h * s;
    return { x: Math.min(0, Math.max(LATO - W, p.x)), y: Math.min(0, Math.max(LATO - H, p.y)) };
  };
  const cambiaZoom = (z) => {
    if (!img) return;
    const nuova = (LATO / Math.min(img.w, img.h)) * z;
    // Si ingrandisce attorno al centro dell'anteprima.
    const cx = (LATO / 2 - pos.x) / scala, cy = (LATO / 2 - pos.y) / scala;
    setZoom(z);
    setPos(limita({ x: LATO / 2 - cx * nuova, y: LATO / 2 - cy * nuova }, nuova));
  };

  const giu = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    trascina.current = { x: e.clientX, y: e.clientY, pos };
  };
  const muovi = (e) => {
    const t = trascina.current;
    if (!t) return;
    setPos(limita({ x: t.pos.x + e.clientX - t.x, y: t.pos.y + e.clientY - t.y }));
  };
  const su = () => { trascina.current = null; };
  const tasto = (e) => {
    const d = { ArrowLeft: [PASSO, 0], ArrowRight: [-PASSO, 0], ArrowUp: [0, PASSO], ArrowDown: [0, -PASSO] }[e.key];
    if (d) { e.preventDefault(); setPos((p) => limita({ x: p.x + d[0], y: p.y + d[1] })); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); cambiaZoom(Math.min(ZOOM_MAX, zoom + 0.25)); }
    if (e.key === '-') { e.preventDefault(); cambiaZoom(Math.max(1, zoom - 0.25)); }
  };

  const conferma = () => {
    setInCorso(true);
    const canvas = document.createElement('canvas');
    canvas.width = USCITA; canvas.height = USCITA;
    const lato = LATO / scala;
    canvas.getContext('2d').drawImage(img.el, -pos.x / scala, -pos.y / scala, lato, lato, 0, 0, USCITA, USCITA);
    canvas.toBlob((blob) => {
      if (!blob) { setErrore('Non riesco a preparare la foto.'); setInCorso(false); return; }
      onConferma(blob);
    }, 'image/jpeg', 0.92);
  };

  return (
    <FinestraModale titoloId="ritaglio-titolo" onClose={inCorso ? null : onAnnulla} className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <h2 id="ritaglio-titolo" className="font-display font-semibold text-base">Scegli la parte della foto</h2>
        {errore ? <p className="text-sm text-danger" role="alert">{errore}</p> : (
          <>
            <div
              role="img"
              aria-label="Anteprima della foto: trascinala o usa le frecce per spostarla, + e - per ingrandire"
              tabIndex={0}
              onKeyDown={tasto}
              onPointerDown={giu}
              onPointerMove={muovi}
              onPointerUp={su}
              onPointerCancel={su}
              className="relative mx-auto rounded-full overflow-hidden bg-bg cursor-grab active:cursor-grabbing touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{ width: LATO, height: LATO }}
            >
              {img && (
                <img src={img.url} alt="" draggable={false} className="absolute pointer-events-none"
                  style={{ left: pos.x, top: pos.y, width: img.w * scala, height: img.h * scala, maxWidth: 'none' }} />
              )}
            </div>
            <label className="block text-sm">
              <span className="text-muted">Ingrandimento</span>
              <input type="range" min="1" max={ZOOM_MAX} step="0.01" value={zoom} disabled={!img}
                onChange={(e) => cambiaZoom(Number(e.target.value))} className="w-full mt-1" />
            </label>
          </>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" className="btn-outline" onClick={onAnnulla} disabled={inCorso}>Annulla</button>
          <button type="button" className="btn-primary" onClick={conferma} disabled={!img || !!errore || inCorso}>
            {inCorso ? 'Caricamento…' : 'Usa questa foto'}
          </button>
        </div>
      </div>
    </FinestraModale>
  );
}
