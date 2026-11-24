import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Link } from 'react-router-dom';
import { Sunrise, Sunset, Trophy, Zap, Car, User, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { descriviGiorni } from '../giorni.js';
import { dataISO } from '../dateTimeUtils.js';
import RideCard from '../components/RideCard.jsx';
import RelevanceSlider from '../components/RelevanceSlider.jsx';
import QuickOfferModal from '../components/QuickOfferModal.jsx';
import { ordinaPerPertinenza, leggiSogliaSalvata, salvaSoglia } from '../relevance.js';

function formatGiorno(dataStr) {
  // Calendario locale (non UTC); domani = giorno di calendario successivo, non +24 ore.
  const oggi = dataISO(0);
  const domani = dataISO(1);
  if (dataStr === oggi) return 'Oggi';
  if (dataStr === domani) return 'Domani';
  return new Date(dataStr).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function Home() {
  const { user, punti } = useAuth();
  const { branding } = useBranding();
  const [giorni, setGiorni] = useState(5);
  // I passaggi si associano al periodo che li ha prodotti: cambiando periodo non si mostrano
  // quelli del periodo precedente come se fossero del nuovo.
  const [risultati, setRisultati] = useState(null); // { giorni, rides }
  const rides = risultati && risultati.giorni === giorni ? risultati.rides : null;
  const [prossimi, setProssimi] = useState(null);
  const [erroreProssimi, setErroreProssimi] = useState(false);
  const richiestaProssimi = useRef(0); // indipendente dal periodo: la risposta resta valida
  const [error, setError] = useState('');
  const [soglia, setSoglia] = useState(leggiSogliaSalvata);
  const [offertaRapida, setOffertaRapida] = useState(false);

  const richiesta = useRef(0); // identifica l'ultimo caricamento: le risposte superate si ignorano
  const [caricamento, setCaricamento] = useState(true);

  const load = useCallback(() => {
    if (!user?.sede_id) return;
    const mia = ++richiesta.current;
    setError('');
    setCaricamento(true);
    api.get(`/rides?home=1&giorni=${giorni}`)
      .then((d) => { if (mia === richiesta.current) { setRisultati({ giorni, rides: d.rides }); setError(''); } })
      .catch((e) => { if (mia === richiesta.current) setError(e.message); })
      .finally(() => { if (mia === richiesta.current) setCaricamento(false); });
  }, [user, giorni]);

  const caricaProssimi = useCallback(() => {
    if (!user?.sede_id) return;
    const mia = ++richiestaProssimi.current;
    setErroreProssimi(false);
    api.get('/rides/prossimi-miei')
      .then((d) => { if (mia === richiestaProssimi.current) setProssimi(d.prossimi); })
      .catch(() => { if (mia === richiestaProssimi.current) setErroreProssimi(true); });
  }, [user]);
  useEffect(() => { caricaProssimi(); }, [caricaProssimi]);

  useEffect(() => { load(); }, [load]);
  // Dopo un'azione sulle schede (che può durare) si ricarica con periodo e dati di adesso, non con
  // quelli del render in cui l'azione è iniziata.
  const ricaricaCorrente = useRef(null);
  ricaricaCorrente.current = () => { load(); caricaProssimi(); };
  const ricarica = useCallback(() => ricaricaCorrente.current(), []);

  if (!user?.sede_id) {
    return (
      <div className="card text-center py-10">
        <p className="font-display font-semibold text-lg">Imposta la tua sede</p>
        <p className="text-sm text-muted mt-1 max-w-xs mx-auto">
          Per vedere e offrire passaggi, indica prima a quale sede aziendale appartieni.
        </p>
        <Link to="/profilo" className="btn-primary mt-4 inline-flex">Vai al profilo</Link>
      </div>
    );
  }

  const andate = ordinaPerPertinenza((rides || []).filter((r) => r.tipo === 'andata'), soglia);
  const ritorni = ordinaPerPertinenza((rides || []).filter((r) => r.tipo === 'ritorno'), soglia);

  const cambiaSoglia = (v) => { setSoglia(v); salvaSoglia(v); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Ciao {user.nome} 👋</h1>
        <p className="text-muted text-sm mt-0.5">
          Passaggi nella tua sede{branding.giorni_lavorativi.length < 7 ? ` (giorni lavorativi: ${descriviGiorni(branding.giorni_lavorativi)})` : ''}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-light text-accent-dark flex items-center justify-center shrink-0">
            <Trophy size={18} />
          </div>
          <div>
            <p className="text-xl font-display font-bold leading-none">{punti}</p>
            <p className="text-xs text-muted mt-1">punti totali</p>
          </div>
        </div>
        <button onClick={() => setOffertaRapida(true)} className="card flex items-center gap-3 hover:border-primary transition-colors text-left">
          <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
            <Zap size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Offerta rapida</p>
          </div>
        </button>
      </div>

      {offertaRapida && (
        <QuickOfferModal
          onClose={() => setOffertaRapida(false)}
          onDone={() => { setOffertaRapida(false); ricarica(); }}
        />
      )}

      {erroreProssimi && (
        <div className="flex items-center justify-between gap-2 text-sm text-danger" role="alert">
          <span>Non è stato possibile caricare i tuoi prossimi passaggi.</span>
          <button type="button" className="btn-outline !py-1 !text-xs shrink-0" onClick={caricaProssimi}>Riprova</button>
        </div>
      )}

      {prossimi && prossimi.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-display font-semibold text-sm text-ink">I miei prossimi passaggi</h2>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {prossimi.map((p, i) => (
              <Link to={`/i-miei-viaggi?tab=${p.ruolo === 'autista' ? 'offerti' : 'prenotati'}`} key={`${p.ruolo}-${p.id}-${i}`} className="card flex items-center gap-3 hover:border-primary transition-colors">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${p.ruolo === 'autista' ? 'bg-primary-light text-primary-dark' : 'bg-accent-light text-accent-dark'}`}>
                  {p.ruolo === 'autista' ? <Car size={16} /> : <User size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {formatGiorno(p.data)} · {p.ora} · {p.tipo === 'andata' ? 'Andata' : 'Ritorno'}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {p.ruolo === 'autista' ? 'Offerto da te' : `Con ${p.driver_nome} ${p.driver_cognome}`}
                  </p>
                </div>
                <StatoBadgeProssimo p={p} />
                <ArrowRight size={15} className="text-muted shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1"><ErrorBanner message={error} /></div>
          <button type="button" className="btn-outline !py-1 !text-xs shrink-0" onClick={load}>Riprova</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-sm text-ink">Passaggi disponibili</h2>
        <select
          aria-label="Periodo dei passaggi mostrati"
          className="input !w-auto !py-1.5 !text-sm"
          value={giorni}
          onChange={(e) => setGiorni(Number(e.target.value))}
        >
          <option value={2}>Prossimi 2 giorni</option>
          <option value={5}>Prossimi 5 giorni</option>
          <option value={7}>Prossimi 7 giorni</option>
          <option value={10}>Prossimi 10 giorni</option>
        </select>
      </div>

      <RelevanceSlider user={user} value={soglia} onChange={cambiaSoglia} />

      <RideSection title="Passaggi andata" icon={Sunrise} rides={andate} loading={caricamento && rides === null} errore={!!error && rides === null} onChanged={ricarica} soglia={soglia} />
      <RideSection title="Passaggi ritorno" icon={Sunset} rides={ritorni} loading={caricamento && rides === null} errore={!!error && rides === null} onChanged={ricarica} soglia={soglia} />
    </div>
  );
}

function StatoBadgeProssimo({ p }) {
  if (p.ruolo === 'autista') {
    if (p.stato === 'in_approvazione') return <span className="badge bg-accent-light text-accent-dark shrink-0">In approvazione</span>;
    if (p.richieste_in_sospeso > 0) return <span className="badge bg-accent-light text-accent-dark shrink-0">{p.richieste_in_sospeso} {p.richieste_in_sospeso === 1 ? 'richiesta' : 'richieste'}</span>;
    return null;
  }
  if (p.booking_stato === 'confermato') return <span className="badge-primary shrink-0">Confermato</span>;
  if (p.booking_stato === 'richiesto') return <span className="badge bg-accent-light text-accent-dark shrink-0">In attesa</span>;
  if (p.booking_stato === 'lista_attesa') return <span className="badge bg-border text-muted shrink-0">Lista d'attesa</span>;
  return null;
}

function RideSection({ title, icon: Icon, rides, loading, errore, onChanged, soglia }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className="text-muted" />
        <h2 className="font-display font-semibold text-sm text-ink">{title}</h2>
      </div>
      {loading ? (
        <div className="card animate-pulse h-20" />
      ) : errore ? (
        <div className="card text-center py-6 text-sm text-muted">Non è stato possibile caricare i passaggi.</div>
      ) : rides.length === 0 ? (
        <div className="card text-center py-6 text-sm text-muted">
          Nessun passaggio disponibile nei prossimi giorni.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rides.map((r) => <RideCard key={r.id} ride={r} onChanged={onChanged} soglia={soglia} />)}
        </div>
      )}
    </div>
  );
}
