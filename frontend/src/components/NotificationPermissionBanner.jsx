import React, { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { pushSupportato, statoPermesso, attivaPush } from '../push.js';

const DISMISS_KEY = 'push_prompt_dismesso';

// Preferenza facoltativa: se il browser non permette di salvarla (modalità privata, storage
// bloccato) il banner funziona lo stesso e si chiude comunque.
function leggiPreferenza(chiave) {
  try { return localStorage.getItem(chiave); } catch { return null; }
}
function scriviPreferenza(chiave) {
  try { localStorage.setItem(chiave, '1'); } catch { /* non persistente */ }
}

export default function NotificationPermissionBanner() {
  const [visibile, setVisibile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState('');

  useEffect(() => {
    if (!pushSupportato()) return;
    if (leggiPreferenza(DISMISS_KEY)) return;
    statoPermesso().then((p) => setVisibile(p === 'default'));
  }, []);

  if (!visibile) return null;

  const attiva = async () => {
    setLoading(true);
    setErrore('');
    try {
      await attivaPush();
      setVisibile(false);
    } catch (e) {
      // Il banner resta, con il messaggio e il pulsante per riprovare.
      setErrore(e.message);
    } finally {
      setLoading(false);
    }
  };

  const chiudi = () => {
    scriviPreferenza(DISMISS_KEY);
    setVisibile(false);
  };

  return (
    <div className="card mb-4 flex items-start gap-3 bg-primary-light border-primary/20">
      <div className="w-9 h-9 rounded-lg bg-primary text-white flex items-center justify-center shrink-0">
        <Bell size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary-dark">Attiva le notifiche</p>
        <p className="text-xs text-primary-dark/80 mt-0.5">
          Ricevi un avviso quando qualcuno richiede o conferma un tuo passaggio, anche ad app chiusa.
        </p>
        {errore && <p className="text-xs text-danger mt-1" role="alert">{errore}</p>}
        <div className="flex gap-2 mt-2.5">
          <button className="btn-primary !py-1.5 !text-xs" disabled={loading} onClick={attiva}>
            {loading ? 'Attivazione...' : 'Attiva notifiche'}
          </button>
          <button className="btn-ghost !py-1.5 !text-xs text-primary-dark" onClick={chiudi}>
            Non ora
          </button>
        </div>
      </div>
      <button onClick={chiudi} aria-label="Chiudi il suggerimento sulle notifiche" className="p-1 text-primary-dark/60 hover:text-primary-dark shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}
