import React from 'react';
import { TileLayer } from 'react-leaflet';
import { useBranding } from '../context/BrandingContext.jsx';

// Livello tile della mappa. Il provider lo sceglie il gestore dell'installazione con TILE_URL
// nel .env (il server lo comunica insieme al branding): qui non c'è nessun indirizzo fisso.
//
// referrerPolicy: l'app di norma non manda il Referer a nessuno (Referrer-Policy: no-referrer),
// ma i provider di tile lo richiedono per identificare il sito: OpenStreetMap risponde con una
// tile "403 Access blocked" ai browser che non lo mandano. Alle sole tile mandiamo l'origine del
// sito (es. https://carpooling.azienda.it), mai il percorso della pagina.
export default function MapTileLayers() {
  const { branding } = useBranding();
  const mappa = branding?.mappa;
  if (!mappa) return null;

  return (
    <TileLayer
      key={mappa.url}
      url={mappa.url}
      attribution={mappa.attribuzione}
      maxNativeZoom={mappa.maxZoom}
      maxZoom={Math.max(19, mappa.maxZoom)}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
