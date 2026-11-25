import React, { useId, useState, useEffect, useRef } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Sunrise, Sunset, ArrowLeftRight, Coffee, RefreshCw, Route, Repeat, CalendarDays, MapPin } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import RouteMap from '../components/RouteMap.jsx';
import LegalDocumentsGate from '../components/LegalDocumentsGate.jsx';
import DateQuickPicks from '../components/DateQuickPicks.jsx';
import { orarioDefaultIntelligente, dataISO } from '../dateTimeUtils.js';
import { useSedi, useTratta, nuovaSosta, sosteDaInviare } from '../useTratta.js';
import { useBranding } from '../context/BrandingContext.jsx';
import { GIORNI_SETTIMANA } from '../giorni.js';
import { AVVISO_ORARI } from '../avvisoOrari.js';

const TIPI = [
  { value: 'andata', label: 'Solo andata', icon: Sunrise },
  { value: 'ritorno', label: 'Solo ritorno', icon: Sunset },
  { value: 'entrambi', label: 'Andata e ritorno', icon: ArrowLeftRight },
];


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
        {/* Entrambi i moduli restano montati e si nasconde quello non attivo: cambiando scheda non si
            perdono i dati inseriti né lo stato di un turno fisso creato solo in parte. */}
        <div hidden={tab !== 'singolo'}><SingleRideForm /></div>
        <div hidden={tab !== 'ricorrente'}><RecurringRideForm /></div>
      </div>
    </LegalDocumentsGate>
  );
}

function SingleRideForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { sedi, erroreSedi, ricaricaSedi } = useSedi();
  const [tipo, setTipo] = useState('andata');
  const oggi = dataISO(); // calendario locale
  const [data, setData] = useState(oggi);
  const [oraAndata, setOraAndata] = useState(() => orarioDefaultIntelligente('08:00'));
  const [oraRitorno, setOraRitorno] = useState(() => orarioDefaultIntelligente('18:00'));
  const [postiTotali, setPostiTotali] = useState(user?.auto_posti || 3);
  const [note, setNote] = useState('');
  const [sosteAndata, setSosteAndata] = useState([]);
  const [sosteRitorno, setSosteRitorno] = useState([]);
  const andata = useTratta({ sedi, soste: sosteAndata, direzione: 'casa-sede', utente: user });
  const ritorno = useTratta({ sedi, soste: sosteRitorno, direzione: 'sede-casa', utente: user });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []); // niente navigazione dopo lo smontaggio

  const oraMinima = data === oggi ? new Date().toTimeString().slice(0, 5) : undefined;

  const submit = async (e) => {
    e.preventDefault();
    if (saving || success) return; // dopo il successo un secondo invio duplicherebbe l'offerta
    setError('');
    const conAndata = tipo === 'andata' || tipo === 'entrambi';
    const conRitorno = tipo === 'ritorno' || tipo === 'entrambi';
    if ((conAndata && andata.leg.calcolando) || (conRitorno && ritorno.leg.calcolando)) {
      setError('Attendi la fine del calcolo del percorso.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/rides', {
        tipo, data,
        ora_andata: oraAndata,
        punto_partenza: andata.leg.homeLabel,
        citta_andata: andata.leg.citta || null,
        sede_id_andata: andata.leg.sedeId || null,
        partenza_lat: andata.leg.homeLat, partenza_lon: andata.leg.homeLon,
        km_stimati_andata: andata.leg.km,
        geometria_andata: andata.leg.geometria,

        ora_ritorno: oraRitorno,
        punto_arrivo_ritorno: ritorno.leg.homeLabel,
        citta_ritorno: ritorno.leg.citta || null,
        sede_id_ritorno: ritorno.leg.sedeId || null,
        partenza_ritorno_lat: ritorno.leg.homeLat, partenza_ritorno_lon: ritorno.leg.homeLon,
        km_stimati_ritorno: ritorno.leg.km,
        geometria_ritorno: ritorno.leg.geometria,

        km_calcolati_auto: true,
        posti_totali: postiTotali, note,
        soste_andata: sosteDaInviare(sosteAndata),
        soste_ritorno: sosteDaInviare(sosteRitorno),
      });
      setSuccess(true); // resta vero: il pulsante non si riabilita dopo il successo
      timer.current = setTimeout(() => navigate('/i-miei-viaggi'), 900);
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
            tratta={andata}
            sedi={sedi} erroreSedi={erroreSedi} ricaricaSedi={ricaricaSedi}
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
            tratta={ritorno}
            sedi={sedi} erroreSedi={erroreSedi} ricaricaSedi={ricaricaSedi}
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

        <p className="text-xs text-muted lg:col-span-2">{AVVISO_ORARI}</p>
        <button type="submit" className="btn-primary w-full lg:col-span-2" disabled={saving || success}>
          {saving ? 'Pubblicazione...' : success ? 'Pubblicato' : 'Pubblica passaggio'}
        </button>
      </form>
    </div>
  );
}

