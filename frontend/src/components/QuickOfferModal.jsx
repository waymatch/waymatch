import FinestraModale from './FinestraModale.jsx';
import React, { useState, useEffect } from 'react';
import ErrorBanner from './ErrorBanner.jsx';
import { Link } from 'react-router-dom';
import { X, Sunrise, Sunset, ArrowLeftRight, Zap } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import DateQuickPicks from './DateQuickPicks.jsx';
import { orarioDefaultIntelligente, dataISO } from '../dateTimeUtils.js';

const TIPI = [
  { value: 'andata', label: 'Andata', icon: Sunrise },
  { value: 'ritorno', label: 'Ritorno', icon: Sunset },
  { value: 'entrambi', label: 'Entrambi', icon: ArrowLeftRight },
];

// Pubblica un passaggio in pochi tap usando sede e indirizzo di casa già salvati nel
// profilo (niente ricerca indirizzo, soste o percorsi alternativi: per quello c'è il
// modulo completo in /offri). Calcola comunque il percorso reale tramite /geo/route,
// così km/geometria restano corretti come per un'offerta normale.
export default function QuickOfferModal({ onClose, onDone }) {
  const { user } = useAuth();
  const oggi = dataISO(); // calendario locale, come le scelte rapide di data
  const [sede, setSede] = useState(null);
  const [tipo, setTipo] = useState('andata');
  const [data, setData] = useState(oggi);
  const [oraAndata, setOraAndata] = useState(() => orarioDefaultIntelligente('08:00'));
  const [oraRitorno, setOraRitorno] = useState(() => orarioDefaultIntelligente('18:00'));
  const [posti, setPosti] = useState(user?.auto_posti || 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const oraMinima = data === oggi ? new Date().toTimeString().slice(0, 5) : undefined;

  useEffect(() => {
    if (user?.sede_id) {
      api.get('/sedi').then((d) => setSede(d.sedi.find((s) => s.id === user.sede_id) || null));
    }
  }, [user]);

  const pronto = !!user?.sede_id && user?.casa_lat != null && user?.casa_lon != null;

  // Il percorso deve essere davvero calcolato: con la sede non ancora caricata o il servizio non
  // raggiungibile si interrompe con un errore, invece di salvare 0 km e nessun tracciato.
  const calcolaTratta = async (direzione) => {
    if (!sede?.lat || !sede?.lon) throw new Error('La sede non è ancora disponibile o non ha coordinate: riprova tra un momento.');
    const casa = { lat: user.casa_lat, lon: user.casa_lon };
    const sedePunto = { lat: sede.lat, lon: sede.lon };
    const from = direzione === 'andata' ? casa : sedePunto;
    const to = direzione === 'andata' ? sedePunto : casa;
    try {
      const params = new URLSearchParams({ from_lat: from.lat, from_lon: from.lon, to_lat: to.lat, to_lon: to.lon });
      const d = await api.get(`/geo/route?${params.toString()}`);
      return { km: d.km, geometria: d.geometria };
    } catch (e) {
      throw new Error('Impossibile calcolare il percorso: riprova, oppure usa il modulo completo in "Offri".');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { tipo, data, posti_totali: posti, km_calcolati_auto: true };
      if (tipo === 'andata' || tipo === 'entrambi') {
        const r = await calcolaTratta('andata');
        Object.assign(payload, {
          ora_andata: oraAndata,
          punto_partenza: user.indirizzo_casa,
          citta_andata: user.citta_casa || null,
          sede_id_andata: user.sede_id,
          partenza_lat: user.casa_lat, partenza_lon: user.casa_lon,
          km_stimati_andata: r.km, geometria_andata: r.geometria,
        });
      }
      if (tipo === 'ritorno' || tipo === 'entrambi') {
        const r = await calcolaTratta('ritorno');
        Object.assign(payload, {
          ora_ritorno: oraRitorno,
          punto_arrivo_ritorno: user.indirizzo_casa,
          citta_ritorno: user.citta_casa || null,
          sede_id_ritorno: user.sede_id,
          partenza_ritorno_lat: user.casa_lat, partenza_ritorno_lon: user.casa_lon,
          km_stimati_ritorno: r.km, geometria_ritorno: r.geometria,
        });
      }
      await api.post('/rides', payload);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FinestraModale titoloId="offerta-rapida-titolo" onClose={onClose} className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h2 id="offerta-rapida-titolo" className="font-display font-semibold text-base flex items-center gap-1.5"><Zap size={16} className="text-accent-dark" /> Offerta rapida</h2>
          <button type="button" onClick={onClose} aria-label="Chiudi offerta rapida" className="p-1 text-muted hover:text-ink"><X size={20} /></button>
        </div>

        {!pronto ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-muted">
              Per usare l'offerta rapida servono sede e indirizzo di casa salvati nel profilo (così non devi
              digitarli ogni volta).
            </p>
            <Link to="/profilo" className="btn-primary w-full" onClick={onClose}>Vai al profilo</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {error && <ErrorBanner message={error} />}
            <p className="text-xs text-muted -mt-1">
              {user.indirizzo_casa} → {sede?.nome || 'sede'} (o viceversa), calcolato automaticamente.
            </p>

            <div className="grid grid-cols-3 gap-2">
              {TIPI.map((t) => (
                <button
                  type="button" key={t.value} onClick={() => setTipo(t.value)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors ${
                    tipo === t.value ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted hover:bg-bg'
                  }`}
                >
                  <t.icon size={16} />
                  {t.label}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="quickoffermodal-0" className="label">Data</label>
              <input id="quickoffermodal-0" type="date" required className="input" min={oggi} value={data} onChange={(e) => setData(e.target.value)} />
              <DateQuickPicks value={data} onChange={setData} min={oggi} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(tipo === 'andata' || tipo === 'entrambi') && (
                <div>
                  <label htmlFor="quickoffermodal-1" className="label">Orario andata</label>
                  <input id="quickoffermodal-1" type="time" required className="input" min={oraMinima} value={oraAndata} onChange={(e) => setOraAndata(e.target.value)} />
                </div>
              )}
              {(tipo === 'ritorno' || tipo === 'entrambi') && (
                <div>
                  <label htmlFor="quickoffermodal-2" className="label">Orario ritorno</label>
                  <input id="quickoffermodal-2" type="time" required className="input" min={oraMinima} value={oraRitorno} onChange={(e) => setOraRitorno(e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="quickoffermodal-3" className="label">Posti disponibili</label>
              <input id="quickoffermodal-3" type="number" min="1" max="8" className="input" value={posti} onChange={(e) => setPosti(e.target.value)} />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={saving || !sede}>{saving ? 'Pubblicazione...' : !sede ? 'Caricamento della sede...' : 'Pubblica subito'}</button>
            <Link to="/offri" className="block text-center text-xs text-muted underline" onClick={onClose}>
              Serve aggiungere soste o creare un turno fisso? Vai al modulo completo
            </Link>
          </form>
        )}
      </div>
    </FinestraModale>
  );
}
