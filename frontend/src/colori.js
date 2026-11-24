// Colori e contrasto (WCAG 2.1). Funzioni pure: usate dal tema, dall'avviso nelle Impostazioni
// e dal test che controlla il contrasto (AA) delle coppie testo/sfondo del tema.
export function hexToRgb(hex) {
  const testo = String(hex || '');
  const pulito = testo.startsWith('#') ? testo.slice(1) : testo; // '#' ammesso solo all'inizio
  const norm = pulito.length === 3 ? pulito.split('').map((c) => c + c).join('') : pulito;
  if (!/^[0-9a-f]{6}$/i.test(norm)) return null; // parseInt accetterebbe "12GGGG" come 0x12
  const num = parseInt(norm, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
export const scurisci = ([r, g, b], q = 0.25) => [r, g, b].map((c) => Math.round(c * (1 - q)));
export const schiarisci = ([r, g, b], q = 0.85) => [r, g, b].map((c) => Math.round(c + (255 - c) * q));

export function luminanza([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrasto(a, b) {
  const [la, lb] = [luminanza(a), luminanza(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

// Colori di base del tema WayMatch (devono coincidere con tailwind.config.js e index.css).
export const TEMA = {
  nebbia: [0xF3, 0xF7, 0xF5], bianco: [255, 255, 255], petrolio: [0x14, 0x42, 0x4F],
  acqua: [0x3C, 0xC8, 0xB8], acquaScuro: [0x0B, 0x6E, 0x66],
  muted: [0x4A, 0x66, 0x70], danger: [0xB0, 0x2E, 0x2E],
};

const MINIMO_AA = 4.5;

// Scurisce un colore a passi finché ha contrasto AA con tutti gli sfondi indicati: serve per i
// testi nel colore dell'accento (l'acqua del brand, per esempio, è illeggibile come testo su chiaro).
export function testoLeggibile(rgb, sfondi, minimo = MINIMO_AA) {
  let c = rgb;
  for (let i = 0; i < 60 && sfondi.some((b) => contrasto(c, b) < minimo); i++) c = scurisci(c, 0.04);
  return c;
}

// Colore del testo da mettere SOPRA un fondo (pulsanti nel colore dell'accento): bianco o petrolio,
// quello con più contrasto. Se nessuno dei due arriva ad AA (fondi grigi medi), il nero.
export function testoSu(rgb) {
  const migliore = contrasto(TEMA.bianco, rgb) >= contrasto(TEMA.petrolio, rgb) ? TEMA.bianco : TEMA.petrolio;
  if (contrasto(migliore, rgb) >= MINIMO_AA) return migliore;
  return contrasto([0, 0, 0], rgb) > contrasto(migliore, rgb) ? [0, 0, 0] : migliore;
}

// Dato il colore primario scelto da un'azienda (pulsanti con testo bianco, testi e link in quel
// colore su fondo bianco/nebbia), dice se il contrasto è sufficiente (AA, 4,5) e propone la
// variante più scura più vicina che lo è.
export function controllaColorePrimario(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { valido: false };
  const richiesto = (c) => Math.min(contrasto(c, TEMA.bianco), contrasto(c, TEMA.nebbia));
  const attuale = richiesto(rgb);
  if (attuale >= MINIMO_AA) return { valido: true, ok: true, contrasto: attuale };
  let proposta = rgb;
  for (let i = 0; i < 40 && richiesto(proposta) < MINIMO_AA; i++) proposta = scurisci(proposta, 0.05);
  return { valido: true, ok: false, contrasto: attuale, proposta: rgbToHex(proposta) };
}

// Valori derivati dal colore dell'accento: fondo chiaro per i badge, testo scuro leggibile su
// quel fondo e su bianco, colore del testo sopra l'accento. L'accento quindi non può mai produrre
// testo illeggibile, qualunque colore scelga l'azienda.
export function derivatiAccento(rgb) {
  const chiaro = schiarisci(rgb);
  // Per l'acqua del brand si usa il suo "acqua scuro" ufficiale; per ogni altro colore, la variante calcolata.
  const predefinito = rgb.every((c, i) => c === TEMA.acqua[i]);
  const scuro = predefinito ? TEMA.acquaScuro : testoLeggibile(rgb, [chiaro, TEMA.bianco, TEMA.nebbia]);
  return { chiaro, scuro, su: testoSu(rgb) };
}
