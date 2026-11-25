import React, { useEffect, useState } from 'react';
import { BookOpen, Sparkles, Info, Activity, ExternalLink, Heart, Scale, Github, ShieldAlert, Bug } from 'lucide-react';
import { api } from '../api.js';
import { PROGETTO } from '../progetto.js';
import { Lockup } from '../components/MarcaWayMatch.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import GuidaMarkdown, { titoli } from '../components/GuidaMarkdown.jsx';
import Schede from '../components/Schede.jsx';
// Le guide sono i file di docs/ del repository, incorporati al momento della build: la guida che
// leggi è sempre quella della versione dell'app che stai usando.
import guidaUtente from '../../../docs/guida-utente.md?raw';
import guidaMm from '../../../docs/guida-mobility-manager.md?raw';
import novita from '../../../docs/novita.md?raw';

const immagini = Object.fromEntries(
  Object.entries(import.meta.glob('../../../docs/img/*.png', { eager: true, query: '?url', import: 'default' }))
    .map(([percorso, url]) => [percorso.replace(/^.*\//, ''), url])
);

export default function Informazioni() {
  const { user } = useAuth();
  const èMm = user?.ruolo === 'mobility_manager';
  const sezioni = [
    { id: 'utente', nome: 'Guida utenti', testo: guidaUtente, icona: BookOpen },
    ...(èMm ? [{ id: 'mobility-manager', nome: 'Guida mobility manager', testo: guidaMm, icona: BookOpen }] : []),
    { id: 'novita', nome: 'Novità e storia', testo: novita, icona: Sparkles },
    ...(èMm ? [{ id: 'sistema', nome: 'Sistema', icona: Activity }] : []),
    { id: 'progetto', nome: 'Il progetto', icona: Info },
  ];
  const [attiva, setAttiva] = useState(() => {
    const dallUrl = window.location.hash.replace('#', '').split('/')[0];
    return sezioni.some((s) => s.id === dallUrl) ? dallUrl : 'utente';
  });
  const sezione = sezioni.find((s) => s.id === attiva) || sezioni[0];
  const indice = sezione.testo ? titoli(sezione.testo) : [];

  // Link diretti del tipo /guida#mobility-manager/impostazioni-generali: sezione e paragrafo.
  // Vale all'apertura, al cambio di scheda e quando l'indirizzo cambia senza ricaricare la pagina.
  useEffect(() => {
    const vaiAllAncora = () => {
      const [sez, ancora] = window.location.hash.replace('#', '').split('/');
      if (sez && sezioni.some((x) => x.id === sez)) setAttiva(sez);
      if (ancora) setTimeout(() => document.getElementById(ancora)?.scrollIntoView({ block: 'start' }), 80);
    };
    vaiAllAncora();
    window.addEventListener('hashchange', vaiAllAncora);
    return () => window.removeEventListener('hashchange', vaiAllAncora);
  }, [attiva]); // eslint-disable-line react-hooks/exhaustive-deps

  const vaiA = (id) => {
    window.history.replaceState(null, '', `#${sezione.id}/${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const cambiaSezione = (id) => {
    setAttiva(id);
    window.history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0 });
  };

  // Indice: elenco verticale accanto alla guida su schermo largo, tendina "Vai a…" su telefono.
  const indiceLaterale = indice.length > 1 && (
    <nav className="card" aria-label="Indice">
      <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">In questa pagina</p>
      <ul className="space-y-0.5">
        {indice.map((t) => (
          <li key={t.id}>
            <a href={`#${sezione.id}/${t.id}`} onClick={(e) => { e.preventDefault(); vaiA(t.id); }}
              className="block rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-bg hover:text-primary">
              {t.testo}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl">Informazioni</h1>
          <p className="text-muted text-sm mt-0.5">Guida, novità e informazioni su WayMatch, aggiornate alla versione che stai usando.</p>
        </div>
        <span className="badge bg-primary-light text-primary-dark shrink-0" title="Versione dell'app">Versione {__APP_VERSION__}</span>
      </div>

      <Schede
        schede={sezioni.map((x) => ({ id: x.id, label: x.nome, icon: x.icona }))}
        attiva={attiva}
        onChange={cambiaSezione}
        sotto={indiceLaterale}
      >
        {indice.length > 1 && (
          <label className="lg:hidden block">
            <span className="sr-only">Vai a</span>
            <select className="input" value="" onChange={(e) => e.target.value && vaiA(e.target.value)}>
              <option value="">Vai a…</option>
              {indice.map((t) => <option key={t.id} value={t.id}>{t.testo}</option>)}
            </select>
          </label>
        )}
        {sezione.id === 'sistema' ? <Sistema />
          : sezione.id === 'progetto' ? <Progetto />
          : (
            <div className="card">
              <GuidaMarkdown testo={sezione.testo} immagini={immagini} />
            </div>
          )}
      </Schede>
    </div>
  );
}

const durata = (secondi) => {
  const g = Math.floor(secondi / 86400);
  const o = Math.floor((secondi % 86400) / 3600);
  const m = Math.floor((secondi % 3600) / 60);
  return g ? `${g} g ${o} h` : o ? `${o} h ${m} min` : `${m} min`;
};

function Riga({ nome, valore }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 border-b border-border last:border-0 text-sm">
      <span className="text-muted">{nome}</span>
      <span className="font-medium text-right">{valore}</span>
    </div>
  );
}

function Stato({ attivo, si = 'attivo', no = 'non attivo' }) {
  return <span className={`badge ${attivo ? 'bg-primary-light text-primary-dark' : 'bg-bg text-muted border border-border'}`}>{attivo ? si : no}</span>;
}

// Stato dell'installazione: solo per il mobility manager, nessun segreto.
function Sistema() {
  const [d, setD] = useState(null);
  const [errore, setErrore] = useState('');
  useEffect(() => { api.get('/sistema').then(setD).catch((e) => setErrore(e.message)); }, []);
  if (errore) return <div className="card text-sm text-danger">{errore}</div>;
  if (!d) return <div className="card animate-pulse h-40" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <div className="card">
        <h2 className="font-display font-semibold text-base mb-1">Piattaforma</h2>
        <Riga nome="Versione" valore={`${d.versione}`} />
        <Riga nome="Aggiornamenti" valore={<StatoAggiornamenti a={d.aggiornamenti} />} />
        <Riga nome="Attiva da" valore={durata(d.ambiente.attivo_da_secondi)} />
        <Riga nome="Node" valore={d.ambiente.node} />
        <Riga nome="Sistema" valore={d.ambiente.sistema} />
        <Riga nome="Database" valore={<Stato attivo={d.database.cifrato} si="cifrato" no="non cifrato" />} />
      </div>
      <div className="card">
        <h2 className="font-display font-semibold text-base mb-1">Servizi</h2>
        <Riga nome="Email (SMTP)" valore={<Stato attivo={d.integrazioni.email} si="attive" no="non configurate" />} />
        <Riga nome="Notifiche push" valore={<Stato attivo={d.integrazioni.notifiche_push} />} />
        <Riga nome="Mappa" valore={`${d.mappa.provider}${d.mappa.personalizzato ? '' : ' (predefinito)'}`} />
        <Riga nome="Giorni lavorativi" valore={d.calendario.giorni_lavorativi.join(', ')} />
        <Riga nome="Validazione viaggi" valore={<Stato attivo={d.validazione_viaggi} si="richiesta" no="diretta" />} />
        <Riga nome="Conservazione storico" valore={`${d.ritenzione_storico_mesi} mesi`} />
      </div>
      <div className="card lg:col-span-2">
        <h2 className="font-display font-semibold text-base mb-1">Numeri</h2>
        <Riga nome="Utenti attivi" valore={d.numeri.utenti_attivi} />
        <Riga nome="Mobility manager attivi" valore={d.numeri.mobility_manager_attivi} />
        <Riga nome="Sedi" valore={d.numeri.sedi} />
      </div>
    </div>
  );
}

// Esito dell'ultimo controllo giornaliero delle versioni pubblicate (server: utils/aggiornamenti.js).
function StatoAggiornamenti({ a }) {
  if (!a?.attivo) return 'controllo disattivato';
  if (a.disponibile) {
    return (
      <a href={a.url || `${PROGETTO.repository}/releases`} target="_blank" rel="noopener noreferrer" className="underline text-primary font-medium">
        disponibile la {a.ultima}
      </a>
    );
  }
  return a.controllato_il ? 'versione più recente' : 'non ancora controllati';
}

function LinkEsterno({ href, icona: Icona, titolo, descrizione }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-xl border border-border p-3.5 hover:bg-bg transition-colors">
      <Icona size={18} className="text-primary mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">{titolo} <ExternalLink size={12} className="text-muted" /></span>
        <span className="block text-sm text-muted">{descrizione}</span>
      </span>
    </a>
  );
}

// Identità del progetto, crediti, licenza e modi per contribuire o sostenerlo.
function Progetto() {
  return (
    <div className="space-y-6">
      <div className="card">
        <Lockup larghezza={260} />
        <p className="font-display font-semibold text-lg mt-3">{PROGETTO.claim}</p>
        <p className="text-sm text-muted mt-1">{PROGETTO.descrizione}</p>
        <p className="text-sm text-muted mt-3">
          Il logo e i colori che vedi nell'intestazione sono quelli della tua azienda, impostati dal mobility
          manager; il servizio funziona con WayMatch.
        </p>
        <p className="text-sm mt-3">Versione <strong>{__APP_VERSION__}</strong> · creato da <strong>{PROGETTO.autore}</strong></p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LinkEsterno href={PROGETTO.repository} icona={Github} titolo="Codice sorgente" descrizione="Il progetto su GitHub: codice, documentazione e storico delle modifiche." />
        <LinkEsterno href={PROGETTO.segnalazioni} icona={Bug} titolo="Segnala un problema o proponi un'idea" descrizione="Per errori e miglioramenti." />
        <LinkEsterno href={PROGETTO.sicurezza} icona={ShieldAlert} titolo="Segnala una vulnerabilità" descrizione="In privato, senza renderla pubblica." />
        <LinkEsterno href={PROGETTO.licenzaUrl} icona={Scale} titolo={`Licenza ${PROGETTO.licenza}`} descrizione="Uso interno gratuito per le aziende; vietata la rivendita." />
      </div>
      <div className="card flex items-start gap-3">
        <Heart size={18} className="text-accent-dark mt-0.5 shrink-0" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-medium">WayMatch è gratuito. Fai del bene a tua volta.</p>
          <p className="text-muted mt-0.5">
            Chi l'ha scritto lo ha fatto per voi e chiede una cosa sola: fate qualcosa per qualcun altro, a vostra scelta.
            Non è una condizione della licenza, è un invito.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <li><a href={PROGETTO.prezzo} target="_blank" rel="noopener noreferrer" className="underline text-primary">Scopri come</a></li>
            <li><a href={PROGETTO.adozioni} target="_blank" rel="noopener noreferrer" className="underline text-primary">Aziende che hanno adottato WayMatch</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
