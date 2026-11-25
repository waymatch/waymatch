import React, { useState, useRef } from 'react';
import { Lockup, PoweredBy } from '../components/MarcaWayMatch.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const { branding } = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [modoRecupero, setModoRecupero] = useState(false);
  const [emailRecupero, setEmailRecupero] = useState('');
  const [recuperoInviato, setRecuperoInviato] = useState(false);
  const [recuperoInCorso, setRecuperoInCorso] = useState(false);
  const [erroreRecupero, setErroreRecupero] = useState('');
  const recuperoId = useRef(0); // cambiando modalità si invalida la richiesta di recupero in corso

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const richiediRecupero = async (e) => {
    e.preventDefault();
    const mia = ++recuperoId.current;
    setErroreRecupero('');
    setRecuperoInCorso(true);
    try {
      // Il server risponde sempre allo stesso modo, esista o no l'indirizzo: la conferma non rivela nulla.
      await api.post('/auth/password-dimenticata', { email: emailRecupero });
      if (mia === recuperoId.current) setRecuperoInviato(true);
    } catch (e) {
      // Rete assente o troppe richieste (limite per IP o per indirizzo): messaggio generico e
      // nuovo invio possibile, senza far credere che l'email sia partita.
      if (mia === recuperoId.current) setErroreRecupero('Non è stato possibile inviare la richiesta. Riprova tra qualche minuto.');
    } finally {
      if (mia === recuperoId.current) setRecuperoInCorso(false);
    }
  };

  return (
    <main id="contenuto" className="min-h-screen bg-bg flex items-center justify-center p-4">
      <h1 className="sr-only">Accesso</h1>
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

        {!modoRecupero ? (
          <>
            <form onSubmit={submit} className="card space-y-4">
              {error && <ErrorBanner message={error} />}
              <div>
                <label htmlFor="login-0" className="label">Email aziendale</label>
                <input id="login-0" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label htmlFor="login-1" className="label">Password</label>
                <input id="login-1" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button className="btn-primary w-full" disabled={loading}>
                {loading ? 'Accesso in corso...' : 'Accedi'}
              </button>
              <button type="button" className="block w-full text-center text-xs text-muted underline" onClick={() => { recuperoId.current++; setRecuperoInCorso(false); setErroreRecupero(''); setModoRecupero(true); setRecuperoInviato(false); }}>
                Password dimenticata?
              </button>
            </form>
            <p className="text-center text-xs text-muted mt-4">
              Non hai un account? Contatta il Mobility Manager della tua azienda.
            </p>
            <details className="mt-4 text-sm text-muted max-w-sm mx-auto">
              <summary className="cursor-pointer text-center hover:text-ink">Serve aiuto?</summary>
              <ul className="mt-3 space-y-2 text-left list-disc pl-5">
                <li><strong>Primo accesso:</strong> usa l'email e la password provvisoria che ti ha dato il Mobility Manager. Subito dopo sceglierai una password tua (almeno 14 caratteri).</li>
                <li><strong>Password dimenticata:</strong> usa il link "Password dimenticata?" qui sopra. {branding.email_attive ? 'Riceverai un\'email con le istruzioni.' : 'La richiesta arriva al Mobility Manager, che ti assegnerà una nuova password.'}</li>
                <li><strong>Altro:</strong> la guida completa è dentro l'app, nella voce "Informazioni" del menu, dopo l'accesso.</li>
              </ul>
            </details>
          </>
        ) : (
          <div className="card space-y-4">
            {recuperoInviato ? (
              <p className="text-sm text-center">
                {branding.email_attive
                  ? "Se l'indirizzo è registrato, riceverai a breve un'email con le istruzioni per reimpostare la password."
                  : "Se l'indirizzo è registrato, il Mobility Manager è stato avvisato e ti contatterà per assegnarti una nuova password. In questa installazione non vengono inviate email."}
              </p>
            ) : (
              <form onSubmit={richiediRecupero} className="space-y-4">
                {erroreRecupero && <ErrorBanner message={erroreRecupero} />}
                <p className="text-sm text-muted">
                  {branding.email_attive
                    ? 'Inserisci la tua email: ti mandiamo le istruzioni per reimpostare la password.'
                    : 'Inserisci la tua email: il Mobility Manager riceverà la richiesta e ti assegnerà una nuova password.'}
                </p>
                <div>
                  <label htmlFor="login-2" className="label">Email aziendale</label>
                  <input id="login-2" type="email" required className="input" value={emailRecupero} onChange={(e) => setEmailRecupero(e.target.value)} />
                </div>
                <button className="btn-primary w-full" disabled={recuperoInCorso}>
                  {recuperoInCorso ? 'Invio...' : 'Invia richiesta'}
                </button>
              </form>
            )}
            <button type="button" className="block w-full text-center text-xs text-muted underline" onClick={() => { recuperoId.current++; setRecuperoInCorso(false); setModoRecupero(false); }}>
              Torna al login
            </button>
          </div>
        )}
        {branding.logo_path && <div className="mt-6 text-center"><PoweredBy /></div>}
      </div>
    </main>
  );
}
