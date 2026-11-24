import React, { useEffect, useState, useCallback } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import { CheckCircle2, XCircle, Users, UserCheck } from 'lucide-react';
import { api } from '../../api.js';

export default function AdminApprovals() {
  const [rides, setRides] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/rides/pending/approvazione').then((d) => setRides(d.rides)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const approva = async (id) => {
    try {
      await api.post(`/rides/${id}/approva-completamento`);
      load();
    } catch (e) { alert(e.message); }
  };
  const rifiuta = async (id) => {
    const motivo = prompt('Motivo del rifiuto (facoltativo):') || '';
    try {
      await api.post(`/rides/${id}/rifiuta-completamento`, { motivo });
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Approvazioni</h1>
        <p className="text-muted text-sm mt-0.5">
          Viaggi in attesa di conferma prima dell'assegnazione dei punti.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      {rides === null ? (
        <div className="card animate-pulse h-24" />
      ) : rides.length === 0 ? (
        <div className="card text-center py-10 text-sm text-muted">Nessun viaggio in attesa di approvazione.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rides.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-semibold text-sm">{new Date(r.data).toLocaleDateString('it-IT')} · {r.ora}</span>
                <span className="badge-primary">{r.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
              </div>
              <p className="text-sm text-muted mt-1">{r.punto_partenza} → {r.punto_arrivo}</p>
              <p className="text-xs text-muted mt-1">Autista: {r.driver_nome} {r.driver_cognome}</p>
              <p className="text-xs text-muted mt-1 flex items-center gap-3">
                <span className="flex items-center gap-1"><Users size={12} /> {r.passeggeri_confermati} confermati</span>
                <span className="flex items-center gap-1"><UserCheck size={12} /> {r.passeggeri_a_bordo} a bordo (check-in)</span>
              </p>
              <div className="flex gap-2 mt-3">
                <button className="btn-primary flex-1 !text-xs !py-1.5" onClick={() => approva(r.id)}>
                  <CheckCircle2 size={14} /> Approva
                </button>
                <button className="btn-outline flex-1 !text-xs !py-1.5" onClick={() => rifiuta(r.id)}>
                  <XCircle size={14} /> Rifiuta
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
