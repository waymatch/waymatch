import React from 'react';
import { MapContainer, Marker, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { defaultIcon as startIcon } from '../leafletIcons.js';
import MapTileLayers from './MapTileLayers.jsx';

function FitBounds({ points }) {
  const map = useMap();
  React.useEffect(() => {
    const adatta = () => {
      if (points && points.length > 1) map.fitBounds(points, { padding: [30, 30] });
      else if (points && points.length === 1) map.setView(points[0], 13);
    };
    adatta();
    // Se la mappa nasce in un contenitore nascosto (dimensione zero) e poi diventa visibile, Leaflet
    // non se ne accorge: all'apparire si ricalcolano la dimensione e l'adattamento al percorso.
    const contenitore = map.getContainer();
    let eraNascosta = contenitore.clientWidth === 0 || contenitore.clientHeight === 0;
    let osservatore = null;
    if (typeof ResizeObserver !== 'undefined') {
      osservatore = new ResizeObserver(() => {
        const nascosta = contenitore.clientWidth === 0 || contenitore.clientHeight === 0;
        if (eraNascosta && !nascosta) { map.invalidateSize(); adatta(); }
        eraNascosta = nascosta;
      });
      osservatore.observe(contenitore);
    }
    return () => osservatore && osservatore.disconnect();
  }, [points, map]);
  return null;
}

// points: array di [lat, lon] per la polilinea del percorso.
// markers: array opzionale di { position: [lat, lon], label }
export default function RouteMap({ points, markers = [], height = 220 }) {
  if (!points || points.length === 0) {
    return (
      <div
        className="rounded-xl bg-bg border border-border flex items-center justify-center text-xs text-muted"
        style={{ height }}
      >
        Mappa non disponibile per questo tragitto
      </div>
    );
  }

  const center = points[Math.floor(points.length / 2)];

  return (
    <div className="rounded-xl overflow-hidden border border-border" style={{ height }}>
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <MapTileLayers />
        <Polyline positions={points} pathOptions={{ color: '#0B6E66', weight: 4 }} />
        {markers.map((m, i) => (
          <Marker key={i} position={m.position} icon={startIcon} />
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
