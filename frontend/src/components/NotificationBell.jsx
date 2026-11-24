import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { api } from '../api.js';

function tempoFa(dataStr) {
  const diffMs = Date.now() - new Date(dataStr.replace(' ', 'T') + 'Z').getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'ora';
  if (min < 60) return `${min} min fa`;
  const ore = Math.floor(min / 60);
  if (ore < 24) return `${ore} h fa`;
  return `${Math.floor(ore / 24)} g fa`;
}

const PANEL_MARGIN = 12;

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifiche, setNotifiche] = useState([]);
  const [nonLette, setNonLette] = useState(0);
  const [pos, setPos] = useState(null);
  const btnRef = useRef();
  const panelRef = useRef();

  const load = useCallback(() => {
    api.get('/notifications').then((d) => {
      setNotifiche(d.notifiche);
      setNonLette(d.non_lette);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  const computePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const panelWidth = Math.min(340, window.innerWidth - PANEL_MARGIN * 2);
    let left = rect.right - panelWidth; // allinea il bordo destro del pannello al bottone
    left = Math.min(left, window.innerWidth - panelWidth - PANEL_MARGIN);
    left = Math.max(left, PANEL_MARGIN);
    const top = rect.bottom + 8;
    // La lista scorre dentro lo spazio visibile: sotto la campanella, tolti intestazione e margine.
    const altezzaLista = Math.max(120, window.innerHeight - top - 52 - PANEL_MARGIN);
    setPos({ top, left, width: panelWidth, altezzaLista });
  }, []);

  const toggle = () => {
    if (!open) { computePosition(); load(); }
    setOpen((v) => !v);
  };

  // Aperto il pannello, il focus va al pannello (anche da tastiera); Esc lo chiude e riporta il
  // focus sulla campanella.
  const chiudi = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);
  // Solo all'apertura: un ricalcolo della posizione (ridimensionamento) non sposta il focus.
  const appenaAperto = useRef(false);
  useEffect(() => {
    if (!open) { appenaAperto.current = false; return; }
    if (pos && !appenaAperto.current) {
      appenaAperto.current = true;
      panelRef.current?.focus();
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); chiudi(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, chiudi]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => computePosition();
    const onClickOutside = (e) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, computePosition]);

  const segnaLetta = async (id) => {
    try {
      await api.put(`/notifications/${id}/letta`);
      load();
    } catch (e) { /* non bloccante: riprovare al prossimo refresh */ }
  };
  const leggiTutte = async () => {
    try {
      await api.put('/notifications/leggi-tutte');
      load();
    } catch (e) { /* non bloccante: riprovare al prossimo refresh */ }
  };
  const apriNotifica = async (n) => {
    try {
      if (!n.letta) await api.put(`/notifications/${n.id}/letta`);
    } catch (e) { /* non bloccante: la navigazione deve avvenire comunque */ }
    setOpen(false);
    load();
    // n.url è calcolato una sola volta dal backend alla creazione (vedi utils/notify.js);
    // il fallback copre solo le notifiche già esistenti prima di questo campo.
    navigate(n.url || '/i-miei-viaggi');
  };

  return (
    <>
      <button
        ref={btnRef}
        className="relative p-2 text-muted hover:text-ink rounded-lg hover:bg-bg"
        onClick={toggle}
        aria-label={nonLette > 0 ? `Notifiche, ${nonLette} da leggere` : 'Notifiche'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={19} aria-hidden="true" />
        {nonLette > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent" />}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifiche"
          tabIndex={-1}
          className="fixed bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden outline-none"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="font-display font-semibold text-sm">Notifiche</p>
            {nonLette > 0 && (
              <button className="text-xs text-primary flex items-center gap-1" onClick={leggiTutte}>
                <Check size={12} /> Segna tutte lette
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto" style={{ maxHeight: Math.min(320, pos.altezzaLista) }}>
            {notifiche.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">Nessuna notifica.</p>
            ) : (
              notifiche.map((n) => (
                <button
                  key={n.id}
                  className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-bg ${!n.letta ? 'bg-primary-light/40' : ''}`}
                  onClick={() => apriNotifica(n)}
                >
                  <p className="text-sm">{n.messaggio}</p>
                  <p className="text-xs text-muted mt-1">{tempoFa(n.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
