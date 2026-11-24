import React from 'react';
import ErrorBanner from './ErrorBanner.jsx';

// Errore di caricamento con un'azione per riprovare, al posto di uno scheletro che non finisce mai.
export default function ErroreConRiprova({ messaggio, onRiprova }) {
  return (
    <div className="flex items-center justify-between gap-2" role="alert">
      <div className="flex-1"><ErrorBanner message={messaggio} /></div>
      {onRiprova && <button type="button" className="btn-outline !py-1 !text-xs shrink-0" onClick={onRiprova}>Riprova</button>}
    </div>
  );
}
