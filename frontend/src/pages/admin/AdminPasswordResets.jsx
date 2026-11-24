import React, { useEffect, useState, useCallback } from 'react';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { KeyRound, Copy, Check } from 'lucide-react';
import { api } from '../../api.js';

const STATO_LABEL = { in_attesa: 'In attesa', completata: 'Completata' };
const STATO_COLORE = {
  in_attesa: 'bg-accent-light text-accent-dark',
  completata: 'bg-primary-light text-primary-dark',
};

export default function AdminPasswordResets() {
  const [richieste, setRichieste] = useState(null);
  const [smtpAttivo, setSmtpAttivo] = useState(null);
  const [error, setError] = useState('');
  const [generata, setGenerata] = useState(null); // { utente, password_temporanea }
  const [copiato, setCopiato] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.get('/auth/password-reset-richieste').then((d) => {
      setRichieste(d.richieste);
      setSmtpAttivo(d.smtp_attivo);
      setError('');
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const genera = async (id) => {
    if (!confirm('Generare una nuova password temporanea per questo utente? Dovrai comunicargliela tu, fuori dall\'app.')) return;
    try {
      const res = await api.post(`/auth/password-reset-richieste/${id}/genera`);
      setGenerata(res);
      setCopiato(false);
      load();
    } catch (e) { alert(e.message); }
  };

  const copia = () => {
    navigator.clipboard?.writeText(generata.password_temporanea).then(() => {
      setCopiato(true);
      setTimeout(() => setCopiato(false), 2000);
    });
  };

  const inAttesa = (richieste || []).filter((r) => r.stato === 'in_attesa');
  const altre = (richieste || []).filter((r) => r.stato !== 'in_attesa');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Reset password</h1>
        <p className="text-muted text-sm mt-0.5">
          Richieste di "password dimenticata" da gestire a mano: senza SMTP configurato non possiamo
          inviare un link sicuro all'utente, quindi la nuova password temporanea va generata qui e
          comunicata da te, fuori dall'app (telefono, di persona, chat aziendale...).
        </p>
        {smtpAttivo && (
          <p className="text-xs text-primary mt-1">
            SMTP è configurato: gli utenti ricevono già un link diretto via email, questa pagina in genere resta vuota.
          </p>
        )}
      </div>

      {/* L'errore di caricamento non nasconde la password appena generata (non viene mostrata di nuovo). */}
      {error && <ErroreConRiprova messaggio={error} onRiprova={load} />}

      {generata && (
        <div className="card bg-primary-light border-none">
          <p className="text-sm font-medium text-primary-dark flex items-center gap-1.5"><KeyRound size={15} /> Password generata per {generata.utente.nome} {generata.utente.cognome}</p>
          <p className="text-xs text-primary-dark/80 mt-0.5">Comunicala tu all'utente: non verrà mostrata di nuovo. Al primo accesso dovrà sceglierne una sua.</p>
          <div className="flex items-center gap-2 mt-2.5">
            <code className="flex-1 bg-surface rounded-lg px-3 py-2 text-sm font-mono">{generata.password_temporanea}</code>
            <button type="button" className="btn-outline !py-2" onClick={copia} aria-label="Copia password temporanea">
              {copiato ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}

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
                  <p className="text-xs text-muted mt-1">Richiesta il {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT')}</p>
                </div>
                <span className={`badge shrink-0 ${STATO_COLORE[r.stato]}`}>{STATO_LABEL[r.stato]}</span>
              </div>
              <button className="btn-primary w-full mt-3 !text-xs !py-1.5" onClick={() => genera(r.id)}>
                <KeyRound size={14} /> Genera nuova password
              </button>
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
