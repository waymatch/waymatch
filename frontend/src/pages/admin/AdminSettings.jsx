import React, { useEffect, useState, useRef } from 'react';
import { Upload, Palette, ClipboardCheck, CalendarDays, Mail, Send, CheckCircle2, XCircle, Leaf, RotateCcw, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { useBranding } from '../../context/BrandingContext.jsx';
import Schede from '../../components/Schede.jsx';
import { GIORNI_SETTIMANA, descriviGiorni } from '../../giorni.js';
import { controllaColorePrimario } from '../../colori.js';

const TABS = [
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'validazione', label: 'Validazione viaggi', icon: ClipboardCheck },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
  { id: 'costi-co2', label: 'Costi e CO2', icon: Leaf },
  { id: 'email', label: 'Email', icon: Mail },
];

export default function AdminSettings() {
  const [tab, setTab] = useState('branding');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Impostazioni generali</h1>
        <p className="text-muted text-sm mt-0.5">Identità aziendale, workflow di completamento viaggi, notifiche via email.</p>
      </div>

      <Schede schede={TABS} attiva={tab} onChange={setTab}>
      {tab === 'branding' && <BrandingTab />}
      {tab === 'validazione' && <ValidazioneTab />}
      {tab === 'calendario' && <CalendarioTab />}
      {tab === 'costi-co2' && <CostiCo2Tab />}
      {tab === 'email' && <EmailTab />}
      </Schede>
    </div>
  );
}

