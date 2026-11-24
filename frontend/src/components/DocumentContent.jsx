import React from 'react';

// Sottoinsieme minimale di markdown per i testi dei documenti legali: intestazioni (#, ##),
// grassetto (**testo**), corsivo (*testo* o _testo_), elenchi puntati (- voce), link
// ([testo](https://...)). Genera SEMPRE elementi React, mai HTML grezzo: non serve
// sanitizzare nulla perché non esiste un percorso per iniettare markup o script.
function renderInline(testo, keyPrefix) {
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/;
  const parti = [];
  let resto = testo;
  let i = 0;
  while (resto.length > 0) {
    const m = resto.match(regex);
    if (!m) { parti.push(resto); break; }
    if (m.index > 0) parti.push(resto.slice(0, m.index));
    if (m[1] !== undefined) parti.push(<strong key={`${keyPrefix}-${i++}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) parti.push(<em key={`${keyPrefix}-${i++}`}>{m[2]}</em>);
    else if (m[3] !== undefined) parti.push(<em key={`${keyPrefix}-${i++}`}>{m[3]}</em>);
    else if (m[4] !== undefined) {
      parti.push(
        <a key={`${keyPrefix}-${i++}`} href={m[5]} target="_blank" rel="noopener noreferrer" className="underline text-primary">
          {m[4]}
        </a>
      );
    }
    resto = resto.slice(m.index + m[0].length);
  }
  return parti;
}

export default function DocumentContent({ testo }) {
  const righe = (testo || '').split('\n');
  const blocchi = [];
  let paragrafo = [];
  let lista = [];

  const chiudiParagrafo = () => { if (paragrafo.length) { blocchi.push({ tipo: 'p', righe: paragrafo }); paragrafo = []; } };
  const chiudiLista = () => { if (lista.length) { blocchi.push({ tipo: 'ul', voci: lista }); lista = []; } };

  for (const rigaGrezza of righe) {
    const riga = rigaGrezza.trim();
    if (riga === '') { chiudiParagrafo(); chiudiLista(); continue; }
    const heading = riga.match(/^(#{1,3})\s+(.*)$/);
    const voce = riga.match(/^[-*]\s+(.*)$/);
    if (heading) {
      chiudiParagrafo(); chiudiLista();
      blocchi.push({ tipo: 'h', livello: heading[1].length, testo: heading[2] });
    } else if (voce) {
      chiudiParagrafo();
      lista.push(voce[1]);
    } else {
      chiudiLista();
      paragrafo.push(riga);
    }
  }
  chiudiParagrafo();
  chiudiLista();

  return (
    <div className="space-y-3 text-sm">
      {blocchi.map((b, i) => {
        if (b.tipo === 'h') {
          const Tag = `h${Math.min(b.livello + 2, 6)}`;
          return <Tag key={i} className="font-display font-semibold">{renderInline(b.testo, `h${i}`)}</Tag>;
        }
        if (b.tipo === 'ul') {
          return (
            <ul key={i} className="list-disc list-inside space-y-1">
              {b.voci.map((v, j) => <li key={j}>{renderInline(v, `li${i}-${j}`)}</li>)}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {b.righe.map((r, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}{renderInline(r, `p${i}-${j}`)}</React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
