import React, { useEffect, useState, useCallback } from 'react';
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
  const [soglia, setSoglia] = useState(leggiSogliaSalvata);
  const cambiaSoglia = (v) => { setSoglia(v); salvaSoglia(v); };

  useEffect(() => {
    api.get('/sedi').then((d) => {
      setSedi(d.sedi);
      if (user?.sede_id) setSedeId(String(user.sede_id));
    });
  }, [user]);

  const load = useCallback(() => {
    if (!sedeId) return;
    const params = new URLSearchParams({ sede_id: sedeId });
    if (data) params.set('data', data);
    if (tipo) params.set('tipo', tipo);
    api.get(`/rides?${params.toString()}`).then((d) => setRides(d.rides)).catch((e) => setError(e.message));
  }, [sedeId, data, tipo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Cerca un passaggio</h1>
        <p className="text-muted text-sm mt-0.5">Trova un collega che va nella tua direzione.</p>
      </div>

      <div className="card space-y-3">
        <div>
          <label htmlFor="findride-0" className="label">Sede</label>
          <select id="findride-0" className="input" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
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

      {rides === null ? (
        <div className="card animate-pulse h-20" />
      ) : rides.length === 0 ? (
        <div className="card text-center py-10">
          <Search size={22} className="mx-auto text-muted mb-2" />
          <p className="text-sm text-muted">Nessun passaggio trovato con questi filtri.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {ordinaPerPertinenza(rides, soglia).map((r) => <RideCard key={r.id} ride={r} onChanged={load} soglia={soglia} />)}
        </div>
      )}
    </div>
  );
}
