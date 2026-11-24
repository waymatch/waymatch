import React from 'react';

// Visualizzatore Markdown per le guide (docs/*.md incorporate nell'app al momento della build).
// Supporta: titoli (#, ##, ###), paragrafi, elenchi puntati e numerati, tabelle, blocchi di codice,
// citazioni, immagini, **grassetto**, *corsivo*, `codice` e link http(s). Genera SEMPRE elementi
// React, mai HTML grezzo: non esiste un percorso per iniettare markup o script. I link non http(s)
// (per esempio verso altri file del repository) diventano testo semplice.

export function slug(testo) {
  return testo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inline(testo, immagini, k) {
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|(?<!`)(`+)(?!`)(.+?)(?<!`)\6(?!`)|\*(.+?)\*/;
  let resto = testo;
  let i = 0;
  while (resto.length > 0) {
    const m = resto.match(re);
    if (!m) { out.push(resto); break; }
    if (m.index > 0) out.push(resto.slice(0, m.index));
    const key = `${k}-${i++}`;
    if (m[2] !== undefined) {
      const src = immagini[m[2].replace(/^.*\//, '')];
      if (src) out.push(<img key={key} src={src} alt={m[1]} loading="lazy" className="rounded-xl border border-border my-2 max-w-full" />);
    } else if (m[4] !== undefined) {
      if (/^https?:\/\//.test(m[4])) out.push(<a key={key} href={m[4]} target="_blank" rel="noopener noreferrer" className="underline text-primary">{m[3]}</a>);
      else out.push(m[3]);
    } else if (m[5] !== undefined) out.push(<strong key={key}>{m[5]}</strong>);
    else if (m[6] !== undefined) {
      // Codice inline con delimitatori di qualunque lunghezza (CommonMark): lo span si chiude con
      // una sequenza di backtick della stessa lunghezza; uno spazio a ciascun lato si toglie.
      const interno = /^ .* $/.test(m[7]) && m[7].trim() ? m[7].slice(1, -1) : m[7];
      out.push(<code key={key} className="px-1 py-0.5 rounded bg-bg border border-border text-[0.85em]">{interno}</code>);
    } else out.push(<em key={key}>{m[8]}</em>);
    resto = resto.slice(m.index + m[0].length);
  }
  return out;
}

// Apertura di un blocco di codice (CommonMark): fino a 3 spazi, almeno 3 backtick e, dopo, nessun
// altro backtick (altrimenti è codice inline, come "```foo `bar` baz```").
const APERTURA_CODICE = /^ {0,3}`{3,}[^`]*$/;

const cellule = (riga) => riga.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function titoli(markdown) {
  return markdown.split(/\r?\n/).filter((r) => /^## /.test(r)).map((r) => ({ testo: r.slice(3).trim(), id: slug(r.slice(3)) }));
}

export default function GuidaMarkdown({ testo, immagini = {} }) {
  const righe = testo.split(/\r?\n/); // anche file con terminazioni CRLF
  const blocchi = [];
  let i = 0;
  let n = 0;
  while (i < righe.length) {
    const r = righe[i];
    const key = `b${n++}`;
    if (!r.trim()) { i++; continue; }
    if (APERTURA_CODICE.test(r)) {
      // Come in CommonMark: il blocco si chiude con almeno tanti backtick quanti l'apertura,
      // seguiti solo da spazi (una riga "```esempio" dentro il codice non lo chiude).
      const apertura = r.trim().match(/^`+/)[0].length;
      const chiusura = new RegExp(`^ {0,3}\`{${apertura},}[ \t]*$`);
      const codice = [];
      i++;
      while (i < righe.length && !chiusura.test(righe[i])) codice.push(righe[i++]);
      i++;
      blocchi.push(<pre key={key} className="my-3 p-3 rounded-xl bg-bg border border-border text-xs overflow-x-auto"><code>{codice.join('\n')}</code></pre>);
    } else if (/^#{1,3} /.test(r)) {
      const livello = r.match(/^#+/)[0].length;
      const t = r.replace(/^#+ /, '');
      const classi = { 1: 'font-display font-bold text-2xl mt-2', 2: 'font-display font-semibold text-lg mt-8 scroll-mt-4', 3: 'font-display font-semibold text-base mt-5' }[livello];
      const Tag = `h${livello}`;
      blocchi.push(<Tag key={key} id={livello === 2 ? slug(t) : undefined} className={classi}>{inline(t, immagini, key)}</Tag>);
      i++;
    } else if (r.startsWith('|') && righe[i + 1] && /^\|?\s*:?-{2,}/.test(righe[i + 1])) {
      const testa = cellule(r);
      i += 2;
      const corpo = [];
      while (i < righe.length && righe[i].startsWith('|')) corpo.push(cellule(righe[i++]));
      blocchi.push(
        <div key={key} className="my-3 overflow-x-auto">
          <table className="text-sm border-collapse w-full">
            <thead><tr>{testa.map((c, j) => <th key={j} className="text-left font-medium border-b border-border px-2 py-1.5">{inline(c, immagini, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{corpo.map((riga, a) => <tr key={a}>{riga.map((c, j) => <td key={j} className="border-b border-border px-2 py-1.5 align-top">{inline(c, immagini, `${key}${a}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    } else if (/^(\s*)([-*]|\d+\.) /.test(r)) {
      const ordinato = /^\s*\d+\. /.test(r);
      const voci = [];
      while (i < righe.length && /^(\s*)([-*]|\d+\.) /.test(righe[i])) {
        let t = righe[i].replace(/^\s*([-*]|\d+\.) /, '');
        i++;
        while (i < righe.length && /^\s{2,}\S/.test(righe[i]) && !/^\s*([-*]|\d+\.) /.test(righe[i])) t += ' ' + righe[i++].trim();
        voci.push(t);
      }
      const Tag = ordinato ? 'ol' : 'ul';
      blocchi.push(<Tag key={key} className={`my-2 pl-5 space-y-1 ${ordinato ? 'list-decimal' : 'list-disc'}`}>{voci.map((t, j) => <li key={j}>{inline(t, immagini, `${key}-${j}`)}</li>)}</Tag>);
    } else if (r.startsWith('>')) {
      const q = [];
      while (i < righe.length && righe[i].startsWith('>')) q.push(righe[i++].replace(/^>\s?/, ''));
      blocchi.push(<blockquote key={key} className="my-3 border-l-4 border-primary pl-3 text-sm text-muted">{inline(q.join(' '), immagini, key)}</blockquote>);
    } else {
      const p = [];
      // La prima riga si consuma sempre (anche "| nota" che non forma una tabella): senza, il
      // ciclo esterno non avanzerebbe e la pagina si bloccherebbe.
      p.push(righe[i++].trim());
      while (i < righe.length && righe[i].trim() && !/^(#{1,3} |\||>|(\s*)([-*]|\d+\.) )/.test(righe[i]) && !APERTURA_CODICE.test(righe[i])) p.push(righe[i++].trim());
      blocchi.push(<p key={key} className="my-2 leading-relaxed">{inline(p.join(' '), immagini, key)}</p>);
    }
  }
  return <div className="text-sm text-ink">{blocchi}</div>;
}
