import React, { useState, useRef, useEffect } from 'react';
import { MapContainer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Loader2, Move } from 'lucide-react';
import { api } from '../api.js';
import { defaultIcon as pinIcon } from '../leafletIcons.js';
import MapTileLayers from './MapTileLayers.jsx';

// Campo di ricerca indirizzo con autocomplete basato su OpenStreetMap (Nominatim + Photon).
// onSelect riceve { label, lat, lon }. Se l'utente digita senza selezionare un
// suggerimento, value resta comunque un testo libero (onSelect non viene chiamato).
// Dopo la selezione mostra una mini mappa con uno spillo trascinabile, per correggere a
// mano la posizione quando la ricerca automatica non è precisa (es. un civico particolare,
// o un locale non ancora mappato per nome su OpenStreetMap).
// `correggibile` (predefinito sì): mostra lo spillo trascinabile. Va disattivato quando chi usa il
// campo salva solo il testo dell'indirizzo e non le coordinate.
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, correggibile = true }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [posizione, setPosizione] = useState(null); // { lat, lon } dopo una selezione
  const [selectionId, setSelectionId] = useState(0); // cambia solo con una nuova selezione, non col trascinamento
  const [mostraCorrezione, setMostraCorrezione] = useState(false);
  const debounceRef = useRef();
  const wrapperRef = useRef();
  const richiestaRef = useRef(0); // identifica la ricerca corrente: le risposte superate si ignorano

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    onChange && onChange(val);
    setPosizione(null); // un nuovo testo libero invalida la posizione precedente
    clearTimeout(debounceRef.current);
    const mia = ++richiestaRef.current; // ogni modifica invalida le ricerche già partite
    if (val.trim().length < 3) { setSuggestions([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get(`/geo/search?q=${encodeURIComponent(val)}`);
        if (mia !== richiestaRef.current) return;
        setSuggestions(data.results || []);
        setOpen(true);
      } catch (e) {
        if (mia === richiestaRef.current) setSuggestions([]);
      } finally {
        if (mia === richiestaRef.current) setLoading(false);
      }
    }, 500);
  };

  const select = (s) => {
    clearTimeout(debounceRef.current);
    richiestaRef.current++; // una selezione invalida le ricerche in corso: non riaprono il menu
    setLoading(false);
    setQuery(s.display_name);
    setOpen(false);
    setSuggestions([]);
    setPosizione({ lat: s.lat, lon: s.lon });
    setSelectionId((id) => id + 1);
    setMostraCorrezione(false);
    onSelect && onSelect({ label: s.display_name, lat: s.lat, lon: s.lon, citta: s.citta || null });
  };

  const spostaSpillo = (e) => {
    const { lat, lng } = e.target.getLatLng();
    setPosizione({ lat, lon: lng });
    onSelect && onSelect({ label: query, lat, lon: lng });
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input !pl-9"
          value={query}
          placeholder={placeholder || 'Cerca un indirizzo...'}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
        />
        {loading && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted animate-spin" />}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-bg flex items-start gap-2 border-b border-border last:border-0"
              onClick={() => select(s)}
            >
              <MapPin size={14} className="mt-0.5 text-muted shrink-0" />
              <span className="truncate">{s.display_name}</span>
            </button>
          ))}
        </div>
      )}

      {correggibile && posizione && !mostraCorrezione && (
        <button
          type="button"
          onClick={() => setMostraCorrezione(true)}
          className="mt-1.5 text-xs text-muted hover:text-primary flex items-center gap-1"
        >
          <Move size={12} /> Non è il punto esatto? Correggi la posizione sulla mappa
        </button>
      )}

      {correggibile && posizione && mostraCorrezione && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted flex items-center gap-1">
              <Move size={12} /> Trascina lo spillo per correggere la posizione.
            </p>
            <button type="button" onClick={() => setMostraCorrezione(false)} className="text-xs text-muted hover:text-primary shrink-0">
              Nascondi
            </button>
          </div>
          <div className="rounded-xl overflow-hidden border border-border" style={{ height: 160 }}>
            <MapContainer
              key={selectionId}
              center={[posizione.lat, posizione.lon]}
              zoom={17}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={true}
              doubleClickZoom={true}
            >
              <MapTileLayers />
              <Marker
                position={[posizione.lat, posizione.lon]}
                icon={pinIcon}
                draggable={true}
                eventHandlers={{ dragend: spostaSpillo }}
              />
            </MapContainer>
          </div>
        </div>
      )}
    </div>
  );
}
