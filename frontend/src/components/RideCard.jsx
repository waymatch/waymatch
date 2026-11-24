import React, { useState, useId } from 'react';
import { MapPin, Flag, Star, Users, Coffee, ChevronDown, Car, Check, Clock } from 'lucide-react';
import { api } from '../api.js';
import RouteMap from './RouteMap.jsx';
import { dataISO } from '../dateTimeUtils.js';
import AddressAutocomplete from './AddressAutocomplete.jsx';

function formatGiorno(dataStr) {
  // Calendario locale (toISOString userebbe l'UTC: dopo mezzanotte darebbe il giorno prima); per
  // "domani" si avanza il giorno di calendario, non di 24 ore (cambio ora legale).
  const oggi = dataISO(0);
  const domani = dataISO(1);
  if (dataStr === oggi) return 'Oggi';
  if (dataStr === domani) return 'Domani';
  return new Date(dataStr).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

// soglia: distanza massima (in metri) tra il percorso del passaggio e casa dell'utente
// per considerarlo "pertinente" e mostrare il badge — null/undefined per non valutarlo
// (es. nella lista dei propri passaggi offerti, dove non ha senso).
export default function RideCard({ ride, onChanged, soglia }) {
  const idSalita = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [modoSalita, setModoSalita] = useState('standard'); // standard | sosta | libero
  const [sostaScelta, setSostaScelta] = useState('');
  const [indirizzoLibero, setIndirizzoLibero] = useState('');
  const [chiedeConferma, setChiedeConferma] = useState(false);
  const [preferito, setPreferito] = useState(!!ride.preferito);
  const [cambiandoPreferito, setCambiandoPreferito] = useState(false);

  const pertinente = soglia != null && ride.distanza_casa_m != null && ride.distanza_casa_m <= soglia;
  const richiesteInSospeso = ride.richieste_in_sospeso ?? 0;
  const pienoOSaturato = ride.posti_disponibili <= 0;
  const miaRichiesta = ride.mia_prenotazione; // null | 'richiesto' | 'confermato' | 'lista_attesa' | 'rifiutato' | 'annullato'
  const richiestaAttiva = ['richiesto', 'confermato', 'lista_attesa'].includes(miaRichiesta);
  const richiestaPrecedenteConclusa = miaRichiesta === 'annullato' || miaRichiesta === 'rifiutato';

  const richiedi = async (e) => {
    e.stopPropagation();
    if (richiestaPrecedenteConclusa && !chiedeConferma) {
      setChiedeConferma(true);
      return;
    }
    // Se ci sono soste tra cui scegliere il punto di salita/discesa e la card è ancora
    // chiusa, il primo click la apre invece di inviare subito la richiesta "al buio".
    if (!open && ride.soste && ride.soste.length > 0) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setMsg('');
    const puntoSalita = modoSalita === 'sosta' ? sostaScelta : modoSalita === 'libero' ? indirizzoLibero : null;
    try {
      const res = await api.post(`/bookings/rides/${ride.id}/book`, { punto_salita: puntoSalita || null });
      setMsg(res.lista_attesa
        ? 'Sei in lista d\'attesa: ti avviseremo se si libera un posto.'
        : 'Richiesta inviata!');
      setChiedeConferma(false);
      onChanged && onChanged();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const accentColor = ride.tipo === 'andata' ? 'bg-primary' : 'bg-accent';

  // ride.preferito arriva solo dalla lista dei passaggi altrui (Home/Cerca): nella
  // propria lista di offerte questo campo non esiste, e la stella non ha senso lì.
  const togglePreferito = async (e) => {
    e.stopPropagation();
    if (cambiandoPreferito) return;
    setCambiandoPreferito(true);
    const nuovoValore = !preferito;
    setPreferito(nuovoValore); // ottimistico
    try {
      if (nuovoValore) {
        await api.post('/favorites', { driver_id: ride.driver_id, tipo: ride.tipo });
      } else {
        await api.del(`/favorites/${ride.driver_id}/${ride.tipo}`);
      }
    } catch (e) {
      setPreferito(!nuovoValore); // rollback in caso di errore
    } finally {
      setCambiandoPreferito(false);
    }
  };

  // Il lato "domicilio" (indirizzo privato dell'autista) è punto_partenza per un'andata,
  // punto_arrivo per un ritorno; l'altro lato è sempre il nome della sede, già sintetico.
  // Prima di aprire la card mostriamo solo la città, non la via completa: l'indirizzo
  // esatto compare comunque nell'opzione "standard" del punto di salita qui sotto.
  const indirizzoCompleto = ride.tipo === 'andata' ? ride.punto_partenza : ride.punto_arrivo;
  const cittaDomicilio = ride.citta_domicilio || indirizzoCompleto;
  const partenzaMostrata = ride.tipo === 'andata' ? cittaDomicilio : ride.punto_partenza;
  const arrivoMostrato = ride.tipo === 'andata' ? ride.punto_arrivo : cittaDomicilio;

  return (
    <div className="card p-0">
      {/* overflow-hidden solo su questa riga (per arrotondare la strisciolina colorata agli
          angoli superiori), non sull'intera card: altrimenti, a card aperta, taglierebbe il
          menu a tendina dell'indirizzo "altro" che deve poter uscire sotto il riquadro. */}
      <div className="flex items-stretch rounded-t-card overflow-hidden">
        <div className={`w-1.5 ${accentColor} shrink-0`} />
        {ride.preferito !== undefined && (
          <button
            onClick={togglePreferito}
            title={preferito ? 'Rimuovi dai passaggi preferiti' : 'Aggiungi ai passaggi preferiti'} aria-label={preferito ? 'Rimuovi dai passaggi preferiti' : 'Aggiungi ai passaggi preferiti'}
            className={`flex items-center px-2.5 shrink-0 ${preferito ? 'text-accent-dark' : 'text-muted hover:text-accent-dark'}`}
          >
            <Star size={16} fill={preferito ? 'currentColor' : 'none'} />
          </button>
        )}
        <button className="flex-1 min-w-0 text-left p-4" onClick={() => setOpen((v) => !v)}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-semibold text-base">{formatGiorno(ride.data)}</span>
                <span className="text-sm text-muted flex items-center gap-1"><Clock size={12} /> {ride.ora}</span>
                <span className="badge-primary">{ride.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <p className="text-sm text-muted flex items-center gap-1 min-w-0">
                  <MapPin size={13} className="shrink-0" />
                  <span className="truncate min-w-0">{partenzaMostrata}</span>
                </p>
                <p className="text-sm text-muted flex items-center gap-1 min-w-0">
                  <Flag size={13} className="shrink-0" />
                  <span className="truncate min-w-0">{arrivoMostrato}</span>
                </p>
              </div>
              <p className="text-xs text-muted mt-1">{ride.driver_nome} {ride.driver_cognome}</p>
            </div>
            <ChevronDown size={16} className={`text-muted transition-transform shrink-0 mt-1 ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>
      </div>

      <div className="px-4 pb-4 flex items-center gap-3 flex-wrap">
        <span className={`badge ${pienoOSaturato ? 'bg-danger/10 text-danger' : 'badge-accent'}`}>
          <Users size={12} /> {ride.posti_disponibili}/{ride.posti_totali} liberi
        </span>
        {pertinente && (
          <span className="badge bg-primary-light text-primary-dark">
            <MapPin size={12} /> Sul tuo percorso
          </span>
        )}
        {richiesteInSospeso > 0 && (
          <span className="text-xs text-muted">{richiesteInSospeso} {richiesteInSospeso === 1 ? 'richiesta in attesa' : 'richieste in attesa'}</span>
        )}
        {richiestaAttiva ? (
          <span className={`badge ml-auto whitespace-nowrap ${miaRichiesta === 'confermato' ? 'badge-primary' : 'bg-border text-muted'}`}>
            {miaRichiesta === 'confermato' ? <><Check size={12} /> Confermato</>
              : miaRichiesta === 'richiesto' ? 'Richiesta inviata'
              : 'In lista d\'attesa'}
          </span>
        ) : (
          <button
            className={`whitespace-nowrap ${chiedeConferma ? 'btn-accent !py-1.5 !px-3 ml-auto' : 'btn-primary !py-1.5 !px-3 ml-auto'}`}
            disabled={busy}
            onClick={richiedi}
          >
            {busy ? 'Invio...'
              : chiedeConferma ? 'Conferma nuova richiesta'
              : !open && ride.soste && ride.soste.length > 0 ? 'Vedi dettagli e richiedi'
              : pienoOSaturato ? 'Iscriviti in lista d\'attesa'
              : <><Check size={14} /> Richiedi</>}
          </button>
        )}
        {chiedeConferma && (
          <button className="btn-ghost !py-1.5 !text-xs text-muted" onClick={(e) => { e.stopPropagation(); setChiedeConferma(false); }}>
            Annulla
          </button>
        )}
      </div>
      {chiedeConferma && (
        <p className="px-4 pb-3 text-xs text-muted -mt-2">Avevi già richiesto questo passaggio in precedenza. Confermi di volerlo richiedere di nuovo?</p>
      )}
      {msg && <p className="px-4 pb-3 text-xs text-muted -mt-2">{msg}</p>}

      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-border">
          <div className="mt-3">
            <RouteMap
              points={ride.geometria}
              markers={
                ride.partenza_lat && ride.arrivo_lat
                  ? [
                      { position: [ride.partenza_lat, ride.partenza_lon] },
                      { position: [ride.arrivo_lat, ride.arrivo_lon] },
                    ]
                  : []
              }
            />
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm">
            <Car size={15} className="text-muted" />
            <span>
              {ride.auto_marca || ride.auto_modello
                ? `${ride.auto_marca || ''} ${ride.auto_modello || ''}`.trim()
                : 'Auto non specificata'}
              {ride.auto_colore ? ` · ${ride.auto_colore}` : ''}
            </span>
          </div>

          {ride.km_stimati > 0 && (
            <p className="text-xs text-muted mt-2">Tragitto stimato: {ride.km_stimati} km</p>
          )}
          {ride.note && <p className="text-sm mt-2">{ride.note}</p>}

          {ride.soste && ride.soste.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {ride.soste.map((s) => (
                <div key={s.id} className="flex items-start gap-2 text-sm text-muted">
                  <Coffee size={14} className="mt-0.5 shrink-0 text-accent-dark" />
                  <span>{s.orario ? `${s.orario} — ` : ''}{s.luogo}{s.descrizione ? ` (${s.descrizione})` : ''}</span>
                </div>
              ))}
            </div>
          )}

          {!richiestaAttiva && (
            <div className="mt-3">
              <label htmlFor={idSalita} className="text-xs text-muted mb-1 block">Dove sali/scendi? (facoltativo)</label>
              <select
                id={idSalita}
                className="input !py-1.5 !text-xs"
                value={modoSalita === 'sosta' ? sostaScelta : modoSalita}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'standard' || v === 'libero') { setModoSalita(v); setSostaScelta(''); }
                  else { setModoSalita('sosta'); setSostaScelta(v); }
                }}
              >
                <option value="standard">Standard: {indirizzoCompleto}</option>
                {ride.soste?.map((s) => <option key={s.id} value={s.luogo}>{s.luogo}</option>)}
                <option value="libero">Altro indirizzo...</option>
              </select>
              {modoSalita === 'libero' && (
                <div className="mt-2">
                  <AddressAutocomplete
                    value={indirizzoLibero}
                    onChange={setIndirizzoLibero}
                    onSelect={(place) => setIndirizzoLibero(place.label)}
                    placeholder="Cerca un indirizzo lungo il tragitto..."
                    correggibile={false}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
