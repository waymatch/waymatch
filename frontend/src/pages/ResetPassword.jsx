import React, { useState } from 'react';
import { Lockup } from '../components/MarcaWayMatch.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Check } from 'lucide-react';
import { api } from '../api.js';
import { useBranding } from '../context/BrandingContext.jsx';
import { REQUISITI_PASSWORD, passwordValida } from '../passwordPolicy.js';

// Pagina pubblica raggiunta dal link inviato via email (solo quando SMTP è configurato,
// vedi POST /auth/password-dimenticata). Senza email il reset passa dal mobility manager.
export default function ResetPassword() {
  const { branding } = useBranding();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [passwordNuova, setPasswordNuova] = useState('');
  const [conferma, setConferma] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fatto, setFatto] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!passwordValida(passwordNuova)) { setError(`Password non valida: ${REQUISITI_PASSWORD}`); return; }
    if (passwordNuova !== conferma) { setError('Le due password non coincidono.'); return; }
    setSaving(true);
    try {
      await api.post('/auth/reimposta-password', { token, password_nuova: passwordNuova });
      setFatto(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main id="contenuto" className="min-h-screen bg-bg flex items-center justify-center p-4">
      <h1 className="sr-only">Scegli una nuova password</h1>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          {branding.logo_path ? (
            <>
              <img src={branding.logo_path} alt={`Logo ${branding.company_name}`} className="max-w-[10.5rem] max-h-14 object-contain" />
              <p className="font-display font-bold text-xl">{branding.company_name}</p>
            </>
          ) : (
            <>
              <Lockup larghezza={240} />
              <p className="font-display font-semibold text-lg">{branding.company_name}</p>
            </>
          )}
        </div>

        {!token ? (
          <div className="card text-center text-sm text-muted">
            Link non valido. <Link to="/login" className="text-primary underline">Torna al login</Link>
          </div>
        ) : fatto ? (
          <div className="card text-center space-y-2">
            <Check size={28} className="text-primary mx-auto" />
            <p className="font-medium">Password aggiornata</p>
            <p className="text-sm text-muted">Ti reindirizziamo al login...</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4">
            <p className="text-sm text-muted">Scegli la nuova password per il tuo account.</p>
            {error && <ErrorBanner message={error} />}
            <div>
              <label htmlFor="resetpassword-0" className="label">Nuova password</label>
              <input id="resetpassword-0" type="password" autoComplete="new-password" required className="input" value={passwordNuova} onChange={(e) => setPasswordNuova(e.target.value)} />
              <p className="text-xs text-muted mt-1">{REQUISITI_PASSWORD}</p>
            </div>
            <div>
              <label htmlFor="resetpassword-1" className="label">Conferma nuova password</label>
              <input id="resetpassword-1" type="password" autoComplete="new-password" required className="input" value={conferma} onChange={(e) => setConferma(e.target.value)} />
            </div>
            <button className="btn-primary w-full" disabled={saving}>{saving ? 'Salvataggio...' : 'Reimposta password'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
