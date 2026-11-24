import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { hexToRgb, scurisci, schiarisci, derivatiAccento } from '../colori.js';

const BrandingContext = createContext(null);

const DEFAULTS = {
  company_name: 'La Mia Azienda',
  logo_path: null,
  primary_color: '#14424F',
  accent_color: '#3CC8B8',
  giorni_lavorativi: [1, 2, 3, 4, 5, 6], // 1 = lunedì ... 7 = domenica
  email_attive: false, // il server dice se SMTP è configurato
  mappa: null, // arriva dal server (TILE_URL); finché non c'è non si disegnano tile
};

const rgbStr = ([r, g, b]) => `${r} ${g} ${b}`;
const valido = (hex, predefinito) => hexToRgb(hex) || hexToRgb(predefinito);

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULTS);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/branding');
      setBranding({ ...DEFAULTS, ...data.branding });
    } catch (e) { /* usa i default se non raggiungibile */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const root = document.documentElement.style;
    const primaryRgb = valido(branding.primary_color, '#14424F');
    const accentRgb = valido(branding.accent_color, '#3CC8B8');
    root.setProperty('--color-primary', rgbStr(primaryRgb));
    root.setProperty('--color-primary-dark', rgbStr(scurisci(primaryRgb)));
    root.setProperty('--color-primary-light', rgbStr(schiarisci(primaryRgb)));
    const acc = derivatiAccento(accentRgb);
    root.setProperty('--color-accent', rgbStr(accentRgb));
    root.setProperty('--color-accent-dark', rgbStr(acc.scuro));
    root.setProperty('--color-accent-light', rgbStr(acc.chiaro));
    root.setProperty('--color-on-accent', rgbStr(acc.su));
    // Favicon, icona per iPhone e colore della barra del browser seguono l'azienda: icona caricata,
    // altrimenti il suo logo, altrimenti WayMatch.
    const v = branding.icona?.versione;
    const personalizzata = !!branding.icona?.personalizzata;
    const imposta = (selettore, crea, attributi) => {
      let el = document.head.querySelector(selettore);
      if (!el) { el = document.createElement(crea); document.head.appendChild(el); }
      Object.entries(attributi).forEach(([k, val]) => el.setAttribute(k, val));
    };
    imposta('link[rel="icon"][data-wm]', 'link', { rel: 'icon', 'data-wm': '1', type: 'image/png', href: personalizzata ? `/api/branding/icona/32.png?v=${v}` : '/brand/favicon.svg' });
    if (personalizzata) document.head.querySelectorAll('link[rel="icon"]:not([data-wm])').forEach((el) => el.remove());
    imposta('link[rel="apple-touch-icon"]', 'link', { rel: 'apple-touch-icon', href: personalizzata ? `/api/branding/icona/180.png?v=${v}` : '/brand/apple-touch-icon.png' });
    imposta('meta[name="theme-color"]', 'meta', { name: 'theme-color', content: branding.primary_color || '#14424F' });
    document.title = branding.company_name ? `${branding.company_name} · WayMatch` : 'WayMatch';
  }, [branding]);

  return (
    <BrandingContext.Provider value={{ branding, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