function TripSection({ className = '', title, icon: Icon, ora, setOra, oraMinima, homeLabel, sedeLabel, tratta, sedi, erroreSedi, ricaricaSedi, soste, setSoste, bloccata = false }) {
  const { leg, setLeg, ricalcola: onCalcola, cambiaSede, cambiaTesto, scegliIndirizzo } = tratta;
  const uid = useId(); // due sezioni (andata e ritorno) possono stare nella stessa pagina: gli id devono essere diversi
  const addStop = () => setSoste((prev) => [...prev, nuovaSosta()]);
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
            onChange={(e) => cambiaSede(e.target.value)}
          >
            <option value="">Seleziona sede...</option>
            {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          {erroreSedi && (
            <div className="mt-1 flex items-center gap-2 text-xs text-danger" role="alert">
              <span>{erroreSedi}</span>
              <button type="button" className="underline text-primary" onClick={ricaricaSedi}>Riprova</button>
            </div>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-indirizzo`} className="label">{homeLabel}</label>
        <AddressAutocomplete
          id={`${uid}-indirizzo`}
          value={leg.homeLabel}
          onChange={cambiaTesto}
          onSelect={scegliIndirizzo}
          bloccato={bloccata}
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
          <button type="button" className="btn-ghost !px-2 !py-1 text-primary" onClick={onCalcola} title="Ricalcola" aria-label="Ricalcola il percorso">
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
        {leg.errore && <p className="text-xs text-danger mb-2">{leg.errore}</p>}
        <div className="flex items-center gap-2">
          <label htmlFor={`${uid}-km`} className="text-xs text-muted shrink-0">Correggi km (facoltativo):</label>
          <input
            id={`${uid}-km`} type="number" min="0" step="0.1"
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
            <div key={s.uid} className="flex gap-2 items-start bg-bg rounded-xl p-2.5">
              <input type="time" aria-label={`Orario della sosta ${i + 1}`} className="input !w-24" value={s.orario} onChange={(e) => updateStop(i, 'orario', e.target.value)} />
              <div className="flex-1 space-y-2">
                <AddressAutocomplete
                  value={s.luogo}
                  onChange={(v) => updateStopFields(i, { luogo: v, lat: null, lon: null })}
                  onSelect={(place) => updateStopFields(i, { luogo: place.label, lat: place.lat, lon: place.lon })}
                  bloccato={bloccata}
                  placeholder="Cerca il luogo della sosta..."
                />
                {s.lat != null ? (
                  <p className="text-xs text-primary flex items-center gap-1"><MapPin size={11} /> Indirizzo validato, incluso nel percorso</p>
                ) : s.luogo ? (
                  <p className="text-xs text-muted">Seleziona un suggerimento per includerlo davvero nel tragitto</p>
                ) : null}
                <input className="input" placeholder="Dettagli (es. pausa colazione)" value={s.descrizione} onChange={(e) => updateStop(i, 'descrizione', e.target.value)} />
              </div>
              <button type="button" aria-label={`Rimuovi la sosta ${i + 1}`} className="p-2 text-muted hover:text-danger" onClick={() => removeStop(i)}><Trash2 size={15} aria-hidden="true" /></button>
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
  const { sedi, erroreSedi, ricaricaSedi } = useSedi();
  const [tipo, setTipo] = useState('andata');
  const oggi = dataISO(); // calendario locale
  const { branding } = useBranding();
  const giorniAmmessi = GIORNI_SETTIMANA.filter((g) => branding.giorni_lavorativi.includes(g.value));
  // null = nessuna scelta dell'utente: si usa il predefinito (lun-ven) tra i giorni ammessi di adesso,
  // anche se la configurazione dell'azienda arriva dopo il montaggio del modulo.
  const [giorniScelti, setGiorniScelti] = useState(null);
  const giorniSettimana = (giorniScelti ?? [1, 2, 3, 4, 5]).filter((g) => branding.giorni_lavorativi.includes(g));
  const [oraAndata, setOraAndata] = useState('08:00');
  const [oraRitorno, setOraRitorno] = useState('18:00');
  const [dataInizio, setDataInizio] = useState(oggi);
  const [dataFine, setDataFine] = useState('');
  const [postiTotali, setPostiTotali] = useState(user?.auto_posti || 3);
  const [note, setNote] = useState('');
  const [sosteAndata, setSosteAndata] = useState([]);
  const [sosteRitorno, setSosteRitorno] = useState([]);
  const andata = useTratta({ sedi, soste: sosteAndata, direzione: 'casa-sede', utente: user });
  const ritorno = useTratta({ sedi, soste: sosteRitorno, direzione: 'sede-casa', utente: user });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const creati = useRef({ andata: 0, ritorno: 0 }); // turni già creati con successo: un nuovo tentativo non li duplica
  const [creatiUI, setCreatiUI] = useState({ andata: false, ritorno: false });
  // Dopo un successo parziale i dati condivisi (giorni, date, posti, note) e la direzione già
  // creata non si possono più cambiare: le due direzioni resterebbero diverse tra loro.
  const parziale = creatiUI.andata || creatiUI.ritorno;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []); // niente navigazione dopo lo smontaggio

  const toggleGiorno = (g) => {
    setGiorniScelti(giorniSettimana.includes(g) ? giorniSettimana.filter((x) => x !== g) : [...giorniSettimana, g].sort());
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving || success) return;
    setError('');
    if (giorniSettimana.length === 0) { setError('Seleziona almeno un giorno della settimana.'); return; }
    const conAndata = tipo === 'andata' || tipo === 'entrambi';
    const conRitorno = tipo === 'ritorno' || tipo === 'entrambi';
    // Si controllano entrambe le direzioni prima di creare qualcosa: un errore sul ritorno non deve
    // lasciare creato il turno di andata.
    if ((conAndata && !andata.leg.homeLabel.trim()) || (conRitorno && !ritorno.leg.homeLabel.trim())) {
      setError('Indica l\'indirizzo per ogni direzione del turno.');
      return;
    }
    if ((conAndata && andata.leg.calcolando) || (conRitorno && ritorno.leg.calcolando)) {
      setError('Attendi la fine del calcolo del percorso.');
      return;
    }
    setSaving(true);
    try {
      let generatiTotali = 0;
      if (conAndata && !creati.current.andata) {
        const sedeAndata = sedi.find((s) => String(s.id) === String(andata.leg.sedeId));
        const r = await api.post('/recurring-rides', {
          tipo: 'andata', giorni_settimana: giorniSettimana, ora: oraAndata,
          punto_partenza: andata.leg.homeLabel, punto_arrivo: sedeAndata?.nome || 'Sede aziendale',
          citta_domicilio: andata.leg.citta || null,
          sede_id: andata.leg.sedeId || null,
          partenza_lat: andata.leg.homeLat, partenza_lon: andata.leg.homeLon,
          arrivo_lat: sedeAndata?.lat, arrivo_lon: sedeAndata?.lon,
          km_stimati: andata.leg.km, geometria: andata.leg.geometria,
          posti_totali: postiTotali, note, soste: sosteDaInviare(sosteAndata),
          data_inizio: dataInizio, data_fine: dataFine || null,
        });
        creati.current.andata = 1;
        setCreatiUI((c) => ({ ...c, andata: true }));
        generatiTotali += r.generati || 0;
      }
      if (conRitorno && !creati.current.ritorno) {
        const sedeRitorno = sedi.find((s) => String(s.id) === String(ritorno.leg.sedeId));
        const r = await api.post('/recurring-rides', {
          tipo: 'ritorno', giorni_settimana: giorniSettimana, ora: oraRitorno,
          punto_partenza: sedeRitorno?.nome || 'Sede aziendale', punto_arrivo: ritorno.leg.homeLabel,
          citta_domicilio: ritorno.leg.citta || null,
          sede_id: ritorno.leg.sedeId || null,
          partenza_lat: sedeRitorno?.lat, partenza_lon: sedeRitorno?.lon,
          arrivo_lat: ritorno.leg.homeLat, arrivo_lon: ritorno.leg.homeLon,
          km_stimati: ritorno.leg.km, geometria: ritorno.leg.geometria,
          posti_totali: postiTotali, note, soste: sosteDaInviare(sosteRitorno),
          data_inizio: dataInizio, data_fine: dataFine || null,
        });
        creati.current.ritorno = 1;
        setCreatiUI((c) => ({ ...c, ritorno: true }));
        generatiTotali += r.generati || 0;
      }
      setSuccess(`Turno fisso creato! ${generatiTotali} passaggi generati per i prossimi giorni.`);
      timer.current = setTimeout(() => navigate('/i-miei-viaggi?tab=turni'), 1200);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // L'ora corrente è un minimo solo se oggi è davvero un giorno del turno e la prima occorrenza può
  // essere oggi; per un turno che parte in un altro giorno l'orario è libero.
  const giornoOggi = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const oraMinima = dataInizio === oggi && giorniSettimana.includes(giornoOggi) ? new Date().toTimeString().slice(0, 5) : undefined;

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={parziale || saving} className="contents border-0 p-0 m-0 min-w-0">
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

      </fieldset>

      {parziale && (
        <div className="rounded-xl bg-accent-light text-accent-dark text-sm px-3.5 py-2.5" role="status">
          {creatiUI.andata && !creatiUI.ritorno ? 'Il turno di andata è già stato creato.' : 'Il turno di ritorno è già stato creato.'}{' '}
          Correggi l'altra direzione e riprova: giorni, date, posti e note non si possono più cambiare.
        </div>
      )}

      {(tipo === 'andata' || tipo === 'entrambi') && (
        <fieldset disabled={creatiUI.andata || saving} className="contents border-0 p-0 m-0 min-w-0">
          <TripSection
            title="Viaggio di andata" icon={Sunrise}
            ora={oraAndata} setOra={setOraAndata} oraMinima={oraMinima}
            homeLabel="Indirizzo di partenza (casa, punto di ritrovo...)" sedeLabel="Destinazione (sede aziendale)"
            tratta={andata} sedi={sedi} erroreSedi={erroreSedi} ricaricaSedi={ricaricaSedi}
            soste={sosteAndata} setSoste={setSosteAndata}
            bloccata={creatiUI.andata || saving}
          />
        </fieldset>
      )}
      {(tipo === 'ritorno' || tipo === 'entrambi') && (
        <fieldset disabled={creatiUI.ritorno || saving} className="contents border-0 p-0 m-0 min-w-0">
          <TripSection
            title="Viaggio di ritorno" icon={Sunset}
            ora={oraRitorno} setOra={setOraRitorno} oraMinima={oraMinima}
            homeLabel="Destinazione finale (casa, punto di arrivo...)" sedeLabel="Partenza (sede aziendale)"
            tratta={ritorno} sedi={sedi} erroreSedi={erroreSedi} ricaricaSedi={ricaricaSedi}
            soste={sosteRitorno} setSoste={setSosteRitorno}
            bloccata={creatiUI.ritorno || saving}
          />
        </fieldset>
      )}

      <fieldset disabled={parziale || saving} className="contents border-0 p-0 m-0 min-w-0">
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
      </fieldset>

      {error && <ErrorBanner message={error} />}
      {success && <div className="rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5">{success}</div>}

      <p className="text-xs text-muted">{AVVISO_ORARI}</p>
      <button type="submit" className="btn-primary w-full" disabled={saving || !!success}>
        {saving ? 'Creazione...' : <><Repeat size={15} /> Crea turno fisso</>}
      </button>
      <p className="text-xs text-muted text-center">
        I passaggi verranno generati automaticamente per i prossimi 14 giorni, e poi ogni giorno per mantenere sempre 14 giorni di anticipo.
        Puoi sospendere o eliminare il turno in qualunque momento da "I miei viaggi".
      </p>
    </form>
  );
}
