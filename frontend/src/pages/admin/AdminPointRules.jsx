import React, { useEffect, useState, useCallback } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import { Award, Gift, History } from 'lucide-react';
import { api } from '../../api.js';

export default function AdminPointRules() {
  const [rules, setRules] = useState(null);
  const [users, setUsers] = useState([]);
  const [storico, setStorico] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get('/point-rules').then((d) => setRules(d.rules)).catch((e) => setError(e.message));
    api.get('/users').then((d) => setUsers(d.users));
    api.get('/point-rules/manual-award/storico').then((d) => setStorico(d.storico));
  }, []);
  useEffect(() => { load(); }, [load]);

  const salvaRegola = async (chiave, punti, attivo) => {
    setMsg('');
    try {
      await api.put(`/point-rules/${chiave}`, { punti, attivo });
      setMsg('Regola aggiornata.');
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Regole punteggio</h1>
        <p className="text-muted text-sm mt-0.5">
          Configura quanti punti assegnare per ciascun evento. I punti vengono assegnati solo
          quando il viaggio è effettivamente completato (con check-in del passeggero a bordo).
        </p>
      </div>

      {msg && <div className="rounded-xl bg-primary-light text-primary-dark text-sm px-3.5 py-2.5">{msg}</div>}
      {error && <ErrorBanner message={error} />}

      <section className="space-y-3">
        <SectionTitle icon={Award} title="Regole" />
        <div className="grid gap-3 lg:grid-cols-2">
          {rules === null ? <div className="card animate-pulse h-24" /> : rules.map((r) => (
            <RuleRow key={r.chiave} rule={r} onSave={salvaRegola} />
          ))}
        </div>
      </section>

      <div>
        <ManualAward users={users} onDone={load} />
      </div>

      <section className="space-y-3">
        <SectionTitle icon={History} title="Storico assegnazioni manuali" />
        {storico === null ? <div className="card animate-pulse h-16" /> : storico.length === 0 ? (
          <div className="card text-center py-6 text-sm text-muted">Nessuna assegnazione manuale finora.</div>
        ) : (
          <div className="card divide-y divide-border">
            {storico.map((s) => (
              <div key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{s.nome} {s.cognome}</p>
                  <span className={`text-sm font-semibold ${s.punti >= 0 ? 'text-primary' : 'text-danger'}`}>
                    {s.punti >= 0 ? '+' : ''}{s.punti}
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">{s.motivo}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RuleRow({ rule, onSave }) {
  const [punti, setPunti] = useState(rule.punti);
  const [attivo, setAttivo] = useState(!!rule.attivo);
  const dirty = punti !== rule.punti || attivo !== !!rule.attivo;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">{rule.nome}</p>
          {rule.descrizione && <p className="text-xs text-muted mt-1">{rule.descrizione}</p>}
        </div>
        {rule.modificabile === 1 && (
          <label className="flex items-center gap-1.5 text-xs text-muted shrink-0">
            <input type="checkbox" checked={attivo} onChange={(e) => setAttivo(e.target.checked)} />
            Attiva
          </label>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <input
          type="number" min="0"
          aria-label={`Punti per: ${rule.nome}`}
          className="input !w-24 !py-1.5"
          value={punti}
          onChange={(e) => setPunti(Number(e.target.value))}
          disabled={!attivo && rule.modificabile === 1}
        />
        <span className="text-xs text-muted">punti</span>
        {dirty && (
          <button className="btn-primary !py-1.5 !text-xs ml-auto" onClick={() => onSave(rule.chiave, punti, attivo)}>
            Salva
          </button>
        )}
      </div>
    </div>
  );
}

function ManualAward({ users, onDone }) {
  const [userId, setUserId] = useState('');
  const [punti, setPunti] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await api.post('/point-rules/manual-award', { user_id: userId, punti, motivo });
      setMsg('Punti assegnati.');
      setUserId(''); setPunti(''); setMotivo('');
      onDone();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <SectionTitle icon={Gift} title="Assegna punti manuali" />
      <form onSubmit={submit} className="card space-y-3">
        <p className="text-xs text-muted -mt-1">
          Utile per riconoscimenti extra (es. "collega del mese", vincitore contest). Usa un
          valore negativo per correggere un'assegnazione errata.
        </p>
        <select aria-label="Utente a cui assegnare i punti" required className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Seleziona utente...</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.nome} {u.cognome}</option>)}
        </select>
        <div className="flex gap-3">
          <input required type="number" placeholder="Punti (es. 20 o -10)" className="input" value={punti} onChange={(e) => setPunti(e.target.value)} />
        </div>
        <input required placeholder="Motivo (es. Collega del mese - Settembre)" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <button className="btn-accent w-full" disabled={saving}>{saving ? 'Assegnazione...' : 'Assegna punti'}</button>
      </form>
    </section>
  );
}

function SectionTitle({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={16} className="text-muted" />
      <h2 className="font-display font-semibold text-sm">{title}</h2>
    </div>
  );
}
