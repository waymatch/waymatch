import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Il PDF si scarica solo con un link firmato e temporaneo (15 minuti): un <iframe> o un
// link non possono inviare l'header Authorization. Il link si rinnova ogni 10 minuti,
// così resta valido anche se la pagina resta aperta a lungo.
export function useLinkDocumento(docId) {
  const [url, setUrl] = useState(null);
  const [errore, setErrore] = useState('');
  useEffect(() => {
    let attivo = true;
    const carica = () => api.post(`/legal-documents/${docId}/link`)
      .then((d) => { if (attivo) { setUrl(d.url); setErrore(''); } })
      .catch((e) => { if (attivo) setErrore(e.message); });
    carica();
    const timer = setInterval(carica, 10 * 60 * 1000);
    return () => { attivo = false; clearInterval(timer); };
  }, [docId]);
  return { url, errore };
}

export function LinkPdf({ docId, children, className = 'text-xs text-primary underline' }) {
  const { url, errore } = useLinkDocumento(docId);
  if (errore) return <span className="text-xs text-danger">{errore}</span>;
  if (!url) return <span className="text-xs text-muted">Caricamento...</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

export default function PdfDocumento({ docId, titolo }) {
  const { url, errore } = useLinkDocumento(docId);
  if (errore) return <p className="text-xs text-danger">{errore}</p>;
  if (!url) return <div className="card animate-pulse" style={{ height: '50vh' }} />;
  return (
    <div className="space-y-2">
      <iframe src={url} title={titolo || 'Documento PDF'} className="w-full rounded-lg border border-border" style={{ height: '50vh' }} />
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
        Apri il PDF in una nuova scheda
      </a>
    </div>
  );
}
