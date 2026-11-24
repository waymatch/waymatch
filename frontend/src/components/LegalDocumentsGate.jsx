import FinestraModale from './FinestraModale.jsx';
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Check } from 'lucide-react';
import { api } from '../api.js';
import DocumentContent from './DocumentContent.jsx';
import PdfDocumento from './PdfDocumento.jsx';

// tipo: 'generale' (usato in Layout, blocca l'intera app) | 'conducente' (usato in
// OfferRide, blocca solo l'offerta di un passaggio) — stesso componente, endpoint diverso.
export default function LegalDocumentsGate({ children, tipo = 'generale' }) {
  const [pending, setPending] = useState(null);
  const [indice, setIndice] = useState(0);
  const [spuntato, setSpuntato] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get(`/legal-documents/pending?tipo=${tipo}`).then((d) => setPending(d.documenti)).catch(() => setPending([]));
  };
  useEffect(() => { load(); }, [tipo]);

  if (pending === null) return null; // breve attesa, evita flash del contenuto

  if (pending.length === 0) return children;

  const doc = pending[indice];

  const accetta = async () => {
    setSaving(true);
    try {
      try {
        await api.post(`/legal-documents/${doc.id}/accept`, { versione: doc.versione });
      } catch (e) {
        // Nuova versione pubblicata mentre l'utente leggeva: ricarica e mostra quella.
        if (e.codice === 'VERSIONE_CAMBIATA') { load(); setIndice(0); setSpuntato(false); return; }
        throw e;
      }
      if (indice + 1 < pending.length) {
        setIndice((i) => i + 1);
        setSpuntato(false);
      } else {
        load();
        setIndice(0);
        setSpuntato(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <FinestraModale titoloId="documento-legale-titolo" className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-surface w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <h2 id="documento-legale-titolo" className="font-display font-semibold text-base">{doc.titolo}</h2>
            {pending.length > 1 && <p className="text-xs text-muted">Documento {indice + 1} di {pending.length}</p>}
          </div>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 text-sm">
          {doc.formato === 'pdf' ? (
            <PdfDocumento docId={doc.id} titolo={doc.titolo} />
          ) : (
            <DocumentContent testo={doc.contenuto} />
          )}
        </div>
        <div className="px-5 py-4 border-t border-border space-y-3">
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={spuntato} onChange={(e) => setSpuntato(e.target.checked)} />
            <span>Ho letto e accetto questo documento.</span>
          </label>
          <button className="btn-primary w-full" disabled={!spuntato || saving} onClick={accetta}>
            {saving ? 'Salvataggio...' : <><Check size={16} /> Accetto e continuo</>}
          </button>
        </div>
      </div>
    </FinestraModale>
  );
}
