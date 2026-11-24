import React, { useEffect, useState, useCallback } from 'react';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { Check, X } from 'lucide-react';
import { api } from '../../api.js';

const STATO_LABEL = { in_attesa: 'In attesa', completata: 'Completata', rifiutata: 'Rifiutata' };
const STATO_COLORE = {
  in_attesa: 'bg-accent-light text-accent-dark',
  completata: 'bg-primary-light text-primary-dark',
  rifiutata: 'bg-danger/10 text-danger',
};

export default function AdminDeletionRequests() {
  const [richieste, setRichieste] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api.get('/privacy/cancellazioni').then((d) => { setRichieste(d.richieste); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const completa = async (id) => {
    if (!confirm(
      'Confermi? L\'account verrà anonimizzato e non potrà più accedere. I suoi passaggi futuri ancora ' +
      'attivi verranno annullati e i colleghi coinvolti avvisati. Azione non reversibile.'
    )) return;
    try {
      await api.post(`/privacy/cancellazioni/${id}/completa`);
      load();
    } catch (e) { alert(e.message); }
  };
  const rifiuta = async (id) => {
    const risposta = prompt('Motivo del rifiuto (facoltativo):');
    if (risposta === null) return; // «Annulla» o Esc: nessun rifiuto
    const motivo = risposta;
    try {
      await api.post(`/privacy/cancellazioni/${id}/rifiuta`, { motivo });
      load();
    } catch (e) { alert(e.message); }
  };

  const inAttesa = (richieste || []).filter((r) => r.stato === 'in_attesa');
  const altre = (richieste || []).filter((r) => r.stato !== 'in_attesa');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Richieste di cancellazione</h1>
        <p className="text-muted text-sm mt-0.5">Richieste di cancellazione dei dati personali (GDPR).</p>
      </div>

      {error && <ErroreConRiprova messaggio={error} onRiprova={load} />}

      {richieste === null ? (
        error ? null : <div className="card animate-pulse h-24" />
      ) : richieste.length === 0 ? (
        <div className="card text-center py-10 text-sm text-muted">Nessuna richiesta al momento.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {inAttesa.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{r.nome} {r.cognome}</p>
                  <p className="text-xs text-muted">{r.email}</p>
                  {r.motivo && <p className="text-sm mt-1.5">{r.motivo}</p>}
                  <p className="text-xs text-muted mt-1">Richiesta il {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT')}</p>
                </div>
                <span className={`badge shrink-0 ${STATO_COLORE[r.stato]}`}>{STATO_LABEL[r.stato]}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-primary flex-1 !text-xs !py-1.5" onClick={() => completa(r.id)}>
                  <Check size={14} /> Approva e anonimizza
                </button>
                <button className="btn-outline flex-1 !text-xs !py-1.5" onClick={() => rifiuta(r.id)}>
                  <X size={14} /> Rifiuta
                </button>
              </div>
            </div>
          ))}

          {altre.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted uppercase tracking-wide pt-2">Storico</p>
              <div className="grid gap-3 lg:grid-cols-2">
              {altre.map((r) => (
                <div key={r.id} className="card flex items-center justify-between gap-3 opacity-70">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{r.nome} {r.cognome}</p>
                    <p className="text-xs text-muted">{r.email} · {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT')}</p>
                  </div>
                  <span className={`badge shrink-0 ${STATO_COLORE[r.stato]}`}>{STATO_LABEL[r.stato]}</span>
                </div>
              ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
