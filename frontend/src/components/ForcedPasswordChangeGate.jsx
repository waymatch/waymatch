import FinestraModale from './FinestraModale.jsx';
import React, { useState } from 'react';
import ErrorBanner from './ErrorBanner.jsx';
import { KeyRound } from 'lucide-react';
import { api, setToken } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { REQUISITI_PASSWORD } from '../passwordPolicy.js';

// Si frappone tra login e resto dell'app quando la password in uso è stata scelta da
// qualcun altro (nuovo account creato dal MM, a mano o via CSV, oppure un reset).
// Prima di questo, prima ancora dei consensi privacy (LegalDocumentsGate): una password
// che qualcun altro conosce deve smettere di essere valida il prima possibile.
export default function ForcedPasswordChangeGate({ children }) {
  const { user, refresh } = useAuth();
  const [passwordAttuale, setPasswordAttuale] = useState('');
  const [passwordNuova, setPasswordNuova] = useState('');
  const [conferma, setConferma] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user?.password_da_cambiare) return children;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    // I requisiti della password li verifica il server, che risponde con il messaggio completo.
    if (passwordNuova !== conferma) {
      setError('Le due password non coincidono.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.put('/auth/me/password', { password_attuale: passwordAttuale, password_nuova: passwordNuova });
      setToken(res.token);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    // Il velo scorre: su uno schermo basso (telefono, tastiera aperta) con il messaggio di
    // errore la finestra supera l'altezza visibile e il bottone resterebbe irraggiungibile.
    <FinestraModale titoloId="password-provvisoria-titolo" className="fixed inset-0 z-[100] bg-black/60 overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4">
      <div className="bg-surface w-full max-w-sm rounded-2xl p-6">
        <div className="w-11 h-11 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center mb-4">
          <KeyRound size={20} />
        </div>
        <h2 id="password-provvisoria-titolo" className="font-display font-semibold text-lg">Scegli una nuova password</h2>
        <p className="text-sm text-muted mt-1 mb-4">
          Prima di continuare, imposta una password che conosci solo tu.
        </p>
        <form onSubmit={submit} className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <div>
            <label htmlFor="forcedpasswordchangegate-0" className="label">Password attuale</label>
            <input id="forcedpasswordchangegate-0" type="password" required className="input" value={passwordAttuale} onChange={(e) => setPasswordAttuale(e.target.value)} />
          </div>
          <div>
            <label htmlFor="forcedpasswordchangegate-1" className="label">Nuova password</label>
            <input id="forcedpasswordchangegate-1" type="password" required className="input" value={passwordNuova} onChange={(e) => setPasswordNuova(e.target.value)} />
            <p className="text-xs text-muted mt-1">{REQUISITI_PASSWORD}</p>
          </div>
          <div>
            <label htmlFor="forcedpasswordchangegate-2" className="label">Conferma nuova password</label>
            <input id="forcedpasswordchangegate-2" type="password" required className="input" value={conferma} onChange={(e) => setConferma(e.target.value)} />
          </div>
          <button className="btn-primary w-full" disabled={saving}>{saving ? 'Salvataggio...' : 'Conferma e continua'}</button>
        </form>
      </div>
      </div>
    </FinestraModale>
  );
}
