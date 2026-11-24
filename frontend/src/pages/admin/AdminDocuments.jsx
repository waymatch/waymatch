import React, { useEffect, useState, useCallback, useRef, useId } from 'react';
import ErrorBanner from '../../components/ErrorBanner.jsx';
import ErroreConRiprova from '../../components/ErroreConRiprova.jsx';
import { FileText, Plus, Pencil, Trash2, Users, File as FileIcon } from 'lucide-react';
import { api } from '../../api.js';
import DocumentTextEditor from '../../components/DocumentTextEditor.jsx';
import { LinkPdf } from '../../components/PdfDocumento.jsx';

const TIPO_LABEL = {
  generale: 'Generale — richiesto a tutti al primo accesso',
  conducente: 'Solo per chi offre un passaggio',
};

export default function AdminDocuments() {
  const [documenti, setDocumenti] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | documento
  const [accettazioni, setAccettazioni] = useState(null);

  const [erroreCarica, setErroreCarica] = useState('');
  const load = useCallback(() => {
    setErroreCarica('');
    api.get('/legal-documents').then((d) => setDocumenti(d.documenti)).catch((e) => setErroreCarica(e.message || 'Impossibile caricare i documenti.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const elimina = async (id) => {
    if (!confirm('Disattivare questo documento? Non verrà più richiesto agli utenti.')) return;
    try {
      await api.del(`/legal-documents/${id}`);
      load();
    } catch (e) { alert(e.message); }
  };

  const vediAccettazioni = async (id) => {
    try {
      const d = await api.get(`/legal-documents/${id}/accettazioni`);
      setAccettazioni(d);
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl">Documenti e consensi</h1>
          <p className="text-muted text-sm mt-0.5">Privacy, GDPR, dichiarazioni di responsabilità.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Nuovo</button>
      </div>

      {editing && (
        <div>
          <DocumentForm
            key={editing === 'new' ? 'nuovo' : `doc-${editing.id}`}
            documento={editing === 'new' ? null : editing}
            onDone={() => { setEditing(null); load(); }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {erroreCarica && <ErroreConRiprova messaggio={erroreCarica} onRiprova={load} />}

      {documenti === null ? (
        erroreCarica ? null : <div className="card animate-pulse h-24" />
      ) : documenti.length === 0 ? (
        <div className="card text-center py-10 text-sm text-muted">Nessun documento configurato.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {documenti.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm flex items-center gap-1.5">
                    {d.formato === 'pdf' ? <FileIcon size={14} className="text-primary shrink-0" /> : <FileText size={14} className="text-primary shrink-0" />}
                    {d.titolo}
                  </p>
                  <p className="text-xs text-muted mt-1">Versione {d.versione} · {TIPO_LABEL[d.tipo] || d.tipo}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="p-2 text-muted hover:text-primary" onClick={() => vediAccettazioni(d.id)} title="Chi ha accettato"><Users size={15} /></button>
                  <button className="p-2 text-muted hover:text-primary" onClick={() => setEditing(d)} title="Modifica"><Pencil size={15} /></button>
                  <button className="p-2 text-muted hover:text-danger" onClick={() => elimina(d.id)} title="Disattiva"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {accettazioni && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-display font-semibold text-sm">Accettazioni: {accettazioni.documento.titolo}</p>
            <button className="text-xs text-muted" onClick={() => setAccettazioni(null)}>Chiudi</button>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {accettazioni.utenti.map((u) => (
              <div key={u.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                <span>{u.nome} {u.cognome}</span>
                {u.versione_accettata >= accettazioni.documento.versione ? (
                  <span className="badge-primary shrink-0">Accettato {new Date(u.accettato_at.replace(' ', 'T') + 'Z').toLocaleDateString('it-IT')}</span>
                ) : (
                  <span className="badge bg-accent-light text-accent-dark shrink-0">In attesa</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentForm({ documento, onDone, onCancel }) {
  const idForm = useId();
  const [titolo, setTitolo] = useState(documento?.titolo || '');
  const [tipo, setTipo] = useState(documento?.tipo || 'generale');
  const [formato, setFormato] = useState(documento?.formato || 'testo');
  const [contenuto, setContenuto] = useState(documento?.contenuto || '');
  const [incrementaVersione, setIncrementaVersione] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('titolo', titolo);
      fd.append('tipo', tipo);
      fd.append('formato', formato);
      fd.append('contenuto', formato === 'testo' ? contenuto : '');
      if (documento) fd.append('incrementaVersione', String(incrementaVersione));
      if (formato === 'pdf' && fileRef.current?.files[0]) fd.append('file', fileRef.current.files[0]);

      if (documento) {
        await api.put(`/legal-documents/${documento.id}`, fd);
      } else {
        await api.post('/legal-documents', fd);
      }
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      {error && <ErrorBanner message={error} />}
      <input required placeholder="Titolo (es. Informativa Privacy)" className="input" value={titolo} onChange={(e) => setTitolo(e.target.value)} />

      <div>
        <label htmlFor="admindocuments-0" className="label">Quando va accettato</label>
        <select id="admindocuments-0" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="generale">Generale — a tutti, al primo accesso</option>
          <option value="conducente">Solo a chi offre un passaggio (dichiarazione conducente...)</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setFormato('testo')} className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium ${formato === 'testo' ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted'}`}>
          Testo (con formattazione)
        </button>
        <button type="button" onClick={() => setFormato('pdf')} className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium ${formato === 'pdf' ? 'border-primary bg-primary-light text-primary-dark' : 'border-border text-muted'}`}>
          Carica un PDF
        </button>
      </div>

      {formato === 'testo' ? (
        <DocumentTextEditor value={contenuto} onChange={setContenuto} />
      ) : (
        <div className="space-y-2">
          <label htmlFor={`${idForm}-pdf`} className="label">File PDF del documento</label>
          {documento?.formato === 'pdf' && documento?.file_path && (
            <p className="text-xs text-muted">
              PDF attuale: <LinkPdf docId={documento.id} className="underline text-primary">apri</LinkPdf> — carica un nuovo file per sostituirlo.
            </p>
          )}
          <input id={`${idForm}-pdf`} ref={fileRef} type="file" accept="application/pdf" className="input" />
        </div>
      )}

      {documento && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5" checked={incrementaVersione} onChange={(e) => setIncrementaVersione(e.target.checked)} />
          <span>Richiedi una nuova accettazione a tutti (usa questa opzione se hai cambiato sostanzialmente il contenuto).</span>
        </label>
      )}

      <div className="flex gap-3">
        <button type="button" className="btn-outline flex-1" onClick={onCancel}>Annulla</button>
        <button className="btn-primary flex-1" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</button>
      </div>
    </form>
  );
}
