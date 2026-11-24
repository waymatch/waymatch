import React from 'react';
import { Link } from 'react-router-dom';
// Identità visiva di WayMatch (kit in assets/brand, usato senza modifiche). Qui c'è solo la
// piattaforma: il logo e i colori dell'azienda che la usa stanno in BrandHeader e nel Branding.
import lockup from '../../../assets/brand/svg/lockup/waymatch-lockup-on-light.svg';
import poweredBy from '../../../assets/brand/svg/lockup/waymatch-powered-by-on-light.svg';
import simbolo from '../../../assets/brand/svg/symbol/waymatch-symbol-on-light.svg';

export const CLAIM = 'Due strade, una via.';

// Logo principale (simbolo + nome). Sotto i 120 px di larghezza si usa il solo simbolo.
export function Lockup({ larghezza = 200, className = '' }) {
  if (larghezza < 120) return <Simbolo altezza={larghezza} className={className} />;
  return <img src={lockup} alt="WayMatch" width={larghezza} style={{ height: 'auto' }} className={className} />;
}

// Proporzioni del disegno (viewBox del simbolo nel kit). La larghezza è esplicita perché le
// dimensioni intrinseche dichiarate nel file non coincidono con il viewBox: con width "auto"
// il simbolo verrebbe rimpicciolito dentro un riquadro con proporzioni diverse.
export const RAPPORTO_SIMBOLO = 830 / 510;

export function Simbolo({ altezza = 32, className = '' }) {
  const larghezza = Math.round(altezza * RAPPORTO_SIMBOLO);
  return <img src={simbolo} alt="WayMatch" width={larghezza} height={altezza} style={{ height: altezza, width: larghezza }} className={className} />;
}

// "Powered by" discreto, nei piè di pagina: logo compatto del kit (on-light: l'app ha solo il tema chiaro).
export function PoweredBy({ className = '' }) {
  return (
    <Link to="/informazioni#progetto" className={`inline-flex items-center gap-1.5 text-[11px] leading-none text-muted hover:text-ink transition-colors ${className}`}>
      Powered by <img src={poweredBy} alt="WayMatch" height="12" style={{ height: 12, width: 'auto' }}  />
    </Link>
  );
}
