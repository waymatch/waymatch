import React from 'react';

// Navigazione a schede usata da Profilo, Impostazioni generali e Guida: stesso aspetto ovunque.
// - Schermo largo (lg): elenco verticale a sinistra, contenuto a destra, così le pagine con molte
//   schede usano tutto lo spazio invece di una colonna stretta.
// - Telefono e tablet: barra orizzontale in alto che scorre se le voci non entrano.
// `sotto` (opzionale) è un blocco mostrato sotto l'elenco sullo schermo largo (es. l'indice della guida).
export default function Schede({ schede, attiva, onChange, sotto, children }) {
  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
      <div className="lg:sticky lg:top-6 space-y-4">
        <nav aria-label="Sezioni" className="flex gap-1 bg-bg p-1 rounded-xl border border-border overflow-x-auto lg:flex-col lg:overflow-visible lg:bg-surface lg:p-2">
          {schede.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              aria-current={attiva === s.id ? 'page' : undefined}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap lg:whitespace-normal transition-colors lg:w-full lg:text-left ${
                attiva === s.id ? 'bg-primary-light text-primary-dark' : 'text-muted hover:bg-bg'
              }`}
            >
              {s.icon && <s.icon size={16} className="shrink-0" />}
              {s.label}
            </button>
          ))}
        </nav>
        {sotto && <div className="hidden lg:block">{sotto}</div>}
      </div>
      <div className="space-y-6 min-w-0">{children}</div>
    </div>
  );
}
