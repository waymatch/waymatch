import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';

// Mostra lo slider di pertinenza se l'utente ha impostato l'indirizzo di casa, altrimenti
// un invito a impostarlo — in entrambi i casi nello stesso punto della pagina, così non
// "salta" quando l'utente lo imposta.
export default function RelevanceSlider({ user, value, onChange }) {
  if (user?.casa_lat == null) {
    return (
      <div className="card bg-primary-light border-none flex items-center gap-3 !py-3">
        <MapPin size={16} className="text-primary-dark shrink-0" />
        <p className="text-xs text-primary-dark flex-1">
          Imposta il tuo indirizzo di casa nel profilo per vedere prima i passaggi più comodi per te.
        </p>
        <Link to="/profilo" className="text-xs font-semibold text-primary-dark shrink-0 underline">
          Vai al profilo
        </Link>
      </div>
    );
  }

  return (
    <div className="card flex items-center gap-3 !py-3 lg:max-w-sm">
      <MapPin size={16} className="text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted">Distanza massima dal tuo percorso</label>
          <span className="text-xs font-semibold text-primary shrink-0">{value} m</span>
        </div>
        <input
          type="range" min="100" max="2000" step="100"
          className="w-full mt-1.5 accent-primary"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
