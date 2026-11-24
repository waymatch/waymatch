import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { dataLocale } from '../../dateTimeUtils.js';
import { Plus, Trash2, Trophy } from 'lucide-react';
import { api } from '../../api.js';

const METRICHE = [
  { value: 'punti', label: 'Punti totali' },
  { value: 'passaggi_offerti', label: 'Passaggi offerti' },
  { value: 'passaggi_presi', label: 'Passaggi presi come passeggero' },
];

export default function AdminContests() {
  const [contests, setContests] = useState(null);
  const [sedi, setSedi] = useState([]);
  const [form, setForm] = useState({ nome: '', descrizione: '', metrica: 'punti', data_inizio: '', data_fine: '', sede_id: '' });
  const [error, setError] = useState('');
  const [classificaAperta, setClassificaAperta] = useState(null);
  const [classifica, setClassifica] = useState(null);
  const [erroreCarica, setErroreCarica] = useState('');
  const [erroreSedi, setErroreSedi] = useState('');
  const [saving, setSaving] = useState(false);
  const inCreazione = useRef(false); // blocca un secondo invio prima del rendering

  const load = useCallback(() => {
    setErroreCarica(''); setErroreSedi('');
    api.get('/contests').then((d) => setContests(d.contests)).catch((e) => setErroreCarica(e.message || 'Impossibile caricare i contest.'));
    api.get('/sedi').then((d) => setSedi(d.sedi)).catch((e) => setErroreSedi(e.message || 'Impossibile caricare le sedi.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (inCreazione.current) return; // un doppio invio creerebbe due contest uguali
    setError('');
    if (form.data_fine < form.data_inizio) { setError('La data di fine non può precedere quella di inizio.'); return; }
    inCreazione.current = true;
    setSaving(true);
    try {
      await api.post('/contests', form);
      setForm({ nome: '', descrizione: '', metrica: 'punti', data_inizio: '', data_fine: '', sede_id: '' });
      load();
    } catch (e) { setError(e.message); }
    finally { inCreazione.current = false; setSaving(false); }
  };
  const remove = async (id) => {
    try {
      await api.del(`/contests/${id}`);
      load();
    } catch (e) { alert(e.message); }
  };
  const vediClassifica = async (id) => {
    if (classificaAperta === id) { setClassificaAperta(null); return; }
    try {
      const d = await api.get(`/contests/${id}/classifica`);
      setClassifica(d.classifica);
      setClassificaAperta(id);
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Contest gamification</h1>
        <p className="text-muted text-sm mt-0.5">Crea sfide a tempo per stimolare il carpooling.</p>
      </div>

      <form onSubmit={add} className="card space-y-3">
        {error && <ErrorBanner message={error} />}
        <input required placeholder="Nome contest" className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <input placeholder="Descrizione (opzionale)" className="input" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} />
        <select aria-label="Metrica della gara" className="input" value={form.metrica} onChange={(e) => setForm({ ...form, metrica: e.target.value })}>
          {METRICHE.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select aria-label="Sede" className="input" value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })}>
          <option value="">Tutte le sedi</option>
          {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        {erroreSedi && (
          <div className="flex items-center gap-2 text-xs text-danger" role="alert">
            <span>{erroreSedi}</span>
            <button type="button" className="underline text-primary" onClick={load}>Riprova</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="admincontests-0" className="label">Inizio</label>
            <input id="admincontests-0" required type="date" className="input" value={form.data_inizio} onChange={(e) => setForm({ ...form, data_inizio: e.target.value })} />
          </div>
          <div>
            <label htmlFor="admincontests-1" className="label">Fine</label>
            <input id="admincontests-1" required type="date" min={form.data_inizio || undefined} className="input" value={form.data_fine} onChange={(e) => setForm({ ...form, data_fine: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={saving}><Plus size={16} /> {saving ? 'Creazione...' : 'Crea contest'}</button>
      </form>

      {erroreCarica && <ErroreConRiprova messaggio={erroreCarica} onRiprova={load} />}

      <div className="grid gap-3 lg:grid-cols-2">
        {contests === null ? (erroreCarica ? null : <div className="card animate-pulse h-20" />) : contests.map((c) => (
          <div key={c.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-sm flex items-center gap-1.5"><Trophy size={14} className="text-accent-dark" /> {c.nome}</p>
                <p className="text-xs text-muted mt-1">
                  {dataLocale(c.data_inizio).toLocaleDateString('it-IT')} – {dataLocale(c.data_fine).toLocaleDateString('it-IT')}
                  {' · '}{METRICHE.find((m) => m.value === c.metrica)?.label}
                  {c.sede_nome ? ` · ${c.sede_nome}` : ''}
                </p>
              </div>
              <button type="button" className="p-2 text-muted hover:text-danger" aria-label={`Elimina il contest ${c.nome}`} title="Elimina" onClick={() => remove(c.id)}><Trash2 size={16} aria-hidden="true" /></button>
            </div>
            <button className="btn-ghost text-primary mt-2 !px-0" onClick={() => vediClassifica(c.id)}>
              {classificaAperta === c.id ? 'Nascondi classifica' : 'Vedi classifica'}
            </button>
            {classificaAperta === c.id && classifica && (
              <div className="mt-2 pt-2 border-t border-border divide-y divide-border">
                {classifica.map((u, i) => (
                  <div key={u.id} className="flex items-center gap-3 py-2 first:pt-0">
                    <span className="w-5 text-center text-xs text-muted">{i + 1}</span>
                    <span className="flex-1 text-sm truncate">{u.nome} {u.cognome}</span>
                    {/* Con la metrica "punti" il valore è il punteggio; per i passaggi è il conteggio. */}
                    <span className="text-sm text-primary">{c.metrica === 'punti' ? u.punteggio : u.eventi}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
