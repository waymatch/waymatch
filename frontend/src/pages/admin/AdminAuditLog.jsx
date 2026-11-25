import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { ScrollText, FileDown } from 'lucide-react';
import { api, scaricaFile } from '../../api.js';

const ETICHETTE = {
  utente_creato: 'Utente creato',
  utente_modificato: 'Utente modificato',
  utente_disattivato: 'Utente disattivato',
  password_reimpostata: 'Password reimpostata',
  import_csv_utenti: 'Import CSV utenti',
  import_csv_cessati: 'Import CSV cessati',
  sede_creata: 'Sede creata',
  sede_modificata: 'Sede modificata',
  sede_eliminata: 'Sede eliminata',
  branding_modificato: 'Branding modificato',
  logo_rimosso: 'Logo rimosso',
  esci_da_tutti_i_dispositivi: 'Uscita da tutti i dispositivi',
  icona_app_aggiornata: 'Icona dell\'app aggiornata',
  icona_app_rimossa: 'Icona dell\'app rimossa',
  logo_aggiornato: 'Logo aggiornato',
  impostazioni_modificate: 'Impostazioni modificate',
  gamification_attivata: 'Gamification attivata',
  gamification_disattivata: 'Gamification spenta',
  punteggi_azzerati: 'Punteggi azzerati',
  foto_profilo_caricata: 'Foto del profilo caricata',
  foto_profilo_rimossa: 'Foto del profilo rimossa',
  foto_profilo_rimossa_mm: 'Foto del profilo rimossa (MM)',
  riscatti_esportati: 'Riscatti esportati',
  premio_creato: 'Premio creato',
  premio_modificato: 'Premio modificato',
  contest_creato: 'Contest creato',
  regola_punteggio_modificata: 'Regola punteggio modificata',
  punti_manuali_assegnati: 'Punti manuali assegnati',
  passaggio_annullato_da_mm: 'Passaggio annullato (da MM)',
  passaggio_offerto: 'Passaggio offerto',
  passaggio_modificato: 'Passaggio modificato',
  passaggio_annullato: 'Passaggio annullato',
  richiesta_passaggio: 'Richiesta di passaggio',
  iscrizione_lista_attesa: 'Iscrizione in lista d\'attesa',
  richiesta_confermata: 'Richiesta confermata',
  richiesta_rifiutata: 'Richiesta rifiutata',
  richiesta_annullata: 'Richiesta annullata dal passeggero',
  check_in_modificato: 'Check-in modificato',
  completamento_richiesto: 'Completamento richiesto (in approvazione)',
  viaggio_completato: 'Viaggio completato',
  completamento_approvato: 'Completamento approvato (MM)',
  completamento_rifiutato_mm: 'Completamento rifiutato (MM)',
  riscatto_richiesto: 'Riscatto premio richiesto',
  riscatto_approvato_mm: 'Riscatto approvato (MM)',
  riscatto_rifiutato_mm: 'Riscatto rifiutato (MM)',
  riscatto_consegnato_mm: 'Riscatto consegnato (MM)',
  account_bloccato: 'Account bloccato (troppi tentativi)',
  turno_fisso_creato: 'Turno fisso creato',
  turno_fisso_sospeso: 'Turno fisso sospeso',
  turno_fisso_riattivato: 'Turno fisso riattivato',
  turno_fisso_eliminato: 'Turno fisso eliminato',
  turno_fisso_data_saltata: 'Turno fisso: data saltata',
  turno_fisso_data_ripristinata: 'Turno fisso: data ripristinata',
  dati_personali_esportati: 'Dati personali esportati',
  richiesta_cancellazione_creata: 'Richiesta cancellazione account creata',
  richiesta_cancellazione_completata: 'Richiesta cancellazione account completata',
  richiesta_cancellazione_rifiutata: 'Richiesta cancellazione account rifiutata',
  passaggio_ritardo_segnalato: 'Ritardo segnalato ai passeggeri',
  passeggero_ritardo_segnalato: 'Ritardo segnalato dal passeggero',
  password_reset_richiesta_creata: 'Richiesta reset password creata',
  password_reset_generata_mm: 'Password temporanea generata (MM)',
  voucher_template_creato: 'Template voucher creato',
  documento_creato: 'Documento creato',
  documento_modificato: 'Documento modificato',
  documento_disattivato: 'Documento disattivato',
  documento_accettato: 'Documento accettato',
  cluster_costo_co2_modificato: 'Costi e CO2 modificati',
  cluster_costo_co2_ripristinato: 'Costi e CO2 riportati ai valori predefiniti',
};

