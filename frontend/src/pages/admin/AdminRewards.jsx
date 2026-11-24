import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { Plus, Trash2, Image, Gift, QrCode, Pencil, PauseCircle, PlayCircle, Inbox } from 'lucide-react';
import { api } from '../../api.js';
import ImmagineAutenticata from '../../components/ImmagineAutenticata.jsx';

function formVuoto() {
  return { nome: '', descrizione: '', punti_richiesti: '', tipo: 'fisico', voucher_template_id: '' };
}

const TABS = [
  { id: 'catalogo', label: 'Catalogo premi', icon: Gift },
  { id: 'template', label: 'Template grafici voucher', icon: Image },
  { id: 'richieste', label: 'Richieste premi', icon: Inbox },
];

export default function AdminRewards() {
  const [tab, setTab] = useState('catalogo');
  const [rewards, setRewards] = useState(null);
  const [redemptions, setRedemptions] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [editingId, setEditingId] = useState(null); // null = nuovo premio, altrimenti id in modifica
  const [form, setForm] = useState(formVuoto);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const [nomeTemplate, setNomeTemplate] = useState('');

  // Un errore per ognuna delle tre letture: la scheda interessata lo mostra con "Riprova" e le
  // altre continuano a funzionare con i propri dati.
  const [errori, setErrori] = useState({ rewards: '', redemptions: '', templates: '' });
  const load = useCallback(() => {
    const segna = (chiave, valore) => setErrori((p) => ({ ...p, [chiave]: valore }));
    const errore = (chiave) => (e) => segna(chiave, e.message || 'Impossibile caricare i dati.');
    segna('rewards', ''); segna('redemptions', ''); segna('templates', '');
    api.get('/rewards/admin/tutti').then((d) => setRewards(d.rewards)).catch(errore('rewards'));
    api.get('/rewards/redemptions/list').then((d) => setRedemptions(d.redemptions)).catch(errore('redemptions'));
    api.get('/voucher-templates').then((d) => setTemplates(d.templates)).catch(errore('templates'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const iniziaModifica = (r) => {
    setEditingId(r.id);
    setForm({
      nome: r.nome, descrizione: r.descrizione || '', punti_richiesti: r.punti_richiesti,
      tipo: r.tipo, voucher_template_id: r.voucher_template_id || '',
    });
    setError('');
  };
  const annullaModifica = () => {
    setEditingId(null);
    setForm(formVuoto());
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        const reward = rewards.find((r) => r.id === editingId);
        await api.put(`/rewards/${editingId}`, { ...form, attivo: reward.attivo });
      } else {
        await api.post('/rewards', form);
      }
      annullaModifica();
      load();
    } catch (e) { setError(e.message); }
  };

  const toggleAttivo = async (r) => {
    try {
      await api.put(`/rewards/${r.id}`, {
        nome: r.nome, descrizione: r.descrizione, punti_richiesti: r.punti_richiesti,
        tipo: r.tipo, voucher_template_id: r.voucher_template_id, attivo: r.attivo ? 0 : 1,
      });
      load();
    } catch (e) { alert(e.message); }
  };

  const setStato = async (id, stato) => {
    try {
      await api.put(`/rewards/redemptions/${id}`, { stato });
      load();
    } catch (e) { alert(e.message); }
  };

  const caricaTemplate = async () => {
    const file = fileRef.current?.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('immagine', file);
    fd.append('nome', nomeTemplate || file.name);
    try {
      await api.post('/voucher-templates', fd);
      setNomeTemplate('');
      // Cambiando scheda durante l'invio il campo file non c'è più: il template è salvato comunque.
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) { alert(e.message); }
  };
  const eliminaTemplate = async (id) => {
    try {
      await api.del(`/voucher-templates/${id}`);
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Gestione premi</h1>
        <p className="text-muted text-sm mt-0.5">
          I punti vengono decurtati subito alla richiesta. Se rifiuti una richiesta,
          i punti vengono riaccreditati automaticamente.
        </p>
      </div>

      <div className="flex gap-2 bg-bg p-1 rounded-xl w-fit mx-auto border border-border flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === t.id ? 'bg-surface shadow-sm text-primary' : 'text-muted'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'catalogo' && (
        <div className="space-y-6">
          <form onSubmit={submit} className="card space-y-3">
            {error && <ErrorBanner message={error} />}
            {editingId && <p className="text-xs text-muted -mt-1">Modifica premio esistente</p>}
            <input required placeholder="Nome premio" className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            <input placeholder="Descrizione (opzionale)" className="input" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} />
            <input required type="number" min="1" placeholder="Punti richiesti" className="input" value={form.punti_richiesti} onChange={(e) => setForm({ ...form, punti_richiesti: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, tipo: 'fisico' })} className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-medium ${form.tipo === 'fisico' ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted'}`}>
                <Gift size={14} /> Fisico
              </button>
              <button type="button" onClick={() => setForm({ ...form, tipo: 'voucher_digitale' })} className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-medium ${form.tipo === 'voucher_digitale' ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted'}`}>
                <QrCode size={14} /> Voucher digitale
              </button>
            </div>
            {form.tipo === 'voucher_digitale' && (
              <select required className="input" value={form.voucher_template_id} onChange={(e) => setForm({ ...form, voucher_template_id: e.target.value })}>
                <option value="">Seleziona template grafico...</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            )}
            <div className="flex gap-3">
              {editingId && <button type="button" className="btn-outline flex-1" onClick={annullaModifica}>Annulla</button>}
              <button className="btn-primary flex-1">
                {editingId ? 'Salva modifiche' : <><Plus size={16} /> Aggiungi premio</>}
              </button>
            </div>
          </form>

          <section>
            <h2 className="font-display font-semibold text-sm mb-3">Catalogo</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {errori.rewards && <ErroreConRiprova messaggio={errori.rewards} onRiprova={load} />}
              {rewards === null ? (errori.rewards ? null : <div className="card animate-pulse h-14" />) : rewards.map((r) => (
                <div key={r.id} className={`card flex items-center justify-between gap-2 ${!r.attivo ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {r.nome} {r.tipo === 'voucher_digitale' && <span className="badge-accent ml-1">Digitale</span>}
                      {!r.attivo && <span className="badge bg-border text-muted ml-1">Disattivato</span>}
                    </p>
                    <p className="text-xs text-muted">{r.punti_richiesti} punti</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button className="p-2 text-muted hover:text-primary" title="Modifica" aria-label="Modifica" onClick={() => iniziaModifica(r)}><Pencil size={16} /></button>
                    <button
                      className="p-2 text-muted hover:text-danger"
                      title={r.attivo ? 'Disattiva' : 'Riattiva'} aria-label={r.attivo ? 'Disattiva' : 'Riattiva'}
                      onClick={() => toggleAttivo(r)}
                    >
                      {r.attivo ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'template' && (
        <div className="space-y-3">
          <div className="card space-y-3">
            <p className="text-xs text-muted">
              Carica un'immagine di sfondo (con logo/filigrana): è solo l'aspetto grafico del voucher,
              non contiene il codice. Il codice viene generato dal sistema al momento dell'approvazione
              della richiesta e sovrapposto automaticamente all'immagine quando il voucher viene mostrato
              o scaricato — il template resta invariato e riutilizzabile per più premi/riscatti.
            </p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="input" />
            <input placeholder="Nome template" className="input" value={nomeTemplate} onChange={(e) => setNomeTemplate(e.target.value)} />
            <button type="button" className="btn-outline w-full" onClick={caricaTemplate}><Plus size={15} /> Carica template</button>
          </div>
          {errori.templates && <ErroreConRiprova messaggio={errori.templates} onRiprova={load} />}
          {templates.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {templates.map((t) => (
                <div key={t.id} className="relative group">
                  <ImmagineAutenticata path={`/voucher-templates/${t.id}/immagine`} alt={t.nome} className="w-full aspect-video object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    onClick={() => eliminaTemplate(t.id)}
                    aria-label={`Elimina il template ${t.nome}`}
                    title="Elimina"
                    className="absolute top-1 right-1 p-1 rounded bg-white/90 text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                  <p className="text-xs text-muted mt-1 truncate">{t.nome}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'richieste' && (
        <section>
          <div className="grid gap-2 lg:grid-cols-2">
            {errori.redemptions && <ErroreConRiprova messaggio={errori.redemptions} onRiprova={load} />}
            {redemptions === null ? (errori.redemptions ? null : <div className="card animate-pulse h-14" />) : redemptions.length === 0 ? (
              <div className="card text-center py-6 text-sm text-muted">Nessuna richiesta al momento.</div>
            ) : redemptions.map((r) => (
              <div key={r.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.nome} {r.cognome} → {r.reward_nome}</p>
                  <p className="text-xs text-muted capitalize">{r.stato} · {r.punti_richiesti} pt</p>
                  {r.codice_voucher && <p className="text-xs text-primary mt-0.5">Codice: {r.codice_voucher}</p>}
                </div>
                {r.stato === 'in_attesa' && (
                  <div className="flex gap-1.5 shrink-0">
                    <button className="btn-primary !px-2.5 !py-1.5 !text-xs" onClick={() => setStato(r.id, 'approvato')}>Approva</button>
                    <button className="btn-outline !px-2.5 !py-1.5 !text-xs" onClick={() => setStato(r.id, 'rifiutato')}>Rifiuta</button>
                  </div>
                )}
                {r.stato === 'approvato' && (
                  <button className="btn-outline !px-2.5 !py-1.5 !text-xs shrink-0" onClick={() => setStato(r.id, 'consegnato')}>Segna consegnato</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
