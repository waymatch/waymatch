import React, { useEffect, useState, useCallback } from 'react';
import { Car, Building2, Lock, Bell, BellOff, BellRing, User, FileText, Check, MapPin, Shield, Download, ShieldOff, Monitor, Smartphone, LogOut } from 'lucide-react';
import { api, setToken, scaricaFile, logout } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { pushSupportato, statoPermesso, attivaPush, disattivaPush, sottoscrizioneAttiva } from '../push.js';
import { REQUISITI_PASSWORD } from '../passwordPolicy.js';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import DocumentContent from '../components/DocumentContent.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Schede from '../components/Schede.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import PdfDocumento from '../components/PdfDocumento.jsx';
import Avatar, { dimenticaFoto } from '../components/Avatar.jsx';
import RitaglioFoto from '../components/RitaglioFoto.jsx';

const ALIMENTAZIONI = [
  { value: 'benzina', label: 'Benzina' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'gpl', label: 'GPL' },
  { value: 'metano', label: 'Metano' },
  { value: 'ibrida', label: 'Ibrida' },
  { value: 'elettrica', label: 'Elettrica' },
];

const MARCHE = [
  'Alfa Romeo', 'Audi', 'BMW', 'Citroën', 'Cupra', 'Dacia', 'Fiat', 'Ford', 'Honda',
  'Hyundai', 'Jeep', 'Kia', 'Lancia', 'Mazda', 'Mercedes-Benz', 'MINI', 'Mitsubishi',
  'Nissan', 'Opel', 'Peugeot', 'Renault', 'Seat', 'Škoda', 'Smart', 'Suzuki', 'Tesla',
  'Toyota', 'Volkswagen', 'Volvo', 'Altra',
];

const TABS = [
  { id: 'info', label: 'Info', icon: User },
  { id: 'auto', label: 'La tua auto', icon: Car },
  { id: 'notifiche', label: 'Notifiche', icon: Bell },
  { id: 'documenti', label: 'Documenti', icon: FileText },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'password', label: 'Sicurezza', icon: Lock },
];

