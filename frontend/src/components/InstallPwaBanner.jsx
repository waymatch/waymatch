import React, { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

const DISMISS_KEY = 'pwa_install_dismesso';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Preferenza facoltativa: se il browser non permette di salvarla (modalità privata, storage
// bloccato) il banner funziona lo stesso e si chiude comunque.
function leggiPreferenza(chiave) {
  try { return localStorage.getItem(chiave); } catch { return null; }
}
function scriviPreferenza(chiave) {
  try { localStorage.setItem(chiave, '1'); } catch { /* non persistente */ }
}

export default function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [mostraIos, setMostraIos] = useState(false);
  const [visibile, setVisibile] = useState(false);

  useEffect(() => {
    if (isStandalone() || leggiPreferenza(DISMISS_KEY)) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisibile(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS Safari non supporta beforeinstallprompt: mostriamo istruzioni manuali
    if (isIos()) {
      setMostraIos(true);
      setVisibile(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (!visibile) return null;

  const installa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisibile(false);
  };

  const chiudi = () => {
    scriviPreferenza(DISMISS_KEY);
    setVisibile(false);
  };

  return (
    <div className="card mb-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
        <Download size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Installa l'app</p>
        {mostraIos ? (
          <p className="text-xs text-muted mt-0.5">
            Tocca <Share size={12} className="inline -mt-0.5" /> "Condividi" e poi "Aggiungi a schermata Home"
            per usare Carpooling come un'app, anche offline dalla home del telefono.
          </p>
        ) : (
          <p className="text-xs text-muted mt-0.5">
            Aggiungila alla schermata Home per aprirla come un'app, con accesso più rapido e notifiche.
          </p>
        )}
        {!mostraIos && (
          <button className="btn-primary !py-1.5 !text-xs mt-2.5" onClick={installa}>
            Installa ora
          </button>
        )}
      </div>
      <button onClick={chiudi} aria-label="Chiudi il suggerimento di installazione" className="p-1 text-muted hover:text-ink shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}
