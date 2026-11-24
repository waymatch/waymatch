import React from 'react';
import { dataISO } from '../dateTimeUtils.js';

const OPZIONI = [
  { label: 'Oggi', offset: 0 },
  { label: 'Domani', offset: 1 },
  { label: 'Dopodomani', offset: 2 },
];

// Scorciatoie sopra un input di tipo date: evita di dover ricordare a mente che giorno è
// oggi o fare i conti per "domani". "min", se passato, nasconde le opzioni già escluse
// dal vincolo minimo del campo (es. "Oggi" quando la data minima consentita è domani).
export default function DateQuickPicks({ value, onChange, min }) {
  return (
    <div className="flex gap-1.5 mt-1.5">
      {OPZIONI.map((o) => {
        const d = dataISO(o.offset);
        if (min && d < min) return null;
        return (
          <button
            type="button" key={o.offset} onClick={() => onChange(d)}
            className={`px-2.5 py-1 rounded-lg text-sm font-medium border transition-colors ${
              value === d ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted hover:bg-bg'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
