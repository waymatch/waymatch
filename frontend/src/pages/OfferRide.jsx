import React, { useId, useState, useEffect, useCallback } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Sunrise, Sunset, ArrowLeftRight, Coffee, RefreshCw, Route, Repeat, CalendarDays, MapPin } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import RouteMap from '../components/RouteMap.jsx';
import LegalDocumentsGate from '../components/LegalDocumentsGate.jsx';
import DateQuickPicks from '../components/DateQuickPicks.jsx';
import { orarioDefaultIntelligente } from '../dateTimeUtils.js';
import { useBranding } from '../context/BrandingContext.jsx';
import { GIORNI_SETTIMANA } from '../giorni.js';

const TIPI = [
  { value: 'andata', label: 'Solo andata', icon: Sunrise },
  { value: 'ritorno', label: 'Solo ritorno', icon: Sunset },
  { value: 'entrambi', label: 'Andata e ritorno', icon: ArrowLeftRight },
];


function emptyStop() { return { orario: '', luogo: '', descrizione: '', lat: null, lon: null }; }
function emptyLeg() {
  return { sedeId: '', homeLabel: '', homeLat: null, homeLon: null, citta: '', km: '', geometria: null, alternative: [], scelta: 0, calcolando: false, errore: '' };
}

export default function OfferRide() {
  const [tab, setTab] = useState('singolo');
  return (
    <LegalDocumentsGate tipo="conducente">
      <div className="space-y-6">
        <div>
          <h1 className="font-display font-bold text-2xl">Offri un passaggio</h1>
          <p className="text-muted text-sm mt-0.5">La tratta viene calcolata automaticamente in base agli indirizzi.</p>
        </div>
        <div className="flex gap-2 bg-bg p-1 rounded-xl w-fit border border-border">
          <button
            onClick={() => setTab('singolo')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'singolo' ? 'bg-surface shadow-sm text-primary' : 'text-muted'}`}
          >
            Passaggio singolo
          </button>
          <button
            onClick={() => setTab('ricorrente')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'ricorrente' ? 'bg-surface shadow-sm text-primary' : 'text-muted'}`}
          >
            <Repeat size={13} className="inline -mt-0.5 mr-1" /> Turno fisso
          </button>
        </div>
        {tab === 'singolo' ? <SingleRideForm /> : <RecurringRideForm />}
      </div>
    </LegalDocumentsGate>
  );
}

function SingleRideForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sedi, setSedi] = useState([]);
  const [tipo, setTipo] = useState('andata');
  const oggi = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(oggi);
  const [oraAndata, setOraAndata] = useState(() => orarioDefaultIntelligente('08:00'));
  const [oraRitorno, setOraRitorno] = useState(() => orarioDefaultIntelligente('18:00'));
  const [postiTotali, setPostiTotali] = useState(user?.auto_posti || 3);
  const [note, setNote] = useState('');
  const [sosteAndata, setSosteAndata] = useState([]);
  const [sosteRitorno, setSosteRitorno] = useState([]);
  const [andata, setAndata] = useState(emptyLeg());
  const [ritorno, setRitorno] = useState(emptyLeg());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const oraMinima = data === oggi ? new Date().toTimeString().slice(0, 5) : undefined;

  useEffect(() => {
    api.get('/sedi').then((d) => {
      setSedi(d.sedi);
      if (user?.sede_id) {
        setAndata((p) => ({ ...p, sedeId: String(user.sede_id) }));
        setRitorno((p) => ({ ...p, sedeId: String(user.sede_id) }));
      }
      // Precompila l'indirizzo di casa dal profilo: resta comunque modificabile per
      // questa singola offerta senza toccare il valore salvato nel profilo.
      if (user?.casa_lat != null && user?.casa_lon != null) {
        const casa = { homeLabel: user.indirizzo_casa || '', homeLat: user.casa_lat, homeLon: user.casa_lon, citta: user.citta_casa || '' };
        setAndata((p) => ({ ...p, ...casa }));
        setRitorno((p) => ({ ...p, ...casa }));
      }
    });
  }, [user]);

  const calcolaTratta = useCallback(async (leg, setLeg, soste = [], direzione = 'casa-sede') => {
    const sede = sedi.find((s) => String(s.id) === String(leg.sedeId));
    if (!sede?.lat || !sede?.lon || !leg.homeLat || !leg.homeLon) return;
    setLeg((p) => ({ ...p, calcolando: true, errore: '' }));

    // Solo le soste con un indirizzo validato (lat/lon presenti) diventano tappe reali del
    // percorso; quelle inserite come testo libero restano solo un'informazione a parte.
    const sosteValide = (soste || []).filter((s) => s.lat != null && s.lon != null);
    const sosteOrdinate = [...sosteValide].sort((a, b) => (a.orario || '99:99').localeCompare(b.orario || '99:99'));

    try {
      if (sosteOrdinate.length > 0) {
        const puntoCasa = { lat: leg.homeLat, lon: leg.homeLon };
        const puntoSede = { lat: sede.lat, lon: sede.lon };
        const tappeSoste = sosteOrdinate.map((s) => ({ lat: s.lat, lon: s.lon }));
        const punti = direzione === 'sede-casa'
          ? [puntoSede, ...tappeSoste, puntoCasa]
          : [puntoCasa, ...tappeSoste, puntoSede];
        const d = await api.post('/geo/route-multi', { punti });
        setLeg((p) => ({ ...p, km: d.km, geometria: d.geometria, alternative: [], scelta: 0, calcolando: false }));
      } else {
        const params = new URLSearchParams({
          from_lat: leg.homeLat, from_lon: leg.homeLon,
          to_lat: sede.lat, to_lon: sede.lon,
        });
        const d = await api.get(`/geo/route?${params.toString()}`);
        setLeg((p) => ({ ...p, km: d.km, geometria: d.geometria, alternative: d.alternative || [], scelta: 0, calcolando: false }));
      }
    } catch (e) {
      setLeg((p) => ({ ...p, calcolando: false, errore: 'Impossibile calcolare il percorso, inserisci i km manualmente.' }));
    }
  }, [sedi]);

  // Chiave che cambia solo quando le COORDINATE delle soste cambiano (non ad ogni lettera
  // digitata in descrizione/orario), per non ricalcolare il percorso inutilmente.
  const sosteAndataCoordKey = sosteAndata.map((s) => `${s.lat ?? ''},${s.lon ?? ''}`).join('|');
  const sosteRitornoCoordKey = sosteRitorno.map((s) => `${s.lat ?? ''},${s.lon ?? ''}`).join('|');

  // Ricalcola automaticamente la tratta ogni volta che cambia la sede, l'indirizzo di casa
  // o le soste validate, senza bisogno di premere il pulsante di aggiornamento manuale.
  useEffect(() => {
    calcolaTratta(andata, setAndata, sosteAndata, 'casa-sede');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [andata.sedeId, andata.homeLat, andata.homeLon, sedi, sosteAndataCoordKey]);

  useEffect(() => {
    calcolaTratta(ritorno, setRitorno, sosteRitorno, 'sede-casa');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ritorno.sedeId, ritorno.homeLat, ritorno.homeLon, sedi, sosteRitornoCoordKey]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/rides', {
        tipo, data,
        ora_andata: oraAndata,
        punto_partenza: andata.homeLabel,
        citta_andata: andata.citta || null,
        sede_id_andata: andata.sedeId || null,
        partenza_lat: andata.homeLat, partenza_lon: andata.homeLon,
        km_stimati_andata: andata.km,
        geometria_andata: andata.geometria,

        ora_ritorno: oraRitorno,
        punto_arrivo_ritorno: ritorno.homeLabel,
        citta_ritorno: ritorno.citta || null,
        sede_id_ritorno: ritorno.sedeId || null,
        partenza_ritorno_lat: ritorno.homeLat, partenza_ritorno_lon: ritorno.homeLon,
        km_stimati_ritorno: ritorno.km,
        geometria_ritorno: ritorno.geometria,

        km_calcolati_auto: true,
        posti_totali: postiTotali, note,
        soste_andata: sosteAndata.filter((s) => s.luogo.trim()),
        soste_ritorno: sosteRitorno.filter((s) => s.luogo.trim()),
      });
      setSuccess(true);
      setTimeout(() => navigate('/i-miei-viaggi'), 900);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="card">
          <label className="label">Tipo di viaggio</label>
          <div className="grid grid-cols-3 gap-2">
            {TIPI.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => setTipo(t.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-medium transition-colors ${
                  tipo === t.value ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted hover:bg-bg'
                }`}
              >
                <t.icon size={18} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <label htmlFor="offerride-0" className="label">Data</label>
          <input id="offerride-0" type="date" required className="input" min={oggi} value={data} onChange={(e) => setData(e.target.value)} />
          <DateQuickPicks value={data} onChange={setData} min={oggi} />
        </div>

        {(tipo === 'andata' || tipo === 'entrambi') && (
          <TripSection
            className={tipo === 'entrambi' ? '' : 'lg:col-span-2'}
            title="Viaggio di andata"
            icon={Sunrise}
            ora={oraAndata} setOra={setOraAndata} oraMinima={oraMinima}
            homeLabel="Indirizzo di partenza (casa, punto di ritrovo...)"
            sedeLabel="Destinazione (sede aziendale)"
            leg={andata} setLeg={setAndata}
            sedi={sedi}
            onCalcola={() => calcolaTratta(andata, setAndata, sosteAndata, 'casa-sede')}
            soste={sosteAndata} setSoste={setSosteAndata}
          />
        )}

        {(tipo === 'ritorno' || tipo === 'entrambi') && (
          <TripSection
            className={tipo === 'entrambi' ? '' : 'lg:col-span-2'}
            title="Viaggio di ritorno"
            icon={Sunset}
            ora={oraRitorno} setOra={setOraRitorno} oraMinima={oraMinima}
            homeLabel="Destinazione finale (casa, punto di arrivo...)"
            sedeLabel="Partenza (sede aziendale)"
            leg={ritorno} setLeg={setRitorno}
            sedi={sedi}
            onCalcola={() => calcolaTratta(ritorno, setRitorno, sosteRitorno, 'sede-casa')}
            soste={sosteRitorno} setSoste={setSosteRitorno}
          />
        )}

        <div className="card space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="offerride-1" className="label">Posti disponibili</label>
              <input id="offerride-1" type="number" min="1" max="8" className="input" value={postiTotali} onChange={(e) => setPostiTotali(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="offerride-2" className="label">Note (opzionale)</label>
            <textarea id="offerride-2" className="input" rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. posso aspettare qualche minuto..." />
          </div>
        </div>

        {error && <div className="lg:col-span-2"><ErrorBanner message={error} /></div>}
        {success && <div className="lg:col-span-2 rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5">Passaggio pubblicato! Hai guadagnato punti 🎉</div>}

        <button className="btn-primary w-full lg:col-span-2" disabled={saving}>
          {saving ? 'Pubblicazione...' : 'Pubblica passaggio'}
        </button>
      </form>
    </div>
  );
}

function TripSection({ className = '', title, icon: Icon, ora, setOra, oraMinima, homeLabel, sedeLabel, leg, setLeg, sedi, onCalcola, soste, setSoste }) {
  const uid = useId(); // due sezioni (andata e ritorno) possono stare nella stessa pagina: gli id devono essere diversi
  const addStop = () => setSoste((prev) => [...prev, emptyStop()]);
  const updateStop = (i, field, value) => setSoste((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  const updateStopFields = (i, fields) => setSoste((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...fields } : s)));
  const removeStop = (i) => setSoste((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className={`card space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">{title}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${uid}-ora`} className="label">Orario</label>
          <input id={`${uid}-ora`} type="time" required className="input" min={oraMinima} value={ora} onChange={(e) => setOra(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-sede`} className="label">{sedeLabel}</label>
          <select id={`${uid}-sede`}
            required
            className="input"
            value={leg.sedeId}
            onChange={(e) => { setLeg((p) => ({ ...p, sedeId: e.target.value, geometria: null })); }}
          >
            <option value="">Seleziona sede...</option>
            {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">{homeLabel}</label>
        <AddressAutocomplete
          value={leg.homeLabel}
          onChange={(v) => setLeg((p) => ({ ...p, homeLabel: v }))}
          onSelect={(place) => {
            setLeg((p) => ({ ...p, homeLabel: place.label, homeLat: place.lat, homeLon: place.lon, citta: place.citta ?? p.citta }));
          }}
          placeholder="Inizia a digitare l'indirizzo..."
        />
      </div>

      <div className="rounded-xl bg-bg p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-sm">
            <Route size={14} className="text-muted" />
            {leg.calcolando ? (
              <span className="text-muted">Calcolo tragitto...</span>
            ) : leg.km ? (
              <span>Tratta stimata: <strong>{leg.km} km</strong></span>
            ) : (
              <span className="text-muted">Seleziona sede e indirizzo per calcolare la tratta</span>
            )}
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1 text-primary" onClick={onCalcola} title="Ricalcola" aria-label="Ricalcola">
            <RefreshCw size={14} />
          </button>
        </div>
        {leg.errore && <p className="text-xs text-danger mb-2">{leg.errore}</p>}
        <div className="flex items-center gap-2">
          <label htmlFor="correggi-km" className="text-xs text-muted shrink-0">Correggi km (facoltativo):</label>
          <input
            id="correggi-km" type="number" min="0" step="0.1"
            className="input !py-1.5 !text-sm"
            value={leg.km}
            onChange={(e) => setLeg((p) => ({ ...p, km: e.target.value }))}
          />
        </div>
        {leg.geometria && leg.geometria.length > 0 && (
          <div className="mt-3">
            <RouteMap points={leg.geometria} height={180} />
          </div>
        )}
        {leg.alternative && leg.alternative.length > 1 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted">Percorsi alternativi trovati:</p>
            {leg.alternative.map((alt, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setLeg((p) => ({ ...p, km: alt.km, geometria: alt.geometria, scelta: i }))}
                className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                  leg.scelta === i ? 'border-primary bg-primary-light text-primary-dark' : 'border-border hover:bg-bg'
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
        <label className="label mb-2 flex items-center gap-1.5"><Coffee size={14} /> Soste lungo il tragitto</label>
        <p className="text-xs text-muted -mt-1 mb-2">
          Seleziona l'indirizzo dai suggerimenti: il percorso sulla mappa passerà davvero da lì.
        </p>
        <div className="space-y-2">
          {soste.map((s, i) => (
            <div key={i} className="flex gap-2 items-start bg-bg rounded-xl p-2.5">
              <input type="time" className="input !w-24" value={s.orario} onChange={(e) => updateStop(i, 'orario', e.target.value)} />
              <div className="flex-1 space-y-2">
                <AddressAutocomplete
                  value={s.luogo}
                  onChange={(v) => updateStopFields(i, { luogo: v, lat: null, lon: null })}
                  onSelect={(place) => updateStopFields(i, { luogo: place.label, lat: place.lat, lon: place.lon })}
                  placeholder="Cerca il luogo della sosta..."
                />
                {s.lat != null ? (
                  <p className="text-xs text-primary flex items-center gap-1"><MapPin size={11} /> Indirizzo validato, incluso nel percorso</p>
                ) : s.luogo ? (
                  <p className="text-xs text-muted">Seleziona un suggerimento per includerlo davvero nel tragitto</p>
                ) : null}
                <input className="input" placeholder="Dettagli (es. pausa colazione)" value={s.descrizione} onChange={(e) => updateStop(i, 'descrizione', e.target.value)} />
              </div>
              <button type="button" className="p-2 text-muted hover:text-danger" onClick={() => removeStop(i)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost text-primary mt-2 !px-2" onClick={addStop}>
          <Plus size={15} /> Aggiungi sosta
        </button>
      </div>
    </div>
  );
}

function RecurringRideForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sedi, setSedi] = useState([]);
  const [tipo, setTipo] = useState('andata');
  const oggi = new Date().toISOString().slice(0, 10);
  const { branding } = useBranding();
  const giorniAmmessi = GIORNI_SETTIMANA.filter((g) => branding.giorni_lavorativi.includes(g.value));
  const [giorniSettimana, setGiorniSettimana] = useState([1, 2, 3, 4, 5].filter((g) => branding.giorni_lavorativi.includes(g)));
  const [oraAndata, setOraAndata] = useState('08:00');
  const [oraRitorno, setOraRitorno] = useState('18:00');
  const [dataInizio, setDataInizio] = useState(oggi);
  const [dataFine, setDataFine] = useState('');
  const [postiTotali, setPostiTotali] = useState(user?.auto_posti || 3);
  const [note, setNote] = useState('');
  const [sosteAndata, setSosteAndata] = useState([]);
  const [sosteRitorno, setSosteRitorno] = useState([]);
  const [andata, setAndata] = useState(emptyLeg());
  const [ritorno, setRitorno] = useState(emptyLeg());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/sedi').then((d) => {
      setSedi(d.sedi);
      if (user?.sede_id) {
        setAndata((p) => ({ ...p, sedeId: String(user.sede_id) }));
        setRitorno((p) => ({ ...p, sedeId: String(user.sede_id) }));
      }
      // Precompila l'indirizzo di casa dal profilo: resta comunque modificabile per
      // questa singola offerta senza toccare il valore salvato nel profilo.
      if (user?.casa_lat != null && user?.casa_lon != null) {
        const casa = { homeLabel: user.indirizzo_casa || '', homeLat: user.casa_lat, homeLon: user.casa_lon, citta: user.citta_casa || '' };
        setAndata((p) => ({ ...p, ...casa }));
        setRitorno((p) => ({ ...p, ...casa }));
      }
    });
  }, [user]);

  const calcolaTratta = useCallback(async (leg, setLeg, soste = [], direzione = 'casa-sede') => {
    const sede = sedi.find((s) => String(s.id) === String(leg.sedeId));
    if (!sede?.lat || !sede?.lon || !leg.homeLat || !leg.homeLon) return;
    setLeg((p) => ({ ...p, calcolando: true, errore: '' }));

    const sosteValide = (soste || []).filter((s) => s.lat != null && s.lon != null);
    const sosteOrdinate = [...sosteValide].sort((a, b) => (a.orario || '99:99').localeCompare(b.orario || '99:99'));

    try {
      if (sosteOrdinate.length > 0) {
        const puntoCasa = { lat: leg.homeLat, lon: leg.homeLon };
        const puntoSede = { lat: sede.lat, lon: sede.lon };
        const tappeSoste = sosteOrdinate.map((s) => ({ lat: s.lat, lon: s.lon }));
        const punti = direzione === 'sede-casa'
          ? [puntoSede, ...tappeSoste, puntoCasa]
          : [puntoCasa, ...tappeSoste, puntoSede];
        const d = await api.post('/geo/route-multi', { punti });
        setLeg((p) => ({ ...p, km: d.km, geometria: d.geometria, alternative: [], scelta: 0, calcolando: false }));
      } else {
        const params = new URLSearchParams({ from_lat: leg.homeLat, from_lon: leg.homeLon, to_lat: sede.lat, to_lon: sede.lon });
        const d = await api.get(`/geo/route?${params.toString()}`);
        setLeg((p) => ({ ...p, km: d.km, geometria: d.geometria, alternative: d.alternative || [], scelta: 0, calcolando: false }));
      }
    } catch (e) {
      setLeg((p) => ({ ...p, calcolando: false, errore: 'Impossibile calcolare il percorso, inserisci i km manualmente.' }));
    }
  }, [sedi]);

  const sosteAndataCoordKey = sosteAndata.map((s) => `${s.lat ?? ''},${s.lon ?? ''}`).join('|');
  const sosteRitornoCoordKey = sosteRitorno.map((s) => `${s.lat ?? ''},${s.lon ?? ''}`).join('|');

  useEffect(() => { calcolaTratta(andata, setAndata, sosteAndata, 'casa-sede'); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [andata.sedeId, andata.homeLat, andata.homeLon, sedi, sosteAndataCoordKey]);
  useEffect(() => { calcolaTratta(ritorno, setRitorno, sosteRitorno, 'sede-casa'); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ritorno.sedeId, ritorno.homeLat, ritorno.homeLon, sedi, sosteRitornoCoordKey]);

  const toggleGiorno = (g) => {
    setGiorniSettimana((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g].sort());
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (giorniSettimana.length === 0) { setError('Seleziona almeno un giorno della settimana.'); return; }
    setSaving(true);
    try {
      let generatiTotali = 0;
      if (tipo === 'andata' || tipo === 'entrambi') {
        const sedeAndata = sedi.find((s) => String(s.id) === String(andata.sedeId));
        const r = await api.post('/recurring-rides', {
          tipo: 'andata', giorni_settimana: giorniSettimana, ora: oraAndata,
          punto_partenza: andata.homeLabel, punto_arrivo: sedeAndata?.nome || 'Sede aziendale',
          citta_domicilio: andata.citta || null,
          sede_id: andata.sedeId || null,
          partenza_lat: andata.homeLat, partenza_lon: andata.homeLon,
          arrivo_lat: sedeAndata?.lat, arrivo_lon: sedeAndata?.lon,
          km_stimati: andata.km, geometria: andata.geometria,
          posti_totali: postiTotali, note, soste: sosteAndata.filter((s) => s.luogo.trim()),
          data_inizio: dataInizio, data_fine: dataFine || null,
        });
        generatiTotali += r.generati || 0;
      }
      if (tipo === 'ritorno' || tipo === 'entrambi') {
        const sedeRitorno = sedi.find((s) => String(s.id) === String(ritorno.sedeId));
        const r = await api.post('/recurring-rides', {
          tipo: 'ritorno', giorni_settimana: giorniSettimana, ora: oraRitorno,
          punto_partenza: sedeRitorno?.nome || 'Sede aziendale', punto_arrivo: ritorno.homeLabel,
          citta_domicilio: ritorno.citta || null,
          sede_id: ritorno.sedeId || null,
          partenza_lat: sedeRitorno?.lat, partenza_lon: sedeRitorno?.lon,
          arrivo_lat: ritorno.homeLat, arrivo_lon: ritorno.homeLon,
          km_stimati: ritorno.km, geometria: ritorno.geometria,
          posti_totali: postiTotali, note, soste: sosteRitorno.filter((s) => s.luogo.trim()),
          data_inizio: dataInizio, data_fine: dataFine || null,
        });
        generatiTotali += r.generati || 0;
      }
      setSuccess(`Turno fisso creato! ${generatiTotali} passaggi generati per i prossimi giorni.`);
      setTimeout(() => navigate('/i-miei-viaggi?tab=turni'), 1200);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const oraMinima = dataInizio === oggi ? new Date().toTimeString().slice(0, 5) : undefined;

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card">
        <label className="label">Tipo di turno</label>
        <div className="grid grid-cols-3 gap-2">
          {TIPI.map((t) => (
            <button
              type="button" key={t.value} onClick={() => setTipo(t.value)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-medium transition-colors ${
                tipo === t.value ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted hover:bg-bg'
              }`}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <label className="label flex items-center gap-1.5"><CalendarDays size={14} /> Giorni della settimana</label>
        <div className="grid grid-cols-6 gap-1.5">
          {giorniAmmessi.map((g) => (
            <button
              type="button" key={g.value} onClick={() => toggleGiorno(g.value)}
              className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                giorniSettimana.includes(g.value) ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted hover:bg-bg'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="offerride-5" className="label">Dal</label>
            <input id="offerride-5" type="date" required className="input" min={oggi} value={dataInizio} onChange={(e) => setDataInizio(e.target.value)} />
            <DateQuickPicks value={dataInizio} onChange={setDataInizio} min={oggi} />
          </div>
          <div>
            <label htmlFor="offerride-6" className="label">Fino al (facoltativo)</label>
            <input id="offerride-6" type="date" className="input" min={dataInizio} value={dataFine} onChange={(e) => setDataFine(e.target.value)} />
          </div>
        </div>
      </div>

      {(tipo === 'andata' || tipo === 'entrambi') && (
        <TripSection
          title="Viaggio di andata" icon={Sunrise}
          ora={oraAndata} setOra={setOraAndata} oraMinima={oraMinima}
          homeLabel="Indirizzo di partenza (casa, punto di ritrovo...)" sedeLabel="Destinazione (sede aziendale)"
          leg={andata} setLeg={setAndata} sedi={sedi}
          onCalcola={() => calcolaTratta(andata, setAndata, sosteAndata, 'casa-sede')}
          soste={sosteAndata} setSoste={setSosteAndata}
        />
      )}
      {(tipo === 'ritorno' || tipo === 'entrambi') && (
        <TripSection
          title="Viaggio di ritorno" icon={Sunset}
          ora={oraRitorno} setOra={setOraRitorno} oraMinima={oraMinima}
          homeLabel="Destinazione finale (casa, punto di arrivo...)" sedeLabel="Partenza (sede aziendale)"
          leg={ritorno} setLeg={setRitorno} sedi={sedi}
          onCalcola={() => calcolaTratta(ritorno, setRitorno, sosteRitorno, 'sede-casa')}
          soste={sosteRitorno} setSoste={setSosteRitorno}
        />
      )}

      <div className="card space-y-4">
        <div>
          <label htmlFor="offerride-7" className="label">Posti disponibili</label>
          <input id="offerride-7" type="number" min="1" max="8" className="input" value={postiTotali} onChange={(e) => setPostiTotali(e.target.value)} />
        </div>
        <div>
          <label htmlFor="offerride-8" className="label">Note (opzionale)</label>
          <textarea id="offerride-8" className="input" rows="2" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {success && <div className="rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5">{success}</div>}

      <button className="btn-primary w-full" disabled={saving}>
        {saving ? 'Creazione...' : <><Repeat size={15} /> Crea turno fisso</>}
      </button>
      <p className="text-xs text-muted text-center">
        I passaggi verranno generati automaticamente per i prossimi 14 giorni, e poi ogni giorno per mantenere sempre 14 giorni di anticipo.
        Puoi sospendere o eliminare il turno in qualunque momento da "I miei viaggi".
      </p>
    </form>
  );
}