function BrandingTab() {
  const { branding, refresh } = useBranding();
  const [companyName, setCompanyName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#14424F');
  const [accentColor, setAccentColor] = useState('#3CC8B8');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  const iconaRef = useRef();
  const [iconaMsg, setIconaMsg] = useState('');
  const [nomeBreve, setNomeBreve] = useState('');

  useEffect(() => {
    setNomeBreve(branding.pwa_short_name || '');
    setCompanyName(branding.company_name || '');
    setPrimaryColor(branding.primary_color || '#14424F');
    setAccentColor(branding.accent_color || '#3CC8B8');
    // Solo i quattro valori salvati: un ricaricamento dopo il caricamento di un logo non ricopia
    // sul modulo i valori vecchi, perdendo le modifiche non ancora salvate.
  }, [branding.pwa_short_name, branding.company_name, branding.primary_color, branding.accent_color]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await api.put('/branding', { company_name: companyName, primary_color: primaryColor, accent_color: accentColor, pwa_short_name: nomeBreve });
      await refresh();
      setMsg('Impostazioni salvate.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('logo', file);
    try {
      await api.post('/branding/logo', form);
      await refresh();
    } catch (e) { setMsg(e.message); }
  };

  const caricaIcona = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setIconaMsg('');
    const form = new FormData();
    form.append('icona', file);
    try {
      await api.post('/branding/icona', form);
      await refresh();
      setIconaMsg('Icona aggiornata.');
    } catch (err) { setIconaMsg(err.message); }
  };
  const rimuoviIcona = async () => {
    setIconaMsg('');
    try {
      await api.del('/branding/icona');
      await refresh();
      setIconaMsg('Icona rimossa.');
    } catch (err) { setIconaMsg(err.message); }
  };

  return (
    <div className="space-y-5">
      <div className="card space-y-3">
        <label className="label">Logo aziendale</label>
        <div className="flex items-center gap-4">
          {branding.logo_path ? (
            <img src={branding.logo_path} alt="Logo" className="max-w-[12rem] max-h-16 object-contain" />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-bg border border-dashed border-border" />
          )}
          <button type="button" className="btn-outline" onClick={() => fileRef.current.click()}>
            <Upload size={16} /> Carica logo
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={uploadLogo} />
        </div>
        <p className="text-xs text-muted">PNG o JPG, max 2 MB.</p>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-display font-semibold text-base">Icona dell'app sul telefono</h2>
          <p className="text-sm text-muted mt-0.5">
            È l'icona che compare quando gli utenti installano l'app e nelle notifiche. Si usa, in ordine: l'icona
            caricata qui, il logo dell'azienda, l'icona di WayMatch.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <img
            src={branding.icona?.personalizzata ? `/api/branding/icona/192.png?v=${branding.icona.versione}` : '/brand/icon-192.png'}
            alt="Anteprima dell'icona dell'app" width="72" height="72" className="rounded-2xl border border-border"
          />
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn-outline" onClick={() => iconaRef.current.click()}>
              <Upload size={16} /> {branding.icona?.caricata ? 'Cambia icona' : 'Carica icona'}
            </button>
            {branding.icona?.caricata && <button type="button" className="btn-ghost" onClick={rimuoviIcona}>Rimuovi icona</button>}
          </div>
          <input ref={iconaRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={caricaIcona} />
        </div>
        <p className="text-sm text-muted">
          {branding.icona?.caricata ? 'Stai usando un\'icona caricata.' : branding.icona?.personalizzata ? 'Stai usando il logo dell\'azienda: se è largo, l\'icona risulta piccola. Per un risultato migliore carica un\'icona quadrata.' : 'Stai usando l\'icona di WayMatch.'}
          {' '}PNG o JPG, meglio quadrata e di almeno 512 px. Sui telefoni l'icona di un'app già installata cambia solo
          reinstallandola (iPhone) o dopo un po' (Android).
        </p>
        {iconaMsg && <p className="text-sm text-muted" role="status">{iconaMsg}</p>}
      </div>

      <form onSubmit={save} className="card space-y-4">
        <div>
          <label htmlFor="adminsettings-0" className="label">Nome azienda</label>
          <input id="adminsettings-0" className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="nome-breve">Nome breve (sotto l'icona sul telefono)</label>
          <input id="nome-breve" className="input" maxLength={12} value={nomeBreve} onChange={(e) => setNomeBreve(e.target.value)} placeholder={(companyName || '').slice(0, 12)} />
          <p className="text-sm text-muted mt-1">Massimo 12 caratteri. Se vuoto, si usano le prime 12 lettere del nome dell'azienda.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="adminsettings-1" className="label">Colore primario</label>
            <div className="flex items-center gap-2">
              <input id="adminsettings-1" aria-label="Scegli il colore primario" type="color" className="w-10 h-10 rounded-lg border border-border" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              <input aria-label="Codice del colore primario" className="input" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="adminsettings-2" className="label">Colore accento</label>
            <div className="flex items-center gap-2">
              <input id="adminsettings-2" aria-label="Scegli il colore accento" type="color" className="w-10 h-10 rounded-lg border border-border" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
              <input aria-label="Codice del colore accento" className="input" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </div>
        </div>
        {(() => {
          const v = controllaColorePrimario(primaryColor);
          return v.valido && !v.ok && (
            <div role="alert" className="rounded-xl border border-accent bg-accent-light text-accent-dark px-3.5 py-3 text-sm">
              <p className="font-medium">Il colore primario ha poco contrasto ({v.contrasto.toFixed(1)}:1).</p>
              <p className="mt-0.5">
                Il testo bianco sui pulsanti e i link in questo colore sarebbero difficili da leggere. Per l'accessibilità
                servono almeno 4,5:1.
              </p>
              <button type="button" className="btn-outline mt-2 !py-1.5" onClick={() => setPrimaryColor(v.proposta)}>
                Usa {v.proposta.toUpperCase()}, la variante più vicina leggibile
              </button>
            </div>
          );
        })()}
        <p className="text-sm text-muted">
          Il logo e i colori dell'azienda si usano nell'app. Lo sfondo e i testi restano quelli di WayMatch; il colore accento si adatta da solo perché i testi restino leggibili.
        </p>
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <button className="btn-primary w-full" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva impostazioni'}</button>
      </form>
    </div>
  );
}

function CalendarioTab() {
  const { refresh } = useBranding();
  const [giorni, setGiorni] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [erroreCarica, setErroreCarica] = useState('');

  const carica = () => {
    setErroreCarica('');
    api.get('/settings').then((d) => setGiorni(d.settings.giorni_lavorativi)).catch((e) => setErroreCarica(e.message || 'Impossibile caricare le impostazioni.'));
  };
  useEffect(() => { carica(); }, []);

  const salva = async (nuovi) => {
    setSaving(true); setMsg('');
    try {
      await api.put('/settings', { giorni_lavorativi: nuovi });
      setGiorni(nuovi);
      await refresh();
      setMsg('Salvato.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cambia = (g) => {
    const nuovi = giorni.includes(g) ? giorni.filter((x) => x !== g) : [...giorni, g].sort((a, b) => a - b);
    if (nuovi.length === 0) { setMsg('Indica almeno un giorno lavorativo.'); return; }
    salva(nuovi);
  };

  if (!giorni) return erroreCarica ? <ErroreConRiprova messaggio={erroreCarica} onRiprova={carica} /> : <div className="card animate-pulse h-40" />;

  return (
    <div className="card space-y-3">
      <h2 className="font-display font-semibold text-sm">Giorni lavorativi</h2>
      <p className="text-xs text-muted">
        Si possono offrire passaggi, e creare turni fissi, solo nei giorni selezionati. Se la tua azienda
        lavora anche la domenica, attivala. <Link to="/informazioni#mobility-manager/impostazioni-generali" className="underline text-primary">Vedi la guida</Link>.
      </p>
      <div className="flex gap-2 flex-wrap">
        {GIORNI_SETTIMANA.map((g) => (
          <button
            type="button" key={g.value} disabled={saving} onClick={() => cambia(g.value)}
            className={`px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
              giorni.includes(g.value) ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted hover:bg-bg'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">Attuali: {descriviGiorni(giorni)}.</p>
      {msg && <p className="text-sm text-muted">{msg}</p>}
    </div>
  );
}

function ValidazioneTab() {
  const [richiedeApprovazione, setRichiedeApprovazione] = useState(false);
  const [caricato, setCaricato] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erroreCarica, setErroreCarica] = useState('');

  const carica = () => {
    setErroreCarica('');
    api.get('/settings').then((d) => {
      setRichiedeApprovazione(!!d.settings.richiede_approvazione_completamento);
      setCaricato(true);
    }).catch((e) => setErroreCarica(e.message || 'Impossibile caricare le impostazioni.'));
  };
  useEffect(() => { carica(); }, []);

  const salva = async (valore) => {
    setSaving(true);
    try {
      await api.put('/settings', { richiede_approvazione_completamento: valore });
      setRichiedeApprovazione(valore);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!caricato) return erroreCarica ? <ErroreConRiprova messaggio={erroreCarica} onRiprova={carica} /> : <div className="card animate-pulse h-40" />;

  return (
    <div className="card space-y-3">
      <h2 className="font-display font-semibold text-sm">Validazione viaggi completati</h2>
      <p className="text-xs text-muted">
        Decidi come gestire la conferma di un viaggio da parte dell'autista, e quindi
        l'assegnazione dei punti.
      </p>
      <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${!richiedeApprovazione ? 'border-primary bg-primary-light' : 'border-border'}`}>
        <input type="radio" className="mt-1" checked={!richiedeApprovazione} onChange={() => salva(false)} disabled={saving} />
        <span className="text-sm">
          <strong className="block">Conferma diretta</strong>
          <span className="text-muted">L'autista conferma da solo, i punti vengono assegnati subito.</span>
        </span>
      </label>
      <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${richiedeApprovazione ? 'border-primary bg-primary-light' : 'border-border'}`}>
        <input type="radio" className="mt-1" checked={richiedeApprovazione} onChange={() => salva(true)} disabled={saving} />
        <span className="text-sm">
          <strong className="block">Richiedi approvazione Mobility Manager</strong>
          <span className="text-muted">Il viaggio va "in approvazione": i punti si assegnano solo dopo il via libera di un Mobility Manager (vedi pagina "Approvazioni").</span>
        </span>
      </label>
    </div>
  );
}

const ALIMENTAZIONE_LABEL = {
  benzina: 'Benzina',
  diesel: 'Diesel',
  gpl: 'GPL',
  metano: 'Metano',
  ibrida: 'Ibrida',
  elettrica: 'Elettrica',
  altro: 'Altro / non specificata',
};

function CostiCo2Tab() {
  const [clusters, setClusters] = useState(null);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState('');
  const [erroreCarica, setErroreCarica] = useState('');
  // Alimentazioni modificate e non ancora rilette, ognuna con la generazione della sua ultima modifica:
  // un nuovo tentativo ripete solo la lettura.
  const daRiallineare = useRef(new Map());
  const generazione = useRef(0);

  // Dopo un salvataggio si riallineano al server solo le bozze delle alimentazioni modificate e non
  // ancora rilette (anche se una lettura precedente è fallita): le modifiche non salvate delle altre restano.
  // Una risposta partita prima di un salvataggio successivo non lo cancella e non sostituisce la bozza:
  // il riallineamento resta in attesa della lettura che segue quel salvataggio.
  // Restituisce true se la lettura è riuscita.
  const load = (aggiornata = null) => {
    setErroreCarica('');
    if (aggiornata) daRiallineare.current.set(aggiornata, ++generazione.current);
    const inAttesa = new Map(daRiallineare.current);
    return api.get('/reports/cost-co2-clusters').then((d) => {
      const riallineate = new Set();
      for (const [chiave, gen] of inAttesa) {
        if (daRiallineare.current.get(chiave) === gen) {
          daRiallineare.current.delete(chiave);
          riallineate.add(chiave);
        }
      }
      setClusters(d.clusters);
      setEdit((prev) => Object.fromEntries(d.clusters.map((c) => [
        c.alimentazione,
        riallineate.has(c.alimentazione) || !prev[c.alimentazione] ? { costo_km_eur: c.costo_km_eur, co2_g_km: c.co2_g_km } : prev[c.alimentazione],
      ])));
      return true;
    }).catch((e) => { setErroreCarica(e.message || 'Impossibile caricare i valori.'); return false; });
  };
  useEffect(() => { load(); }, []);

  const salva = async (chiave) => {
    setSaving(chiave);
    setMsg('');
    try {
      await api.put(`/reports/cost-co2-clusters/${chiave}`, edit[chiave]);
      // Se la rilettura fallisce la modifica è comunque salvata: lo dice l'errore, con "Riprova".
      setMsg((await load(chiave)) ? 'Salvato.' : 'Salvato, ma i valori mostrati non sono aggiornati.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(null);
    }
  };

  const ripristina = async (chiave) => {
    setSaving(chiave);
    setMsg('');
    try {
      await api.del(`/reports/cost-co2-clusters/${chiave}`);
      await load(chiave);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(null);
    }
  };

  const riprova = () => load();
  if (clusters === null) return erroreCarica ? <ErroreConRiprova messaggio={erroreCarica} onRiprova={riprova} /> : <div className="card animate-pulse h-40" />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Valori medi di costo e CO2 per km usati nei report, raggruppati per tipo di alimentazione
        (un'elettrica e un diesel non risparmiano la stessa cosa). Puoi personalizzarli e tornare
        al valore predefinito quando vuoi.
      </p>
      {erroreCarica && <ErroreConRiprova messaggio={erroreCarica} onRiprova={riprova} />}
      {msg && <p className="text-sm text-muted">{msg}</p>}
      <div className="space-y-2">
        {clusters.map((c) => (
          <div key={c.alimentazione} className="card space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{ALIMENTAZIONE_LABEL[c.alimentazione] || c.alimentazione}</p>
              {c.personalizzato && <span className="badge-accent shrink-0">Personalizzato</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`costo-${c.alimentazione}`} className="label">Costo /km (€)</label>
                <input id={`costo-${c.alimentazione}`}
                  type="number" step="0.01" min="0" className="input"
                  value={edit[c.alimentazione]?.costo_km_eur ?? ''}
                  onChange={(e) => setEdit({ ...edit, [c.alimentazione]: { ...edit[c.alimentazione], costo_km_eur: e.target.value } })}
                />
              </div>
              <div>
                <label htmlFor={`co2-${c.alimentazione}`} className="label">CO2 (g/km)</label>
                <input id={`co2-${c.alimentazione}`}
                  type="number" step="1" min="0" className="input"
                  value={edit[c.alimentazione]?.co2_g_km ?? ''}
                  onChange={(e) => setEdit({ ...edit, [c.alimentazione]: { ...edit[c.alimentazione], co2_g_km: e.target.value } })}
                />
              </div>
            </div>
            <p className="text-xs text-muted">Predefinito: € {c.costo_km_eur_default}/km · {c.co2_g_km_default} g/km</p>
            <div className="flex gap-2">
              <button type="button" className="btn-primary !py-1.5 !text-sm flex-1" disabled={saving === c.alimentazione} onClick={() => salva(c.alimentazione)}>
                <Pencil size={13} /> Salva
              </button>
              {c.personalizzato && (
                <button type="button" className="btn-outline !py-1.5 !text-sm" disabled={saving === c.alimentazione} onClick={() => ripristina(c.alimentazione)}>
                  <RotateCcw size={13} /> Ripristina predefinito
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailTab() {
  const [stato, setStato] = useState(null);
  const [inviando, setInviando] = useState(false);
  const [esito, setEsito] = useState(null);
  const [erroreCarica, setErroreCarica] = useState('');

  const carica = () => {
    setErroreCarica('');
    api.get('/email/stato').then(setStato).catch((e) => setErroreCarica(e.message || 'Impossibile caricare lo stato.'));
  };
  useEffect(() => { carica(); }, []);

  const invia = async () => {
    setInviando(true);
    setEsito(null);
    try {
      const res = await api.post('/email/test');
      setEsito({ ok: true, messaggio: `Email di prova inviata a ${res.inviata_a}.` });
    } catch (e) {
      setEsito({ ok: false, messaggio: e.message });
    } finally {
      setInviando(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">
        Le notifiche via email (oltre a in-app e push) si configurano con le variabili SMTP
        nel file <code className="text-xs">.env</code> del server, non da qui — questa scheda
        serve solo a verificare che funzionino.
      </p>

      {erroreCarica && <ErroreConRiprova messaggio={erroreCarica} onRiprova={carica} />}

      {stato === null ? (
        erroreCarica ? null : <div className="card animate-pulse h-32" />
      ) : (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-primary" />
            <h2 className="font-display font-semibold text-sm">Stato configurazione</h2>
          </div>
          {stato.configurato ? (
            <div className="space-y-1.5 text-sm">
              <Riga label="Server SMTP" valore={`${stato.host}${stato.porta ? `:${stato.porta}` : ''}`} />
              <Riga label="Connessione sicura" valore={stato.sicuro ? 'Sì (TLS)' : 'No'} />
              <Riga label="Mittente" valore={stato.mittente || '—'} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              SMTP non configurato: le notifiche restano attive solo in-app e via push.
              Per attivare anche l'email, imposta <code className="text-xs">SMTP_HOST</code>{' '}
              (e le altre variabili <code className="text-xs">SMTP_*</code>) nel file{' '}
              <code className="text-xs">.env</code> sul server e riavvia il container.
            </p>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-display font-semibold text-sm">Invia un'email di prova</h2>
        <p className="text-xs text-muted">Verrà inviata al tuo indirizzo email (quello con cui hai effettuato l'accesso), per verificare che la consegna funzioni davvero.</p>
        <button className="btn-primary w-full" disabled={inviando || !stato?.configurato} onClick={invia}>
          {inviando ? 'Invio...' : <><Send size={15} /> Invia email di prova</>}
        </button>
        {esito && (
          <p className={`text-sm flex items-center gap-1.5 ${esito.ok ? 'text-primary' : 'text-danger'}`}>
            {esito.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {esito.messaggio}
          </p>
        )}
      </div>
    </div>
  );
}

function Riga({ label, valore }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{valore}</span>
    </div>
  );
}
