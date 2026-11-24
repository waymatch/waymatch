import FinestraModale from './FinestraModale.jsx';
import React, { useState, useEffect, useCallback } from 'react';
import ErrorBanner from './ErrorBanner.jsx';
import { X, RefreshCw, Route, Plus, Trash2, Coffee, MapPin } from 'lucide-react';
import { api } from '../api.js';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import RouteMap from './RouteMap.jsx';

function emptyStop() { return { orario: '', luogo: '', descrizione: '', lat: null, lon: null }; }

export default function EditRideModal({ ride, minPosti, onClose, onSaved }) {
  const isAndata = ride.tipo === 'andata';
  const [sedi, setSedi] = useState([]);
  const [data, setData] = useState(ride.data);
  const [ora, setOra] = useState(ride.ora);
  const [sedeId, setSedeId] = useState(String(ride.sede_id || ''));
  const [homeLabel, setHomeLabel] = useState(isAndata ? ride.punto_partenza : ride.punto_arrivo);
  const [homeLat, setHomeLat] = useState(isAndata ? ride.partenza_lat : ride.arrivo_lat);
  const [homeLon, setHomeLon] = useState(isAndata ? ride.partenza_lon : ride.arrivo_lon);
  const [citta, setCitta] = useState(ride.citta_domicilio || '');
  const [km, setKm] = useState(ride.km_stimati || '');
  const [geometria, setGeometria] = useState(ride.geometria || null);
  const [alternative, setAlternative] = useState([]);
  const [sceltaPercorso, setSceltaPercorso] = useState(0);
  const [calcolando, setCalcolando] = useState(false);
  const [postiTotali, setPostiTotali] = useState(ride.posti_totali);
  const [note, setNote] = useState(ride.note || '');
  const [soste, setSoste] = useState(ride.soste?.length ? ride.soste : []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/sedi').then((d) => setSedi(d.sedi)); }, []);

  const calcolaTratta = useCallback(async () => {
    const sede = sedi.find((s) => String(s.id) === String(sedeId));
    if (!sede?.lat || !sede?.lon || !homeLat || !homeLon) return;
    setCalcolando(true);
    setError('');

    const sosteValide = soste.filter((s) => s.lat != null && s.lon != null);
    const sosteOrdinate = [...sosteValide].sort((a, b) => (a.orario || '99:99').localeCompare(b.orario || '99:99'));

    try {
      if (sosteOrdinate.length > 0) {
        const puntoCasa = { lat: homeLat, lon: homeLon };
        const puntoSede = { lat: sede.lat, lon: sede.lon };
        const tappeSoste = sosteOrdinate.map((s) => ({ lat: s.lat, lon: s.lon }));
        // andata: casa -> soste -> sede | ritorno: sede -> soste -> casa
        const punti = isAndata ? [puntoCasa, ...tappeSoste, puntoSede] : [puntoSede, ...tappeSoste, puntoCasa];
        const d = await api.post('/geo/route-multi', { punti });
        setKm(d.km);
        setGeometria(d.geometria);
        setAlternative([]);
        setSceltaPercorso(0);
      } else {
        const params = new URLSearchParams({ from_lat: homeLat, from_lon: homeLon, to_lat: sede.lat, to_lon: sede.lon });
        const d = await api.get(`/geo/route?${params.toString()}`);
        setKm(d.km);
        setGeometria(d.geometria);
        setAlternative(d.alternative || []);
        setSceltaPercorso(0);
      }
    } catch (e) {
      setError('Impossibile ricalcolare il percorso, correggi i km manualmente.');
    } finally {
      setCalcolando(false);
    }
  }, [sedi, sedeId, homeLat, homeLon, soste, isAndata]);

  // Ricalcola automaticamente quando cambia sede, indirizzo di casa o soste validate,
  // senza dover premere il pulsante di aggiornamento manuale (rimane comunque disponibile
  // per un nuovo tentativo).
  const sosteCoordKey = soste.map((s) => `${s.lat ?? ''},${s.lon ?? ''}`).join('|');
  useEffect(() => {
    calcolaTratta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId, homeLat, homeLon, sedi, sosteCoordKey]);

  const addStop = () => setSoste((prev) => [...prev, emptyStop()]);
  const updateStop = (i, field, value) => setSoste((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  const updateStopFields = (i, fields) => setSoste((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...fields } : s)));
  const removeStop = (i) => setSoste((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const sede = sedi.find((s) => String(s.id) === String(sedeId));
      const payload = {
        data, ora, sede_id: sedeId || null,
        km_stimati: km, geometria, posti_totali: postiTotali, note, soste,
        citta_domicilio: citta || null,
      };
      if (isAndata) {
        payload.punto_partenza = homeLabel;
        payload.punto_arrivo = sede?.nome || ride.punto_arrivo;
        payload.partenza_lat = homeLat; payload.partenza_lon = homeLon;
        payload.arrivo_lat = sede?.lat; payload.arrivo_lon = sede?.lon;
      } else {
        payload.punto_arrivo = homeLabel;
        payload.punto_partenza = sede?.nome || ride.punto_partenza;
        payload.arrivo_lat = homeLat; payload.arrivo_lon = homeLon;
        payload.partenza_lat = sede?.lat; payload.partenza_lon = sede?.lon;
      }
      await api.put(`/rides/${ride.id}`, payload);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FinestraModale titoloId="modifica-passaggio-titolo" onClose={onClose} className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h2 id="modifica-passaggio-titolo" className="font-display font-semibold text-base">Modifica passaggio</h2>
          <button onClick={onClose} className="p-1 text-muted hover:text-ink"><X size={20} /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <ErrorBanner message={error} />}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="editridemodal-0" className="label">Data</label>
              <input id="editridemodal-0" type="date" required className="input" min={new Date().toISOString().slice(0, 10)} value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div>
              <label htmlFor="editridemodal-1" className="label">Orario</label>
              <input id="editridemodal-1" type="time" required className="input" value={ora} onChange={(e) => setOra(e.target.value)} />
            </div>
          </div>

          <div>
            <label htmlFor="editridemodal-2" className="label">{isAndata ? 'Destinazione (sede)' : 'Partenza (sede)'}</label>
            <select id="editridemodal-2" className="input" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setGeometria(null); }}>
              <option value="">Seleziona sede...</option>
              {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="label">{isAndata ? 'Punto di partenza' : 'Punto di arrivo'}</label>
            <AddressAutocomplete
              value={homeLabel}
              onChange={setHomeLabel}
              onSelect={(place) => { setHomeLabel(place.label); setHomeLat(place.lat); setHomeLon(place.lon); setCitta(place.citta || citta); }}
            />
          </div>

          <div className="rounded-xl bg-bg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-sm">
                <Route size={14} className="text-muted" />
                {calcolando ? <span className="text-muted">Calcolo...</span> : km ? <span>Tratta: <strong>{km} km</strong></span> : <span className="text-muted">Non calcolata</span>}
              </div>
              <button type="button" className="btn-ghost !px-2 !py-1 text-primary" onClick={calcolaTratta}><RefreshCw size={14} /></button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted shrink-0">Correggi km:</label>
              <input type="number" min="0" step="0.1" className="input !py-1.5 !text-xs" value={km} onChange={(e) => setKm(e.target.value)} />
            </div>
            {geometria && geometria.length > 0 && <div className="mt-3"><RouteMap points={geometria} height={160} /></div>}
            {alternative && alternative.length > 1 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted">Percorsi alternativi trovati:</p>
                {alternative.map((alt, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => { setKm(alt.km); setGeometria(alt.geometria); setSceltaPercorso(i); }}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs text-left transition-colors ${
                      sceltaPercorso === i ? 'border-primary bg-primary-light text-primary-dark' : 'border-border hover:bg-bg'
                    }`}
                  >
                    <span>{i === 0 ? 'Percorso più veloce' : `Alternativa ${i}`}</span>
                    <span className="font-medium">{alt.km} km · {alt.minuti} min</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="label">Posti totali {minPosti > 1 && <span className="text-xs text-muted">(minimo {minPosti}, ci sono richieste/conferme attive)</span>}</label>
            <input type="number" min={minPosti || 1} max="8" className="input" value={postiTotali} onChange={(e) => setPostiTotali(e.target.value)} />
          </div>

          <div>
            <label htmlFor="editridemodal-3" className="label">Note</label>
            <textarea id="editridemodal-3" className="input" rows="2" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div>
            <label className="label mb-2 flex items-center gap-1.5"><Coffee size={14} /> Soste</label>
            <p className="text-xs text-muted -mt-1 mb-2">
              Seleziona l'indirizzo dai suggerimenti: il percorso passerà davvero da lì.
            </p>
            <div className="space-y-2">
              {soste.map((s, i) => (
                <div key={i} className="flex gap-2 items-start bg-bg rounded-xl p-2.5">
                  <input type="time" className="input !w-24" value={s.orario || ''} onChange={(e) => updateStop(i, 'orario', e.target.value)} />
                  <div className="flex-1 space-y-2">
                    <AddressAutocomplete
                      value={s.luogo || ''}
                      onChange={(v) => updateStopFields(i, { luogo: v, lat: null, lon: null })}
                      onSelect={(place) => updateStopFields(i, { luogo: place.label, lat: place.lat, lon: place.lon })}
                      placeholder="Cerca il luogo della sosta..."
                    />
                    {s.lat != null ? (
                      <p className="text-xs text-primary flex items-center gap-1"><MapPin size={11} /> Indirizzo validato, incluso nel percorso</p>
                    ) : s.luogo ? (
                      <p className="text-xs text-muted">Seleziona un suggerimento per includerlo nel tragitto</p>
                    ) : null}
                    <input className="input" placeholder="Dettagli" value={s.descrizione || ''} onChange={(e) => updateStop(i, 'descrizione', e.target.value)} />
                  </div>
                  <button type="button" className="p-2 text-muted hover:text-danger" onClick={() => removeStop(i)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost text-primary mt-2 !px-2" onClick={addStop}><Plus size={15} /> Aggiungi sosta</button>
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button type="button" className="btn-outline flex-1" onClick={onClose}>Annulla</button>
            <button className="btn-primary flex-1" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva modifiche'}</button>
          </div>
        </form>
      </div>
    </FinestraModale>
  );
}
