import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import { Plus, Key, Ban, CheckCircle2, Upload, FileText, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { api } from '../../api.js';
import { REQUISITI_PASSWORD } from '../../passwordPolicy.js';

const RUOLI = [
  { value: 'utente', label: 'Utente' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'mobility_manager', label: 'Mobility Manager' },
];

// "In attesa di attivazione": account creato ma la persona non ha ancora fatto il primo
// accesso con cambio password obbligatorio (vedi ForcedPasswordChangeGate lato frontend).
function statoUtente(u) {
  if (!u.attivo) return 'Disattivato';
  if (u.password_da_cambiare) return 'In attesa di attivazione';
  return 'Attivo';
}
const STATO_COLORE = {
  Attivo: 'bg-primary-light text-primary-dark',
  'In attesa di attivazione': 'bg-accent-light text-accent-dark',
  Disattivato: 'bg-border text-muted',
};

function Th({ label, campo, sort, onSort }) {
  const attivo = sort.campo === campo;
  return (
    <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-ink" onClick={() => onSort(campo)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {attivo ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />}
      </span>
    </th>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [sedi, setSedi] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [ricerca, setRicerca] = useState('');
  const [filtroSede, setFiltroSede] = useState('');
  const [sort, setSort] = useState({ campo: 'cognome', dir: 'asc' });

  const load = useCallback(() => {
    api.get('/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
    api.get('/sedi').then((d) => setSedi(d.sedi));
  }, []);
  useEffect(() => { load(); }, [load]);

  const cambiaRuolo = async (u, ruolo) => {
    try {
      await api.put(`/users/${u.id}`, { ...u, ruolo });
      load();
    } catch (e) { alert(e.message); }
  };
  const cambiaSede = async (u, sede_id) => {
    try {
      await api.put(`/users/${u.id}`, { ...u, sede_id: sede_id || null });
      load();
    } catch (e) { alert(e.message); }
  };
  const toggleAttivo = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { ...u, attivo: u.attivo ? 0 : 1 });
      load();
    } catch (e) { alert(e.message); }
  };
  const resetPassword = async (u) => {
    const nuova = prompt(`Nuova password per ${u.nome} ${u.cognome} (min. 8 caratteri):`);
    if (!nuova) return;
    try {
      await api.post(`/users/${u.id}/reset-password`, { password_nuova: nuova });
      alert('Password aggiornata.');
    } catch (e) { alert(e.message); }
  };

  const usersFiltrati = (users || []).filter((u) => {
    const testo = `${u.nome} ${u.cognome} ${u.email}`.toLowerCase();
    const matchTesto = !ricerca || testo.includes(ricerca.toLowerCase());
    const matchSede = !filtroSede || String(u.sede_id) === filtroSede;
    return matchTesto && matchSede;
  });

  const toggleSort = (campo) => {
    setSort((s) => (s.campo === campo ? { campo, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' }));
  };

  const valoreOrdinamento = (u, campo) => {
    if (campo === 'punti') return u.punti;
    if (campo === 'sede') return u.sede_nome || '';
    if (campo === 'stato') return statoUtente(u);
    return (u[campo] || '').toString();
  };

  const usersOrdinati = [...usersFiltrati].sort((a, b) => {
    const va = valoreOrdinamento(a, sort.campo);
    const vb = valoreOrdinamento(b, sort.campo);
    if (typeof va === 'number' && typeof vb === 'number') return sort.dir === 'asc' ? va - vb : vb - va;
    const cmp = String(va).localeCompare(String(vb), 'it');
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display font-bold text-2xl">Utenti</h1>
          <p className="text-muted text-sm mt-0.5">
            {usersFiltrati.length} di {users?.length ?? '...'} account
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => { setShowImport((v) => !v); setShowForm(false); }}>
            <Upload size={16} /> Importa CSV
          </button>
          <button className="btn-primary" onClick={() => { setShowForm((v) => !v); setShowImport(false); }}>
            <Plus size={16} /> Nuovo utente
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          className="input flex-1 min-w-[180px]"
          placeholder="Cerca per nome, cognome o email..."
          value={ricerca}
          onChange={(e) => setRicerca(e.target.value)}
        />
        <select aria-label="Filtra per sede" className="input !w-auto" value={filtroSede} onChange={(e) => setFiltroSede(e.target.value)}>
          <option value="">Tutte le sedi</option>
          {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </div>

      {showImport && <ImportCsvForm onDone={() => { setShowImport(false); load(); }} />}
      {showForm && <NewUserForm sedi={sedi} onCreated={() => { setShowForm(false); load(); }} />}
      {error && <ErrorBanner message={error} />}

      {users === null ? (
        <div className="card animate-pulse h-40" />
      ) : usersFiltrati.length === 0 ? (
        <div className="card text-center py-10 text-sm text-muted">Nessun utente corrisponde ai filtri.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-border">
                <Th label="Nome" campo="nome" sort={sort} onSort={toggleSort} />
                <Th label="Cognome" campo="cognome" sort={sort} onSort={toggleSort} />
                <Th label="Email" campo="email" sort={sort} onSort={toggleSort} />
                <Th label="Sede" campo="sede" sort={sort} onSort={toggleSort} />
                <Th label="Ruolo" campo="ruolo" sort={sort} onSort={toggleSort} />
                <Th label="Punti" campo="punti" sort={sort} onSort={toggleSort} />
                <Th label="Stato" campo="stato" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-3 font-medium"><span className="sr-only">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              {usersOrdinati.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{u.nome}</td>
                  <td className="px-4 py-3 font-medium">{u.cognome}</td>
                  <td className="px-4 py-3 text-xs text-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <select aria-label={`Sede di ${u.nome} ${u.cognome}`} className="input !py-1.5 !text-sm" value={u.sede_id || ''} onChange={(e) => cambiaSede(u, e.target.value)}>
                      <option value="">—</option>
                      {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select aria-label={`Ruolo di ${u.nome} ${u.cognome}`} className="input !py-1.5 !text-sm min-w-[10rem]" value={u.ruolo} onChange={(e) => cambiaRuolo(u, e.target.value)}>
                      {RUOLI.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">{u.punti}</td>
                  <td className="px-4 py-3">
                    <span className={`badge whitespace-nowrap ${STATO_COLORE[statoUtente(u)]}`}>{statoUtente(u)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button className="p-1.5 text-muted hover:text-primary" title="Reset password" aria-label="Reset password" onClick={() => resetPassword(u)}>
                        <Key size={15} />
                      </button>
                      <button
                        className={`p-1.5 ${u.attivo ? 'text-muted hover:text-danger' : 'text-primary'}`}
                        title={u.attivo ? 'Disattiva' : 'Riattiva'} aria-label={u.attivo ? 'Disattiva' : 'Riattiva'}
                        onClick={() => toggleAttivo(u)}
                      >
                        {u.attivo ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImportCsvForm({ onDone }) {
  const fileRef = useRef();
  const [risultato, setRisultato] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const importa = async () => {
    const file = fileRef.current.files[0];
    if (!file) { setError('Seleziona un file CSV.'); return; }
    setLoading(true);
    setError('');
    setRisultato(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/users/import-csv', form);
      setRisultato(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2">
        <FileText size={16} className="text-primary mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">Due modalità, in base al nome del file</p>
          <p className="text-xs text-muted mt-1">
            <strong>File normale</strong> — crea i nuovi utenti e aggiorna nome/cognome/ruolo/sede di
            quelli già esistenti (la password non viene mai toccata in questo caso):
          </p>
          <code className="text-xs text-muted block mt-1">Nome,Cognome,email,passtemporanea,ruolo,sede</code>
          <p className="text-xs text-muted mt-1">
            Ruolo e sede sono facoltativi. Il nome sede deve corrispondere esattamente a una
            sede già esistente, altrimenti viene segnalato ma la riga viene comunque importata.
            La password provvisoria deve rispettare gli stessi requisiti di ovunque nell'app:
            {' '}{REQUISITI_PASSWORD.toLowerCase()} Le righe con password non conforme vengono
            segnalate come errore e l'utente non viene creato.
          </p>
          <p className="text-xs text-muted mt-2">
            <strong>File "cessati"</strong> — se il nome del file contiene la parola "cessati" (es.
            <code className="mx-1">cessati_settembre.csv</code>), ogni riga con
            un'email valida viene <strong>disattivata</strong> (basta una colonna email, il resto
            delle colonne viene ignorato). Nessuna disattivazione avviene mai
            in automatico al di fuori di questa modalità esplicita.
          </p>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {risultato && (
        <div className="rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5 space-y-1">
          {risultato.creati !== undefined && <p>{risultato.creati} creati, {risultato.aggiornati} aggiornati.</p>}
          {risultato.disattivati !== undefined && <p>{risultato.disattivati} utenti disattivati.</p>}
          {risultato.errori.length > 0 && (
            <ul className="list-disc list-inside text-xs">
              {risultato.errori.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="input" />
      <button type="button" className="btn-primary w-full" disabled={loading} onClick={importa}>
        {loading ? 'Importazione...' : 'Importa'}
      </button>
      {risultato && (
        <button type="button" className="btn-ghost w-full" onClick={onDone}>Chiudi</button>
      )}
    </div>
  );
}

function NewUserForm({ sedi, onCreated }) {
  const [form, setForm] = useState({ nome: '', cognome: '', email: '', password: '', ruolo: 'utente', sede_id: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/users', form);
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-2 gap-3">
        <input required placeholder="Nome" className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <input required placeholder="Cognome" className="input" value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} />
      </div>
      <input required type="email" placeholder="Email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <div>
        <input required type="password" placeholder="Password provvisoria" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <p className="text-xs text-muted mt-1">{REQUISITI_PASSWORD}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select className="input" value={form.ruolo} onChange={(e) => setForm({ ...form, ruolo: e.target.value })}>
          {RUOLI.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select className="input" value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })}>
          <option value="">Sede...</option>
          {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </div>
      <button className="btn-primary w-full" disabled={saving}>{saving ? 'Creazione...' : 'Crea utente'}</button>
    </form>
  );
}
