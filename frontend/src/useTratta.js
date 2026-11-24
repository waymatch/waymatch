import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Logica condivisa dai moduli di offerta (passaggio singolo e turno fisso): caricamento delle sedi
// e calcolo di una tratta (casa ↔ sede, con soste), con richieste superate ignorate e dati del
// percorso sempre coerenti con l'indirizzo e la sede correnti.

let contatoreSoste = 0;
// Ogni sosta ha un identificativo stabile (chiave di React); non fa parte dei dati inviati.
export const nuovaSosta = () => ({ uid: ++contatoreSoste, orario: '', luogo: '', descrizione: '', lat: null, lon: null });
export const sosteDaInviare = (soste) => soste.filter((s) => s.luogo.trim()).map(({ uid, ...resto }) => resto);

export const trattaVuota = () => ({
  sedeId: '', homeLabel: '', homeLat: null, homeLon: null, citta: '',
  km: '', geometria: null, alternative: [], scelta: 0, calcolando: false, errore: '',
});

// Solo le soste con un indirizzo validato diventano tappe del percorso, nell'ordine di orario:
// la stessa sequenza serve alla richiesta e alla chiave che decide se ricalcolare.
export function tappeOrdinate(soste) {
  return (soste || [])
    .filter((s) => s.lat != null && s.lon != null)
    .sort((a, b) => (a.orario || '99:99').localeCompare(b.orario || '99:99'));
}

export function useSedi() {
  const [sedi, setSedi] = useState([]);
  const [errore, setErrore] = useState('');
  const carica = useCallback(() => {
    setErrore('');
    api.get('/sedi').then((d) => setSedi(d.sedi)).catch((e) => setErrore(e.message || 'Impossibile caricare le sedi.'));
  }, []);
  useEffect(() => { carica(); }, [carica]);
  return { sedi, erroreSedi: errore, ricaricaSedi: carica };
}

// direzione: 'casa-sede' (andata) oppure 'sede-casa' (ritorno).
export function useTratta({ sedi, soste, direzione, utente }) {
  const [leg, setLeg] = useState(trattaVuota);
  const richiesta = useRef(0); // identifica l'ultimo calcolo: le risposte superate si ignorano

  // Sede e indirizzo di casa dal profilo, senza aspettare le sedi e senza sovrascrivere ciò che
  // l'utente ha già scelto nel frattempo.
  useEffect(() => {
    setLeg((p) => {
      let n = p;
      if (utente?.sede_id && !p.sedeId) n = { ...n, sedeId: String(utente.sede_id) };
      if (utente?.casa_lat != null && utente?.casa_lon != null && !p.homeLabel && p.homeLat == null) {
        n = { ...n, homeLabel: utente.indirizzo_casa || '', homeLat: utente.casa_lat, homeLon: utente.casa_lon, citta: utente.citta_casa || '' };
      }
      return n;
    });
  }, [utente]);

  const invalida = (p) => ({ ...p, km: '', geometria: null, alternative: [], scelta: 0, calcolando: false, errore: '' });

  const cambiaSede = (id) => { richiesta.current++; setLeg((p) => ({ ...invalida(p), sedeId: id })); };
  // Riscrivere l'indirizzo toglie coordinate, comune e dati del percorso del punto precedente.
  const cambiaTesto = (v) => { richiesta.current++; setLeg((p) => ({ ...invalida(p), homeLabel: v, homeLat: null, homeLon: null, citta: '' })); };
  const scegliIndirizzo = (place) => {
    setLeg((p) => ({
      ...p, homeLabel: place.label, homeLat: place.lat, homeLon: place.lon,
      // Una nuova selezione può non avere un comune (lo cancella); spostare lo spillo non lo tocca.
      citta: Object.prototype.hasOwnProperty.call(place, 'citta') ? (place.citta || '') : p.citta,
    }));
  };

  const ricalcola = useCallback(async () => {
    const mia = ++richiesta.current;
    const sede = sedi.find((s) => String(s.id) === String(leg.sedeId));
    if (!sede?.lat || !sede?.lon || !leg.homeLat || !leg.homeLon) { setLeg((p) => ({ ...p, calcolando: false })); return; }
    setLeg((p) => ({ ...p, calcolando: true, errore: '' }));
    const casa = { lat: leg.homeLat, lon: leg.homeLon };
    const puntoSede = { lat: sede.lat, lon: sede.lon };
    const da = direzione === 'sede-casa' ? puntoSede : casa;
    const a = direzione === 'sede-casa' ? casa : puntoSede;
    const tappe = tappeOrdinate([...(soste || [])]).map((s) => ({ lat: s.lat, lon: s.lon }));
    try {
      if (tappe.length > 0) {
        const d = await api.post('/geo/route-multi', { punti: [da, ...tappe, a] });
        if (mia !== richiesta.current) return;
        setLeg((p) => ({ ...p, km: d.km, geometria: d.geometria, alternative: [], scelta: 0, calcolando: false }));
      } else {
        const params = new URLSearchParams({ from_lat: da.lat, from_lon: da.lon, to_lat: a.lat, to_lon: a.lon });
        const d = await api.get(`/geo/route?${params.toString()}`);
        if (mia !== richiesta.current) return;
        setLeg((p) => ({ ...p, km: d.km, geometria: d.geometria, alternative: d.alternative || [], scelta: 0, calcolando: false }));
      }
    } catch (e) {
      if (mia !== richiesta.current) return;
      // Il percorso precedente non vale più: niente km né tracciato vecchi, si possono inserire a mano.
      setLeg((p) => ({ ...invalida(p), errore: 'Impossibile calcolare il percorso, inserisci i km manualmente.' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedi, leg.sedeId, leg.homeLat, leg.homeLon, soste, direzione]);

  // La chiave segue la sequenza di tappe nell'ordine usato per il percorso: cambia se cambiano le
  // coordinate o l'ordine di orario, non per una lettera in una descrizione.
  const chiaveSoste = tappeOrdinate([...(soste || [])]).map((s) => `${s.lat},${s.lon}`).join('|');
  useEffect(() => {
    ricalcola();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.sedeId, leg.homeLat, leg.homeLon, sedi, chiaveSoste]);

  return { leg, setLeg, ricalcola, cambiaSede, cambiaTesto, scegliIndirizzo };
}
