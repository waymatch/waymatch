import React, { useState } from 'react';
import { Lockup } from '../components/MarcaWayMatch.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Building2, User, ArrowRight, ArrowLeft, Plus, Trash2, MapPin } from 'lucide-react';
import { api, setToken } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import { REQUISITI_PASSWORD, passwordValida } from '../passwordPolicy.js';

// Ogni sede ha un identificativo stabile: eliminandone una, le altre non ereditano lo stato dei
// campi (per esempio la posizione sulla mappa) della sede tolta.
let contatoreSedi = 0;
const nuovaSede = () => ({ uid: ++contatoreSedi, nome: '', indirizzo: '', lat: null, lon: null });

export default function Setup({ onDone }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { refresh } = useAuth();
  const { refresh: refreshBranding } = useBranding();

  const [company, setCompany] = useState('');
  const [admin, setAdmin] = useState({ nome: '', cognome: '', email: '', password: '' });
  const [sedi, setSedi] = useState(() => [nuovaSede()]);

  const updateSede = (i, field, value) => {
    setSedi((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };
  const addSede = () => setSedi((prev) => [...prev, nuovaSede()]);
  const removeSede = (i) => setSedi((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setError('');
    setSaving(true);
    try {
      const payload = {
        company_name: company,
        ...admin,
        // uid serve solo all'interfaccia (chiave stabile): non fa parte del contratto dell'API
        sedi: sedi.filter((s) => s.nome.trim()).map(({ uid, ...sede }) => sede),
      };
      const data = await api.post('/setup', payload);
      setToken(data.token);
      await refresh();
      await refreshBranding();
      onDone();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <main id="contenuto" className="min-h-screen bg-bg flex items-center justify-center p-4">
      <h1 className="sr-only">Configurazione iniziale di WayMatch</h1>
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center gap-2 mb-8 text-center">
          <Lockup larghezza={220} />
          <p className="text-sm text-muted">Configurazione iniziale</p>
        </div>

        <div className="card">
          <StepIndicator step={step} />

          {error && (
            <ErrorBanner message={error} className="mb-4" />
          )}

          {step === 1 && (
            <div className="space-y-4">
              <StepTitle icon={User} title="Crea l'account amministratore" subtitle="Sarà il primo utente e potrà gestire l'intero sistema." />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="setup-0" className="label">Nome</label>
                  <input id="setup-0" className="input" value={admin.nome} onChange={(e) => setAdmin({ ...admin, nome: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="setup-1" className="label">Cognome</label>
                  <input id="setup-1" className="input" value={admin.cognome} onChange={(e) => setAdmin({ ...admin, cognome: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="setup-2" className="label">Email aziendale</label>
                <input id="setup-2" type="email" className="input" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              </div>
              <div>
                <label htmlFor="setup-3" className="label">Password</label>
                <input id="setup-3" type="password" className="input" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
                <p className="text-xs text-muted mt-1">{REQUISITI_PASSWORD}</p>
              </div>
              <button
                className="btn-primary w-full"
                disabled={!admin.nome || !admin.cognome || !admin.email || !passwordValida(admin.password)}
                onClick={() => setStep(2)}
              >
                Continua <ArrowRight size={16} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <StepTitle icon={Building2} title="La tua azienda" subtitle="Nome visualizzato nell'app (potrai aggiungere il logo dopo, dal pannello admin)." />
              <div>
                <label htmlFor="setup-4" className="label">Nome azienda</label>
                <input id="setup-4" className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Es. Rossi S.p.A." />
              </div>
              <div className="flex gap-3">
                <button className="btn-outline flex-1" onClick={() => setStep(1)}><ArrowLeft size={16} /> Indietro</button>
                <button className="btn-primary flex-1" disabled={!company.trim()} onClick={() => setStep(3)}>
                  Continua <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <StepTitle icon={Building2} title="Sedi aziendali" subtitle="Aggiungi le sedi tra cui i dipendenti potranno organizzare i passaggi." />
              <div className="space-y-3">
                {sedi.map((s, i) => (
                  <div key={s.uid} className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <input className="input" placeholder={`Sede ${i + 1} — nome`} value={s.nome} onChange={(e) => updateSede(i, 'nome', e.target.value)} />
                      <AddressAutocomplete
                        value={s.indirizzo}
                        onChange={(v) => { updateSede(i, 'indirizzo', v); updateSede(i, 'lat', null); updateSede(i, 'lon', null); }}
                        onSelect={(place) => {
                          updateSede(i, 'indirizzo', place.label);
                          updateSede(i, 'lat', place.lat);
                          updateSede(i, 'lon', place.lon);
                        }}
                        placeholder="Indirizzo della sede..."
                      />
                      {s.lat ? (
                        <p className="text-xs text-primary flex items-center gap-1"><MapPin size={12} /> Posizione trovata — calcolo automatico tratte abilitato</p>
                      ) : (
                        <p className="text-xs text-muted">Seleziona un indirizzo dai suggerimenti per abilitare il calcolo automatico delle tratte.</p>
                      )}
                    </div>
                    {sedi.length > 1 && (
                      <button type="button" aria-label={`Rimuovi la sede ${i + 1}${s.nome ? `: ${s.nome}` : ''}`} className="p-2.5 text-muted hover:text-danger" onClick={() => removeSede(i)}><Trash2 size={16} aria-hidden="true" /></button>
                    )}
                  </div>
                ))}
              </div>
              <button className="btn-ghost text-primary" onClick={addSede}><Plus size={16} /> Aggiungi sede</button>
              <div className="flex gap-3 pt-2">
                <button className="btn-outline flex-1" onClick={() => setStep(2)}><ArrowLeft size={16} /> Indietro</button>
                <button className="btn-primary flex-1" disabled={saving} onClick={submit}>
                  {saving ? 'Configurazione...' : 'Completa configurazione'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {[1, 2, 3].map((s) => (
        <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </div>
  );
}

function StepTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="mb-2">
      <div className="w-9 h-9 rounded-lg bg-primary-light text-primary-dark flex items-center justify-center mb-3">
        <Icon size={18} />
      </div>
      <h2 className="font-display font-semibold text-lg">{title}</h2>
      <p className="text-sm text-muted mt-0.5">{subtitle}</p>
    </div>
  );
}