const FILTRI_CATEGORIA = [
  { value: '', label: 'Tutto' },
  { value: 'gestione', label: 'Mobility Manager' },
  { value: 'utente', label: 'Utenti' },
];

// Aree del log (le stesse del server, routes/audit_log.js).
const AREE = {
  utenti: 'Utenti e accessi',
  passaggi: 'Passaggi e turni',
  punti: 'Punti',
  premi: 'Premi e contest',
  documenti: 'Documenti',
  impostazioni: 'Impostazioni e sedi',
  privacy: 'Privacy',
};

export default function AdminAuditLog() {
  const [log, setLog] = useState(null);
  const [categoria, setCategoria] = useState('');
  const [azione, setAzione] = useState('');
  const [userId, setUserId] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [area, setArea] = useState('');
  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  const [testo, setTesto] = useState('');
  const [cerca, setCerca] = useState(''); // il testo, applicato dopo una breve pausa di digitazione
  const [sedi, setSedi] = useState([]);
  const [ritenzione, setRitenzione] = useState(null);
  const [tipiEvento, setTipiEvento] = useState([]);
  const [utenti, setUtenti] = useState([]);
  const [error, setError] = useState('');           // caricamento del registro
  const [erroreExport, setErroreExport] = useState('');
  const [erroreFiltri, setErroreFiltri] = useState('');
  const [esportando, setEsportando] = useState(false);
  const richiesta = useRef(0); // identifica l'ultimo caricamento: le risposte di filtri superati si ignorano

  const caricaFiltri = useCallback(() => {
    setErroreFiltri('');
    const errore = (e) => setErroreFiltri(e.message || 'Impossibile caricare i filtri.');
    api.get('/audit-log/tipi-evento').then((d) => setTipiEvento(d.tipi)).catch(errore);
    api.get('/users').then((d) => setUtenti(d.users)).catch(errore);
    api.get('/sedi').then((d) => setSedi(d.sedi)).catch(errore);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setCerca(testo.trim()), 350);
    return () => clearTimeout(t);
  }, [testo]);
  useEffect(() => { caricaFiltri(); }, [caricaFiltri]);

  const filtriAttuali = useCallback(() => {
    const params = new URLSearchParams();
    if (categoria) params.set('categoria', categoria);
    if (azione) params.set('azione', azione);
    if (userId) params.set('user_id', userId);
    if (sedeId) params.set('sede_id', sedeId);
    if (area) params.set('area', area);
    // Inizio e fine del giorno nel fuso di chi consulta, come istanti: il server confronta in UTC.
    if (dal) params.set('dal', new Date(`${dal}T00:00:00`).toISOString());
    if (al) params.set('al', new Date(`${al}T23:59:59.999`).toISOString());
    if (cerca) params.set('q', cerca);
    return params;
  }, [categoria, azione, userId, sedeId, area, dal, al, cerca]);

  const load = useCallback(() => {
    const mia = ++richiesta.current;
    setError('');
    api.get(`/audit-log?${filtriAttuali().toString()}`)
      .then((d) => { if (mia === richiesta.current) { setLog(d.log); setRitenzione(d.ritenzione_mesi); setError(''); } })
      .catch((e) => { if (mia === richiesta.current) setError(e.message); });
  }, [filtriAttuali]);

  useEffect(() => { load(); }, [load]);

  const esporta = async () => {
    setEsportando(true);
    setErroreExport('');
    try {
      // La ricerca com'è scritta adesso, anche se l'attesa della digitazione non è ancora finita.
      const params = filtriAttuali();
      if (testo.trim()) params.set('q', testo.trim()); else params.delete('q');
      await scaricaFile(`/audit-log/export/xlsx?${params.toString()}`, 'log-attivita.xlsx');
    } catch (e) {
      setErroreExport(e.message);
    } finally {
      setEsportando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl">Log attività</h1>
          <p className="text-muted text-sm mt-0.5">
            Azioni di gestione e attività significative degli utenti (non ogni singolo click).
            {ritenzione ? `Conservato per ${ritenzione} mesi, poi archiviato automaticamente.` : ''}
          </p>
        </div>
        <button className="btn-outline !text-xs" disabled={esportando} onClick={esporta}>
          <FileDown size={14} /> {esportando ? 'Esporto...' : 'Esporta Excel'}
        </button>
      </div>

      <div role="group" aria-label="Categoria delle attività" className="flex gap-2 bg-bg p-1 rounded-xl w-fit border border-border">
        {FILTRI_CATEGORIA.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={categoria === f.value}
            onClick={() => setCategoria(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              categoria === f.value ? 'bg-surface shadow-sm text-primary' : 'text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <select aria-label="Tipo di evento" className="input flex-1 min-w-[160px]" value={azione} onChange={(e) => setAzione(e.target.value)}>
          <option value="">Tutti i tipi di evento</option>
          {tipiEvento.map((t) => <option key={t} value={t}>{ETICHETTE[t] || t}</option>)}
        </select>
        <select aria-label="Utente" className="input flex-1 min-w-[160px]" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Tutti gli utenti</option>
          {utenti.map((u) => <option key={u.id} value={u.id}>{u.nome} {u.cognome}</option>)}
        </select>
        <select aria-label="Area" className="input flex-1 min-w-[160px]" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Tutte le aree</option>
          {Object.entries(AREE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Sede di chi ha agito" className="input flex-1 min-w-[160px]" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
          <option value="">Tutte le sedi</option>
          {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-muted">Dal
          <input type="date" className="input mt-1" value={dal} max={al || undefined} onChange={(e) => setDal(e.target.value)} />
        </label>
        <label className="text-xs text-muted">Al
          <input type="date" className="input mt-1" value={al} min={dal || undefined} onChange={(e) => setAl(e.target.value)} />
        </label>
        <input type="search" aria-label="Cerca nel log" placeholder="Cerca nei dettagli o per nome…" className="input flex-1 min-w-[200px]"
          value={testo} onChange={(e) => setTesto(e.target.value)} />
      </div>

      {erroreFiltri && <ErroreConRiprova messaggio={`Filtri non disponibili: ${erroreFiltri}`} onRiprova={caricaFiltri} />}
      {error && <ErroreConRiprova messaggio={error} onRiprova={load} />}
      {erroreExport && <ErrorBanner message={`Esportazione non riuscita: ${erroreExport}`} />}

      {log === null ? (
        error ? null : <div className="card animate-pulse h-40" />
      ) : log.length === 0 ? (
        <div className="card text-center py-10 text-sm text-muted">Nessuna attività corrisponde ai filtri.</div>
      ) : (
        <div className="card p-0 divide-y divide-border">
          {log.map((l) => (
            <div key={l.id} className="px-4 py-3 flex items-start gap-3">
              <ScrollText size={15} className="text-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{ETICHETTE[l.azione] || l.azione}</p>
                    <span className={`badge ${l.categoria === 'gestione' ? 'bg-accent-light text-accent-dark' : 'badge-primary'}`}>
                      {l.categoria === 'gestione' ? 'MM' : 'Utente'}
                    </span>
                  </div>
                  <p className="text-xs text-muted shrink-0">{new Date(l.created_at.replace(' ', 'T') + 'Z').toLocaleString('it-IT')}</p>
                </div>
                {l.dettagli && <p className="text-xs text-muted mt-0.5">{l.dettagli}</p>}
                <p className="text-xs text-muted mt-0.5">
                  {l.nome ? `${l.nome} ${l.cognome}` : 'Utente eliminato'}{l.sede_nome ? ` · ${l.sede_nome}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
