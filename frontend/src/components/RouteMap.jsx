import React from 'react';
import { MapContainer, Marker, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { defaultIcon as startIcon } from '../leafletIcons.js';
import MapTileLayers from './MapTileLayers.jsx';

function FitBounds({ points }) {
  const map = useMap();
  React.useEffect(() => {
    if (points && points.length > 1) {
      map.fitBounds(points, { padding: [30, 30] });
    } else if (points && points.length === 1) {
      map.setView(points[0], 13);
    }
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
