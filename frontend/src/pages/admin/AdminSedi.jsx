import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { Plus, Pencil, Trash2, Building2, MapPin } from 'lucide-react';
import { api } from '../../api.js';
import AddressAutocomplete from '../../components/AddressAutocomplete.jsx';

function formVuoto() { return { nome: '', indirizzo: '', coords: null }; }

export default function AdminSedi() {
  const [sedi, setSedi] = useState(null);
  const [editingId, setEditingId] = useState(null); // null = nuova sede, altrimenti id in modifica
  const [form, setForm] = useState(formVuoto);
  const [error, setError] = useState('');
  const [erroreCarica, setErroreCarica] = useState('');
  const [saving, setSaving] = useState(false);
  const inSalvataggio = useRef(false);   // blocca un secondo invio prima del rendering
  const modificaCorrente = useRef(null); // id della sede in modifica: una risposta tardiva non azzera un altro modulo
  const [senzaPosizione, setSenzaPosizione] = useState(false); // la sede in modifica non ha mai avuto coordinate

  const load = useCallback(() => {
    setErroreCarica('');
    api.get('/sedi').then((d) => setSedi(d.sedi)).catch((e) => setErroreCarica(e.message || 'Impossibile caricare le sedi.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const iniziaModifica = (s) => {
    modificaCorrente.current = s.id;
    setEditingId(s.id);
    setSenzaPosizione(s.lat == null);
    setForm({ nome: s.nome, indirizzo: s.indirizzo || '', coords: s.lat != null ? { lat: s.lat, lon: s.lon } : null });
    setError('');
  };
  const annullaModifica = () => {
    modificaCorrente.current = null;
    setSenzaPosizione(false);
    setEditingId(null);
    setForm(formVuoto());
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (inSalvataggio.current) return; // un doppio invio creerebbe due sedi uguali
    setError('');
    // Una sede nuova richiede la posizione; una sede esistente che non l'ha mai avuta si può
    // comunque rinominare (i km restano da inserire a mano).
    if (!form.coords && !(editingId && senzaPosizione)) {
      setError('Seleziona l\'indirizzo dai suggerimenti per calcolare automaticamente le tratte.');
      return;
    }
    const contesto = modificaCorrente.current;
    inSalvataggio.current = true;
    setSaving(true);
    try {
      const payload = { nome: form.nome, indirizzo: form.indirizzo, lat: form.coords ? form.coords.lat : null, lon: form.coords ? form.coords.lon : null };
      if (editingId) {
        await api.put(`/sedi/${editingId}`, payload);
      } else {
        await api.post('/sedi', payload);
      }
      // Il modulo si azzera solo se è ancora quello della richiesta appena finita.
      if (modificaCorrente.current === contesto) annullaModifica();
      load();
    } catch (e) { setError(e.message); }
    finally { inSalvataggio.current = false; setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Eliminare questa sede? Gli utenti collegati resteranno senza sede assegnata.')) return;
    try {
      await api.del(`/sedi/${id}`);
      if (modificaCorrente.current === id) annullaModifica();
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Sedi aziendali</h1>
        <p className="text-muted text-sm mt-0.5">
          L'indirizzo geolocalizzato permette il calcolo automatico delle tratte casa-lavoro.
        </p>
      </div>

      <div className="space-y-6">
        <form onSubmit={submit} className="card space-y-3">
          {error && <ErrorBanner message={error} />}
          {editingId && <p className="text-xs text-muted -mt-1">Modifica sede esistente</p>}
          <input required placeholder="Nome sede" className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <AddressAutocomplete
            key={editingId ?? 'nuova'}
            value={form.indirizzo}
            onChange={(v) => setForm({ ...form, indirizzo: v, coords: null })}
            onSelect={(place) => setForm({ ...form, indirizzo: place.label, coords: { lat: place.lat, lon: place.lon } })}
            placeholder="Cerca l'indirizzo della sede..."
          />
          {form.coords && <p className="text-xs text-primary flex items-center gap-1"><MapPin size={12} /> Posizione trovata</p>}
          <div className="flex gap-3">
            {editingId && <button type="button" className="btn-outline flex-1" onClick={annullaModifica}>Annulla</button>}
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'Salvataggio...' : editingId ? <>Salva modifiche</> : <><Plus size={16} /> Aggiungi sede</>}
            </button>
          </div>
        </form>

        {erroreCarica && <ErroreConRiprova messaggio={erroreCarica} onRiprova={load} />}

        {sedi === null ? (
          erroreCarica ? null : <div className="card animate-pulse h-24" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {sedi.map((s) => (
              <div key={s.id} className="card flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
                    <Building2 size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s.nome}</p>
                    {s.indirizzo && <p className="text-xs text-muted truncate">{s.indirizzo}</p>}
                    {!s.lat && <p className="text-xs text-accent-dark mt-0.5">Nessuna posizione: km da inserire manualmente</p>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" className="p-2 text-muted hover:text-primary disabled:opacity-40" disabled={saving} aria-label={`Modifica la sede ${s.nome}`} onClick={() => iniziaModifica(s)} title="Modifica"><Pencil size={16} aria-hidden="true" /></button>
                  <button type="button" className="p-2 text-muted hover:text-danger" aria-label={`Elimina la sede ${s.nome}`} onClick={() => remove(s.id)} title="Elimina"><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