export default function Profile() {
  const { user, refresh, punti } = useAuth();
  const { branding: { gamification } } = useBranding();
  const [sedi, setSedi] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('info');
  const [erroreSedi, setErroreSedi] = useState('');

  const caricaSedi = useCallback(() => {
    setErroreSedi('');
    api.get('/sedi').then((d) => setSedi(d.sedi)).catch((e) => setErroreSedi(e.message || 'Impossibile caricare le sedi.'));
  }, []);
  useEffect(() => { caricaSedi(); }, [caricaSedi]);

  useEffect(() => {
    if (user) {
      setForm({
        sede_id: user.sede_id || '',
        telefono: user.telefono || '',
        indirizzo_casa: user.indirizzo_casa || '',
        casa_lat: user.casa_lat ?? null,
        casa_lon: user.casa_lon ?? null,
        citta_casa: user.citta_casa || '',
        auto_marca: user.auto_marca || '',
        auto_modello: user.auto_modello || '',
        auto_anno: user.auto_anno || '',
        auto_cilindrata: user.auto_cilindrata || '',
        auto_colore: user.auto_colore || '',
        auto_alimentazione: user.auto_alimentazione || '',
        auto_posti: user.auto_posti || 3,
        auto_targa: user.auto_targa || '',
      });
    }
  }, [user]);

  if (!form) return <div className="card animate-pulse h-40" />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await api.put('/auth/me', form);
      await refresh();
      setMsg('Profilo aggiornato.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Il tuo profilo</h1>
        <p className="text-muted text-sm mt-0.5">{user.nome} {user.cognome} · {user.email}</p>
      </div>

      <Schede schede={TABS} attiva={tab} onChange={setTab}>

      {tab === 'info' && (
        <div className="space-y-5">
          <div className="card flex items-center justify-between">
            {gamification ? (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Punti accumulati</p>
                <p className="font-display font-bold text-2xl mt-0.5">{punti}</p>
              </div>
            ) : (
              <p className="font-display font-semibold">{user.nome} {user.cognome}</p>
            )}
            <span className="badge-accent capitalize">{user.ruolo.replace('_', ' ')}</span>
          </div>

          <FotoProfilo user={user} onCambiata={refresh} />

          <form onSubmit={save} className="space-y-5">
            <div className="card space-y-4">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Sede aziendale</h2>
              </div>
              <select aria-label="Sede aziendale" className="input" value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })}>
                <option value="">Seleziona la tua sede</option>
                {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              {erroreSedi && (
                <div className="mt-1 flex items-center gap-2 text-xs text-danger" role="alert">
                  <span>{erroreSedi}</span>
                  <button type="button" className="underline text-primary" onClick={caricaSedi}>Riprova</button>
                </div>
              )}
              <div>
                <label htmlFor="profile-0" className="label">Telefono (per contattarti sui passaggi)</label>
                <input id="profile-0" className="input" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
              </div>
            </div>

            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-primary" />
                <h2 className="font-display font-semibold text-sm">Indirizzo di casa</h2>
              </div>
              <p className="text-xs text-muted -mt-1">
                Usato per precompilare l'indirizzo quando offri un passaggio (resta comunque
                modificabile ogni volta) e per mostrarti prima, in "Cerca" e in Home, i passaggi
                il cui percorso passa vicino a te.
              </p>
              <AddressAutocomplete
                value={form.indirizzo_casa}
                onChange={(v) => setForm({ ...form, indirizzo_casa: v, casa_lat: null, casa_lon: null })}
                onSelect={(place) => setForm({ ...form, indirizzo_casa: place.label, casa_lat: place.lat, casa_lon: place.lon, citta_casa: place.citta || form.citta_casa })}
                placeholder="Cerca il tuo indirizzo di casa..."
              />
              {form.casa_lat != null && (
                <p className="text-xs text-primary flex items-center gap-1"><MapPin size={12} /> Posizione trovata</p>
              )}
            </div>

            {msg && <div className="rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5">{msg}</div>}
            <button className="btn-primary w-full" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</button>
          </form>
        </div>
      )}

      {tab === 'auto' && (
        <form onSubmit={save} className="space-y-5">
          <div className="card space-y-4">
            <p className="text-xs text-muted">
              Marca, modello e colore aiutano i colleghi a riconoscerla al punto di ritrovo;
              cilindrata e alimentazione servono per stimare CO2 e costi risparmiati nei report.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-1" className="label">Marca</label>
                <select id="profile-1" className="input" value={form.auto_marca} onChange={(e) => setForm({ ...form, auto_marca: e.target.value })}>
                  <option value="">Seleziona...</option>
                  {MARCHE.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="profile-2" className="label">Modello</label>
                <input id="profile-2" className="input" value={form.auto_modello} onChange={(e) => setForm({ ...form, auto_modello: e.target.value })} placeholder="Es. Panda" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-3" className="label">Targa</label>
                <input id="profile-3" className="input uppercase" value={form.auto_targa} onChange={(e) => setForm({ ...form, auto_targa: e.target.value.toUpperCase() })} placeholder="Es. AB123CD" />
              </div>
              <div>
                <label htmlFor="profile-4" className="label">Posti passeggeri</label>
                <input id="profile-4" type="number" min="1" max="8" className="input" value={form.auto_posti} onChange={(e) => setForm({ ...form, auto_posti: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-5" className="label">Colore</label>
                <input id="profile-5" className="input" value={form.auto_colore} onChange={(e) => setForm({ ...form, auto_colore: e.target.value })} placeholder="Es. grigio metallizzato" />
              </div>
              <div>
                <label htmlFor="profile-6" className="label">Anno</label>
                <input id="profile-6" type="number" className="input" value={form.auto_anno} onChange={(e) => setForm({ ...form, auto_anno: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-7" className="label">Cilindrata (cc)</label>
                <input id="profile-7" type="number" className="input" value={form.auto_cilindrata} onChange={(e) => setForm({ ...form, auto_cilindrata: e.target.value })} />
              </div>
              <div>
                <label htmlFor="profile-8" className="label">Alimentazione</label>
                <select id="profile-8" className="input" value={form.auto_alimentazione} onChange={(e) => setForm({ ...form, auto_alimentazione: e.target.value })}>
                  <option value="">Seleziona</option>
                  {ALIMENTAZIONI.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>
          </div>
          {msg && <div className="rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5">{msg}</div>}
          <button className="btn-primary w-full" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</button>
        </form>
      )}

      {tab === 'notifiche' && (
        <div className="space-y-5">
          <NotificationsCard />
          <NotificationPreferences />
        </div>
      )}

      {tab === 'documenti' && <DocumentsTab />}

      {tab === 'privacy' && <PrivacyTab />}

      {tab === 'password' && (
        <div className="space-y-4">
          <PasswordForm />
          <SessioniCard />
        </div>
      )}
      </Schede>
    </div>
  );
}

function NotificationsCard() {
  const [supportato, setSupportato] = useState(true);
  const [permesso, setPermesso] = useState('default');
  const [sottoscritto, setSottoscritto] = useState(false); // sottoscrizione attiva su questo dispositivo
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [errorePush, setErrorePush] = useState(false);

  useEffect(() => {
    setSupportato(pushSupportato());
    statoPermesso().then(setPermesso);
    sottoscrizioneAttiva().then(setSottoscritto);
  }, []);

  const attiva = async () => {
    setLoading(true);
    setMsg(''); setErrorePush(false);
    try {
      await attivaPush();
      setPermesso('granted');
      setSottoscritto(true);
      setMsg('Notifiche push attivate su questo dispositivo.');
    } catch (e) {
      setErrorePush(true);
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const disattiva = async () => {
    setLoading(true);
    setMsg(''); setErrorePush(false);
    try {
      await disattivaPush();
      setSottoscritto(false); // il permesso resta concesso: si può riattivare dalla pagina
      setMsg('Notifiche push disattivate su questo dispositivo.');
    } catch (e) {
      setErrorePush(true);
      setMsg(e.message || 'Non è stato possibile disattivare le notifiche push. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Bell size={16} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">Notifiche push</h2>
      </div>
      {!supportato ? (
        <p className="text-sm text-muted">Il tuo browser non supporta le notifiche push.</p>
      ) : permesso === 'denied' ? (
        <p className="text-sm text-muted">
          Hai bloccato le notifiche per questo sito. Per riattivarle, cambia il permesso dalle impostazioni del browser.
        </p>
      ) : permesso === 'granted' && sottoscritto ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted flex items-center gap-1.5"><BellRing size={14} className="text-primary" /> Notifiche attive su questo dispositivo</p>
          <button className="btn-outline !py-1.5 !text-sm" disabled={loading} onClick={disattiva}>
            <BellOff size={13} /> Disattiva
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Ricevi un avviso quando qualcuno richiede o conferma un tuo passaggio.</p>
          <button className="btn-primary !py-1.5 !text-sm shrink-0" disabled={loading} onClick={attiva}>
            {loading ? '...' : 'Attiva'}
          </button>
        </div>
      )}
      {msg && <p className={`text-xs ${errorePush ? 'text-danger' : 'text-muted'}`} role={errorePush ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

function NotificationPreferences() {
  const { branding } = useBranding();
  const [categorie, setCategorie] = useState(null);
  const [erroreCarica, setErroreCarica] = useState('');

  const load = () => {
    setErroreCarica('');
    api.get('/notification-prefs').then((d) => setCategorie(d.categorie)).catch((e) => setErroreCarica(e.message || 'Impossibile caricare le preferenze.'));
  };
  useEffect(() => { load(); }, []);

  // Si invia solo il campo cambiato: due modifiche ravvicinate della stessa categoria non si
  // sovrascrivono con lo stato di un render precedente.
  const aggiorna = async (cat, campo, valore) => {
    setCategorie((prev) => prev.map((c) => (c.chiave === cat.chiave ? { ...c, [campo]: valore } : c)));
    try {
      await api.put(`/notification-prefs/${cat.chiave}`, { [campo]: valore });
    } catch (e) {
      alert(e.message);
      load(); // ripristina lo stato reale dal server: l'aggiornamento ottimistico non è andato a buon fine
    }
  };

  if (erroreCarica) {
    return (
      <div className="card text-center py-6 space-y-3" role="alert">
        <p className="text-sm text-danger">{erroreCarica}</p>
        <button type="button" className="btn-outline !text-xs" onClick={load}>Riprova</button>
      </div>
    );
  }
  if (categorie === null) return <div className="card animate-pulse h-24" />;

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Bell size={16} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">Preferenze notifiche</h2>
      </div>
      <p className="text-xs text-muted -mt-1">Scegli dove ricevere ogni avviso: nell'app (la campanella), sul telefono (push) o per email. Senza nessuna spunta l'avviso non arriva.{!branding.email_attive && ' In questa installazione non vengono inviate email.'}</p>
      <div className="divide-y divide-border">
        {categorie.map((c) => (
          <div key={c.chiave} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium">{c.nome}</p>
            <p className="text-xs text-muted mt-0.5">{c.descrizione}</p>
            <div className="flex gap-4 mt-2 items-center flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={c.inapp} onChange={(e) => aggiorna(c, 'inapp', e.target.checked)} />
                App
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={c.push} onChange={(e) => aggiorna(c, 'push', e.target.checked)} />
                Push
              </label>
              {branding.email_attive && (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={c.email} onChange={(e) => aggiorna(c, 'email', e.target.checked)} />
                  Email
                </label>
              )}
              {c.conMinutiAnticipo && (c.inapp || c.push || (c.email && branding.email_attive)) && (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Anticipo:
                  <select
                    className="input !w-auto !py-1 !text-sm"
                    value={c.minuti_anticipo}
                    onChange={(e) => aggiorna(c, 'minuti_anticipo', Number(e.target.value))}
                  >
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>1 ora</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentsTab() {
  const [documenti, setDocumenti] = useState(null);
  const [aperto, setAperto] = useState(null);

  const [erroreCarica, setErroreCarica] = useState('');
  const load = () => {
    setErroreCarica('');
    api.get('/legal-documents').then((d) => setDocumenti(d.documenti)).catch((e) => setErroreCarica(e.message || 'Impossibile caricare i documenti.'));
  };
  useEffect(() => { load(); }, []);

  if (erroreCarica) {
    return (
      <div className="card text-center py-6 space-y-3" role="alert">
        <p className="text-sm text-danger">{erroreCarica}</p>
        <button type="button" className="btn-outline !text-xs" onClick={load}>Riprova</button>
      </div>
    );
  }
  if (documenti === null) return <div className="card animate-pulse h-24" />;
  if (documenti.length === 0) return <div className="card text-center py-8 text-sm text-muted">Nessun documento disponibile.</div>;

  return (
    <div className="space-y-3">
      {documenti.map((d) => {
        const accettato = d.versione_accettata >= d.versione;
        return (
          <div key={d.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm flex items-center gap-1.5"><FileText size={14} className="text-primary" /> {d.titolo}</p>
              {accettato ? (
                <span className="badge-primary shrink-0"><Check size={11} /> Accettato</span>
              ) : (
                <span className="badge bg-accent-light text-accent-dark shrink-0">Da accettare</span>
              )}
            </div>
            {d.tipo === 'conducente' && (
              <p className="text-xs text-muted mt-1">Richiesto solo a chi offre un passaggio</p>
            )}
            {accettato && (
              <p className="text-xs text-muted mt-1.5">
                Accettato il {new Date(d.accettato_at.replace(' ', 'T') + 'Z').toLocaleString('it-IT')}
              </p>
            )}
            <button className="text-xs text-primary mt-2" onClick={() => setAperto(aperto === d.id ? null : d.id)}>
              {aperto === d.id ? 'Nascondi' : d.formato === 'pdf' ? 'Visualizza il documento' : 'Leggi il testo completo'}
            </button>
            {aperto === d.id && (
              <div className="mt-2 border-t border-border pt-2">
                {d.formato === 'pdf' ? (
                  <PdfDocumento docId={d.id} titolo={d.titolo} />
                ) : (
                  <DocumentContent testo={d.contenuto} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PrivacyTab() {
  const [richiesta, setRichiesta] = useState(null);
  const [caricato, setCaricato] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [inviando, setInviando] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    api.get('/privacy/cancellazione/mia').then((d) => setRichiesta(d.richiesta)).finally(() => setCaricato(true));
  };
  useEffect(() => { load(); }, []);

  const esporta = async () => {
    setExporting(true);
    setMsg('');
    try {
      await scaricaFile('/privacy/export', 'i-miei-dati.json');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setExporting(false);
    }
  };

  const richiedi = async () => {
    if (!confirm('Confermi di voler richiedere la cancellazione del tuo account? La valuterà un mobility manager.')) return;
    setInviando(true);
    setMsg('');
    try {
      await api.post('/privacy/cancellazione', { motivo: motivo || null });
      setMotivo('');
      load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setInviando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-primary" />
          <h2 className="font-display font-semibold text-sm">Esporta i tuoi dati</h2>
        </div>
        <p className="text-xs text-muted">
          Scarica un file con tutti i dati che l'app conserva su di te: profilo, passaggi
          offerti e prenotati, punti e riscatti premi (se ce ne sono), documenti accettati e log delle tue azioni.
        </p>
        <button className="btn-outline w-full" disabled={exporting} onClick={esporta}>
          {exporting ? 'Preparazione...' : <><Download size={15} /> Scarica i miei dati</>}
        </button>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <ShieldOff size={16} className="text-danger" />
          <h2 className="font-display font-semibold text-sm">Cancellazione dell'account</h2>
        </div>

        {!caricato ? null : richiesta?.stato === 'in_attesa' ? (
          <p className="text-sm text-muted">
            Hai una richiesta di cancellazione in attesa, inviata il{' '}
            {new Date(richiesta.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT')}.
            Un mobility manager la valuterà a breve.
          </p>
        ) : (
          <>
            {richiesta?.stato === 'rifiutata' && (
              <p className="text-sm text-muted">
                Una tua richiesta precedente è stata rifiutata{richiesta.motivo ? `: ${richiesta.motivo}` : '.'}
              </p>
            )}
            <p className="text-xs text-muted">
              Puoi chiedere la cancellazione dei tuoi dati personali. Se un mobility manager la
              approva, il tuo profilo viene anonimizzato e non potrai più accedere. I passaggi
              condivisi con altri colleghi restano visibili nel loro storico, senza i tuoi dati
              identificativi.
            </p>
            <textarea
              className="input" rows="2" placeholder="Motivo (facoltativo)"
              value={motivo} onChange={(e) => setMotivo(e.target.value)}
            />
            <button className="btn-outline w-full" disabled={inviando} onClick={richiedi}>
              {inviando ? 'Invio...' : 'Richiedi cancellazione'}
            </button>
          </>
        )}
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </div>
    </div>
  );
}

function PasswordForm() {
  const [password_attuale, setAttuale] = useState('');
  const [password_nuova, setNuova] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const res = await api.put('/auth/me/password', { password_attuale, password_nuova });
      // Il cambio password invalida lato server ogni token emesso prima: senza salvare
      // quello nuovo restituito qui, la sessione corrente si disconnetterebbe da sola
      // alla prossima richiesta.
      setToken(res.token);
      setMsg('Password aggiornata.');
      setAttuale(''); setNuova('');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div className="flex items-center gap-2">
        <Lock size={16} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">Cambia password</h2>
      </div>
      <input type="password" required placeholder="Password attuale" className="input" value={password_attuale} onChange={(e) => setAttuale(e.target.value)} />
      <div>
        <input type="password" required placeholder="Nuova password" className="input" value={password_nuova} onChange={(e) => setNuova(e.target.value)} />
        <p className="text-xs text-muted mt-1">{REQUISITI_PASSWORD}</p>
      </div>
      {msg && <p className="text-sm text-muted">{msg}</p>}
      <button className="btn-outline w-full" disabled={saving}>{saving ? 'Salvataggio...' : 'Aggiorna password'}</button>
    </form>
  );
}

function descriviDispositivo(ua = '') {
  const sistema = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  if (!sistema && !browser) return 'Dispositivo sconosciuto';
  return [browser || 'Browser', sistema && `su ${sistema}`].filter(Boolean).join(' ');
}

// Le date arrivano dal database in UTC, nel formato "AAAA-MM-GG HH:MM:SS".
const formattaData = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

function SessioniCard() {
  const [sessioni, setSessioni] = useState(null);
  const [errore, setErrore] = useState('');
  const [confermaTutti, setConfermaTutti] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  const carica = () => api.get('/auth/sessioni').then((d) => setSessioni(d.sessioni)).catch((e) => setErrore(e.message));
  useEffect(() => { carica(); }, []);

  const revoca = async (s) => {
    setErrore('');
    try {
      await api.del(`/auth/sessioni/${s.id}`);
      if (s.corrente) {
        await logout();
        window.location.replace('/login');
        return;
      }
      carica();
    } catch (e) {
      setErrore(e.message);
    }
  };

  const esciDaTutti = async () => {
    setErrore('');
    setInCorso(true);
    try {
      const res = await api.post('/auth/esci-ovunque');
      setToken(res.token);
      setConfermaTutti(false);
      carica();
    } catch (e) {
      setErrore(e.message);
    } finally {
      setInCorso(false);
    }
  };

  const altre = (sessioni || []).filter((s) => !s.corrente).length;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Monitor size={16} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">Dispositivi collegati</h2>
      </div>
      <p className="text-xs text-muted">
        Resti collegato finché usi l'app almeno una volta ogni 7 giorni, fino a 30 giorni dall'accesso.
        Se non riconosci un dispositivo, scollegalo e cambia la password.
      </p>
      {errore && <ErrorBanner message={errore} />}
      {!sessioni && !errore && <p className="text-sm text-muted">Caricamento...</p>}
      {sessioni && (
        <ul className="divide-y divide-border">
          {sessioni.map((s) => {
            const Icona = /iPhone|iPad|Android/.test(s.dispositivo || '') ? Smartphone : Monitor;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Icona size={18} className="text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {descriviDispositivo(s.dispositivo || '')}
                    {s.corrente && <span className="badge-primary ml-2">Questo dispositivo</span>}
                  </p>
                  <p className="text-xs text-muted">
                    Accesso {formattaData(s.creata_il)} · ultimo uso {formattaData(s.ultimo_uso)}
                  </p>
                </div>
                <button type="button" className="btn-ghost" onClick={() => revoca(s)}>
                  {s.corrente ? 'Esci' : 'Scollega'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {altre > 0 && !confermaTutti && (
        <button type="button" className="btn-outline w-full" onClick={() => setConfermaTutti(true)}>
          <LogOut size={16} /> Esci da tutti gli altri dispositivi
        </button>
      )}
      {confermaTutti && (
        <div className="space-y-2">
          <p className="text-sm">Vuoi scollegare gli altri {altre} dispositivi? Dovranno rifare l'accesso.</p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={inCorso} onClick={esciDaTutti}>Conferma</button>
            <button type="button" className="btn-outline flex-1" disabled={inCorso} onClick={() => setConfermaTutti(false)}>Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Foto del profilo: facoltativa, la vedono i colleghi accanto al nome; si salva cifrata.
function FotoProfilo({ user, onCambiata }) {
  const [inCorso, setInCorso] = useState(false);
  const [msg, setMsg] = useState('');
  const [daRitagliare, setDaRitagliare] = useState(null); // file scelto, prima del ritaglio
  const idInput = 'foto-profilo-file';

  const scegli = (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // così si può riprovare con lo stesso file
    if (file) { setMsg(''); setDaRitagliare(file); }
  };
  const carica = async (blob) => {
    setDaRitagliare(null);
    setInCorso(true); setMsg('');
    try {
      const form = new FormData();
      form.append('foto', blob, 'foto.jpg');
      await api.put('/foto', form);
      dimenticaFoto(user.id);
      await onCambiata();
      setMsg('Foto aggiornata.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setInCorso(false);
    }
  };
  const togli = async () => {
    if (!confirm('Rimuovere la foto del profilo?')) return;
    setInCorso(true); setMsg('');
    try {
      await api.del('/foto');
      dimenticaFoto(user.id);
      await onCambiata();
      setMsg('Foto rimossa.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="card flex items-start gap-4">
      <Avatar id={user.id} nome={user.nome} cognome={user.cognome} versione={user.foto_versione} dimensione="lg" />
      <div className="min-w-0 space-y-2">
        <h2 className="font-display font-semibold text-sm">Foto del profilo</h2>
        <p className="text-xs text-muted">
          Facoltativa. La vedono i colleghi accanto al tuo nome, per esempio quando offri o chiedi un passaggio:
          aiuta a riconoscersi al punto di ritrovo. Viene ridotta, ripulita dai dati dello scatto (come la posizione)
          e conservata cifrata. Puoi rimuoverla quando vuoi. JPEG o PNG, al massimo 5 MB: dopo averla scelta
          decidi quale parte mostrare.
        </p>
        <div className="flex flex-wrap gap-2">
          <label htmlFor={idInput} className={`btn-outline !py-1.5 !text-sm cursor-pointer ${inCorso ? 'opacity-60 pointer-events-none' : ''}`}>
            {user.foto_versione ? 'Cambia foto' : 'Carica una foto'}
          </label>
          <input id={idInput} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={scegli} disabled={inCorso} />
          {!!user.foto_versione && (
            <button type="button" className="btn-outline !py-1.5 !text-sm" onClick={togli} disabled={inCorso}>Rimuovi la foto</button>
          )}
        </div>
        {msg && <p className="text-sm text-muted" role="status">{msg}</p>}
      </div>
      {daRitagliare && <RitaglioFoto file={daRitagliare} onAnnulla={() => setDaRitagliare(null)} onConferma={carica} />}
    </div>
  );
}
