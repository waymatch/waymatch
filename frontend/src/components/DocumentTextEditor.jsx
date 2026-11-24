import React, { useRef, useState } from 'react';
import { Bold, Italic, Heading, List, Link as LinkIcon, Eye, Pencil } from 'lucide-react';
import DocumentContent from './DocumentContent.jsx';

// Editor testuale con formattazione minima (grassetto, corsivo, titoli, elenchi, link) per
// i documenti legali: una textarea + pulsanti che inseriscono la sintassi al posto del
// cursore, più un'anteprima che mostra esattamente come lo vedrà l'utente (stesso
// componente DocumentContent usato nella schermata di accettazione).
export default function DocumentTextEditor({ value, onChange, rows = 10 }) {
  const [anteprima, setAnteprima] = useState(false);
  const textareaRef = useRef();

  const avvolgiSelezione = (prefix, suffix = prefix) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selezionato = value.slice(start, end);
    const nuovo = value.slice(0, start) + prefix + selezionato + suffix + value.slice(end);
    onChange(nuovo);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + prefix.length;
      el.selectionEnd = start + prefix.length + selezionato.length;
    });
  };

  const prefissaRiga = (prefix) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const inizioRiga = value.lastIndexOf('\n', start - 1) + 1;
    const nuovo = value.slice(0, inizioRiga) + prefix + value.slice(inizioRiga);
    onChange(nuovo);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + prefix.length;
    });
  };

  const inserisciLink = () => {
    const el = textareaRef.current;
    if (!el) return; // in anteprima la textarea non c'è
    const start = el.selectionStart, end = el.selectionEnd;
    const selezionato = value.slice(start, end) || 'testo del link';
    const nuovo = value.slice(0, start) + `[${selezionato}](https://)` + value.slice(end);
    onChange(nuovo);
    requestAnimationFrame(() => { el.focus(); });
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-bg border-b border-border flex-wrap">
        <ToolbarButton title="Grassetto" onClick={() => avvolgiSelezione('**')}><Bold size={14} /></ToolbarButton>
        <ToolbarButton title="Corsivo" onClick={() => avvolgiSelezione('*')}><Italic size={14} /></ToolbarButton>
        <ToolbarButton title="Titolo" onClick={() => prefissaRiga('## ')}><Heading size={14} /></ToolbarButton>
        <ToolbarButton title="Elenco puntato" onClick={() => prefissaRiga('- ')}><List size={14} /></ToolbarButton>
        <ToolbarButton title="Link" onClick={inserisciLink}><LinkIcon size={14} /></ToolbarButton>
        <div className="flex-1" />
        <ToolbarButton title={anteprima ? 'Modifica' : 'Anteprima'} onClick={() => setAnteprima((v) => !v)}>
          {anteprima ? <Pencil size={14} /> : <Eye size={14} />}
        </ToolbarButton>
      </div>
      {anteprima ? (
        <div className="p-3 min-h-[8rem]"><DocumentContent testo={value} /></div>
      ) : (
        <textarea
          ref={textareaRef}
          className="input !rounded-none !border-0 w-full"
          rows={rows}
          placeholder="Testo del documento... usa la barra sopra per grassetto, titoli, elenchi e link."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function ToolbarButton({ children, title, onClick }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="p-1.5 rounded-lg text-muted hover:bg-surface hover:text-ink">
      {children}
    </button>
  );
}
