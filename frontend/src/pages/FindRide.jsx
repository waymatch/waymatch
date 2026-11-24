import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import RideCard from '../components/RideCard.jsx';
import RelevanceSlider from '../components/RelevanceSlider.jsx';
import { ordinaPerPertinenza, leggiSogliaSalvata, salvaSoglia } from '../relevance.js';

export default function FindRide() {
  const { user } = useAuth();
  const [sedi, setSedi] = useState([]);
  const [sedeId, setSedeId] = useState('');
  const [data, setData] = useState('');
  const [tipo, setTipo] = useState('');
  const [rides, setRides] = useState(null);
  const [error, setError] = useState('');
  const [erroreSedi, setErroreSedi] = useState('');
  const [soglia, setSoglia] = useState(leggiSogliaSalvata);
  const richiesta = useRef(0); // identifica l'ultima ricerca: le risposte superate si ignorano
  const cambiaSoglia = (v) => { setSoglia(v); salvaSoglia(v); };

  const caricaSedi = useCallback(() => {
    setErroreSedi('');
    api.get('/sedi').then((d) => {
      setSedi(d.sedi);
      if (user?.sede_id) setSedeId(String(user.sede_id));
    }).catch((e) => setErroreSedi(e.message || 'Impossibile caricare le sedi.'));
  }, [user]);
  useEffect(() => { caricaSedi(); }, [caricaSedi]);

  const load = useCallback(() => {
    if (!sedeId) return;
    const mia = ++richiesta.current;
    const params = new URLSearchParams({ sede_id: sedeId });
    if (data) params.set('data', data);
    if (tipo) params.set('tipo', tipo);
    api.get(`/rides?${params.toString()}`)
      .then((d) => { if (mia !== richiesta.current) return; setRides(d.rides); setError(''); })
      .catch((e) => { if (mia !== richiesta.current) return; setError(e.message); setRides((r) => r ?? []); });
  }, [sedeId, data, tipo]);

  useEffect(() => { load(); }, [load]);
  // Le schede chiamano onChanged dopo un'azione che può durare: deve usare sempre il caricamento
  // corrente (sede e filtri di adesso), non quello del render in cui l'azione è iniziata.
  const loadCorrente = useRef(load);
  loadCorrente.current = load;
  const dopoAzione = useCallback(() => loadCorrente.current(), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Cerca un passaggio</h1>
        <p className="text-muted text-sm mt-0.5">Trova un collega che va nella tua direzione.</p>
      </div>

      <div className="card space-y-3">
        <div>
          <label htmlFor="findride-0" className="label">Sede</label>
          <select id="findride-0" className="input" value={sedeId} onChange={(e) => { setRides(null); setSedeId(e.target.value); }}>
            {!sedeId && <option value="">Seleziona una sede...</option>}
            {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          {erroreSedi && (
            <div className="mt-1 flex items-center gap-2 text-xs text-danger" role="alert">
              <span>{erroreSedi}</span>
              <button type="button" className="underline text-primary" onClick={caricaSedi}>Riprova</button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="findride-1" className="label">Data</label>
            <input id="findride-1" type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="findride-2" className="label">Tipo</label>
            <select id="findride-2" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Tutti</option>
              <option value="andata">Andata</option>
              <option value="ritorno">Ritorno</option>
            </select>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <RelevanceSlider user={user} value={soglia} onChange={cambiaSoglia} />

      {!sedeId ? (
        <div className="card text-center py-10 text-sm text-muted">Seleziona una sede per cercare i passaggi.</div>
      ) : rides === null ? (
        <div className="card animate-pulse h-20" />
      ) : rides.length === 0 ? (
        <div className="card text-center py-10">
          <Search size={22} className="mx-auto text-muted mb-2" />
          <p className="text-sm text-muted">Nessun passaggio trovato con questi filtri.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {ordinaPerPertinenza(rides, soglia).map((r) => <RideCard key={r.id} ride={r} onChanged={dopoAzione} soglia={soglia} />)}
        </div>
      )}
    </div>
  );
}
