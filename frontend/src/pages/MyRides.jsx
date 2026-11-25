import React, { useEffect, useState, useCallback, useId } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import { Car, Check, X, Trash2, Flag, Phone, UserCheck, Pencil, Clock, Timer, Repeat, PauseCircle, PlayCircle } from 'lucide-react';
import { api } from '../api.js';
import EditRideModal from '../components/EditRideModal.jsx';
import { dataISO, dataLocale } from '../dateTimeUtils.js';
import { useBranding } from '../context/BrandingContext.jsx';

export default function MyRides() {
  const [searchParams] = useSearchParams();
  const tabIniziale = searchParams.get('tab');
  const [tab, setTab] = useState(['offerti', 'prenotati', 'storico', 'turni'].includes(tabIniziale) ? tabIniziale : 'offerti');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">I miei viaggi</h1>
        <p className="text-muted text-sm mt-0.5">Gestisci i passaggi offerti e quelli prenotati.</p>
      </div>

      <div className="flex gap-2 bg-bg p-1 rounded-xl w-fit border border-border flex-wrap">
        <TabButton active={tab === 'offerti'} onClick={() => setTab('offerti')}>Offerti</TabButton>
        <TabButton active={tab === 'prenotati'} onClick={() => setTab('prenotati')}>Prenotati</TabButton>
        <TabButton active={tab === 'turni'} onClick={() => setTab('turni')}>Turni fissi</TabButton>
        <TabButton active={tab === 'storico'} onClick={() => setTab('storico')}>Storico</TabButton>
      </div>

      {tab === 'offerti' && <OfferedRides />}
      {tab === 'prenotati' && <BookedRides />}
      {tab === 'turni' && <RecurringRides />}
      {tab === 'storico' && <Storico />}
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-surface shadow-sm text-primary' : 'text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function OfferedRides() {
  const { branding: { gamification } } = useBranding();
  const [rides, setRides] = useState(null);
  const [error, setError] = useState('');
  const [editRide, setEditRide] = useState(null);

  const load = useCallback(() => {
    api.get('/rides?mine=1').then((d) => setRides(d.rides)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const gestisciPrenotazione = async (bookingId, stato) => {
    try {
      await api.put(`/bookings/${bookingId}`, { stato });
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const toggleCheckIn = async (bookingId) => {
    try {
      await api.put(`/bookings/${bookingId}/check-in`);
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const completa = async (rideId) => {
    if (!confirm(gamification
      ? 'Segnare questo viaggio come completato? I punti verranno assegnati solo ai passeggeri con check-in effettuato.'
      : 'Segnare questo viaggio come completato? Contano solo i passeggeri con check-in effettuato.')) return;
    try {
      const res = await api.post(`/rides/${rideId}/completa`);
      if (res.stato === 'in_approvazione') {
        alert('Richiesta inviata: il viaggio è in attesa di approvazione da un Mobility Manager.');
      }
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const annulla = async (rideId) => {
    if (!confirm('Annullare questo passaggio? I passeggeri riceveranno una notifica.')) return;
    try {
      await api.del(`/rides/${rideId}`);
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const segnalaRitardo = async (rideId) => {
    const minuti = prompt('Di quanti minuti sei in ritardo?');
    if (!minuti) return;
    try {
      const res = await api.post(`/rides/${rideId}/ritardo`, { minuti: Number(minuti) });
      alert(res.avvisati > 0 ? `Avvisati ${res.avvisati} passeggeri.` : 'Nessun passeggero da avvisare (nessuno ancora in attesa di salire).');
    } catch (e) {
      alert(e.message);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (rides === null) return <div className="card animate-pulse h-24" />;
  if (rides.length === 0) return <EmptyState text="Non hai passaggi attivi al momento." />;

  return (
    <div className="space-y-3">
      {rides.map((r) => {
        const impegnati = (r.prenotazioni || []).filter((p) => ['richiesto', 'confermato'].includes(p.stato)).length;
        const daAvvisare = (r.prenotazioni || []).filter((p) => p.stato === 'confermato' && p.check_in !== 1).length;
        return (
          <div key={r.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-semibold">{r.ora}</span>
                  <span className="badge-primary">{r.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
                  <span className="text-xs text-muted">{dataLocale(r.data).toLocaleDateString('it-IT')}</span>
                  {r.stato === 'in_approvazione' && (
                    <span className="badge bg-accent-light text-accent-dark"><Clock size={11} /> In approvazione</span>
                  )}
                </div>
                <p className="text-sm text-muted mt-1">{r.punto_partenza} → {r.punto_arrivo}</p>
                <p className="text-xs text-muted mt-1">
                  Posti: {r.posti_totali - r.posti_disponibili}/{r.posti_totali} confermati
                </p>
              </div>
              {r.stato === 'attivo' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {daAvvisare > 0 && (
                    <button className="p-2 rounded-lg text-muted hover:bg-bg hover:text-accent-dark" title="Segnala ritardo" aria-label="Segnala ritardo" onClick={() => segnalaRitardo(r.id)}>
                      <Timer size={16} />
                    </button>
                  )}
                  <button className="btn-primary !px-2.5 !py-1.5 !text-xs whitespace-nowrap" title="Segna come completato" onClick={() => completa(r.id)}>
                    <Flag size={14} /> Completa
                  </button>
                  <button className="p-2 rounded-lg text-muted hover:bg-bg hover:text-primary" title="Modifica" aria-label="Modifica" onClick={() => setEditRide({ ride: r, minPosti: impegnati })}>
                    <Pencil size={16} />
                  </button>
                  <button className="p-2 rounded-lg text-muted hover:bg-bg hover:text-danger" title="Annulla" aria-label="Annulla" onClick={() => annulla(r.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>

            {r.prenotazioni?.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                {r.prenotazioni.map((p) => (
                  <div key={p.id} className={`flex items-center justify-between gap-2 ${['rifiutato', 'annullato', 'no_show'].includes(p.stato) ? 'opacity-60' : ''}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.nome} {p.cognome}</p>
                      <p className="text-xs text-muted">
                        <StatoLabel stato={p.stato} />
                        {p.punto_salita ? ` · sale/scende a: ${p.punto_salita}` : ''}
                      </p>
                    </div>
                    {p.stato === 'richiesto' && r.stato === 'attivo' && (
                      <div className="flex gap-1.5 shrink-0">
                        <button className="btn-primary !px-2.5 !py-1.5" aria-label={`Conferma la richiesta di ${p.nome}`} onClick={() => gestisciPrenotazione(p.id, 'confermato')}><Check size={14} /></button>
                        <button className="btn-outline !px-2.5 !py-1.5" aria-label={`Rifiuta la richiesta di ${p.nome}`} onClick={() => gestisciPrenotazione(p.id, 'rifiutato')}><X size={14} /></button>
                      </div>
                    )}
                    {p.stato === 'confermato' && r.stato === 'attivo' && (
                      <button
                        className={`btn !px-2.5 !py-1.5 !text-xs ${p.check_in ? 'bg-primary text-white' : 'btn-outline'}`}
                        onClick={() => toggleCheckIn(p.id)}
                        title="Segna come a bordo"
                      >
                        <UserCheck size={14} /> {p.check_in ? 'A bordo' : 'Check-in'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted mt-3 pt-3 border-t border-border">Nessuna richiesta ricevuta finora.</p>
            )}
          </div>
        );
      })}

      {editRide && (
        <EditRideModal
          ride={editRide.ride}
          minPosti={editRide.minPosti}
          onClose={() => setEditRide(null)}
          onSaved={() => { setEditRide(null); load(); }}
        />
      )}
    </div>
  );
}

function BookedRides() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/bookings/mie').then((d) => setBookings(d.bookings)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const annulla = async (id) => {
    try {
      await api.put(`/bookings/${id}`, { stato: 'annullato' });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const segnalaRitardo = async (bookingId) => {
    const minuti = prompt('Di quanti minuti sei in ritardo?');
    if (!minuti) return;
    try {
      await api.post(`/bookings/${bookingId}/ritardo`, { minuti: Number(minuti) });
      alert('Autista avvisato.');
    } catch (e) {
      alert(e.message);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (bookings === null) return <div className="card animate-pulse h-24" />;
  if (bookings.length === 0) return <EmptyState text="Non hai prenotazioni attive al momento." />;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {bookings.map((b) => (
        <div key={b.id} className="card flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-semibold">{dataLocale(b.data).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} · {b.ora}</span>
              <span className="badge-primary">{b.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
              <StatusBadge stato={b.stato} checkIn={b.check_in} />
            </div>
            <p className="text-sm text-muted mt-1">{b.punto_partenza} → {b.punto_arrivo}</p>
            {b.punto_salita && <p className="text-xs text-muted mt-0.5">Sale/scende a: {b.punto_salita}</p>}
            <p className="text-xs text-muted mt-1 flex items-center gap-1">
              <Car size={12} /> {b.driver_nome} {b.driver_cognome}
              {b.auto_marca && ` · ${b.auto_marca} ${b.auto_modello || ''}${b.auto_colore ? ` (${b.auto_colore})` : ''}`}
              {b.driver_telefono && <> · <Phone size={12} className="inline" /> {b.driver_telefono}</>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {b.stato === 'confermato' && !b.check_in && (
              <button className="p-2 rounded-lg text-muted hover:bg-bg hover:text-accent-dark" title="Segnala ritardo" aria-label="Segnala ritardo" onClick={() => segnalaRitardo(b.id)}>
                <Timer size={16} />
              </button>
            )}
            {['richiesto', 'confermato', 'lista_attesa'].includes(b.stato) && (
              <button type="button" className="p-2 text-muted hover:text-danger" aria-label={`Annulla la prenotazione del ${dataLocale(b.data).toLocaleDateString('it-IT')} alle ${b.ora}`} title="Annulla prenotazione" onClick={() => annulla(b.id)}><Trash2 size={16} aria-hidden="true" /></button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Storico() {
  const [offerti, setOfferti] = useState(null);
  const [prenotati, setPrenotati] = useState(null);
  const [errore, setErrore] = useState('');

  const carica = useCallback(() => {
    setErrore('');
    // Se una delle due richieste fallisce si mostra l'errore con "Riprova": non resta lo scheletro,
    // e non si presenta come completo uno storico di cui manca una metà.
    Promise.all([api.get('/rides?mine=1&storico=1'), api.get('/bookings/mie?storico=1')])
      .then(([o, p]) => { setOfferti(o.rides); setPrenotati(p.bookings); })
      .catch((e) => setErrore(e.message || 'Impossibile caricare lo storico.'));
  }, []);
  useEffect(() => { carica(); }, [carica]);

  if (errore) {
    return (
      <div className="card text-center py-8 space-y-3" role="alert">
        <p className="text-sm text-danger">{errore}</p>
        <button type="button" className="btn-outline !text-xs" onClick={carica}>Riprova</button>
      </div>
    );
  }
  const loading = offerti === null || prenotati === null;
  if (loading) return <div className="card animate-pulse h-24" />;

  const vuoto = offerti.length === 0 && prenotati.length === 0;
  if (vuoto) return <EmptyState text="Ancora nessun viaggio concluso." />;

  return (
    <div className="space-y-6">
      {offerti.length > 0 && (
        <section>
          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Offerti da te</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {offerti.map((r) => (
              <div key={r.id} className="card flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{dataLocale(r.data).toLocaleDateString('it-IT')} · {r.ora}</span>
                    <span className="badge-primary">{r.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{r.punto_partenza} → {r.punto_arrivo}</p>
                </div>
                <StatusBadge stato={r.stato} />
              </div>
            ))}
          </div>
        </section>
      )}
      {prenotati.length > 0 && (
        <section>
          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">A cui hai aderito</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {prenotati.map((b) => (
              <div key={b.id} className="card flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{dataLocale(b.data).toLocaleDateString('it-IT')} · {b.ora}</span>
                    <span className="badge-primary">{b.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{b.punto_partenza} → {b.punto_arrivo} · {b.driver_nome} {b.driver_cognome}</p>
                </div>
                <StatusBadge stato={b.stato} checkIn={b.check_in} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatoLabel({ stato }) {
  const label = {
    richiesto: 'In attesa di conferma',
    confermato: 'Confermato',
    lista_attesa: 'In lista d\'attesa',
    rifiutato: 'Rifiutata dall\'autista',
    annullato: 'Annullata dal passeggero',
    completato: 'Completato',
    no_show: 'Non salito a bordo',
  }[stato] || stato;
  return <span>{label}</span>;
}

function StatusBadge({ stato, checkIn }) {
  const map = {
    richiesto: 'bg-accent-light text-accent-dark',
    confermato: 'bg-primary-light text-primary-dark',
    lista_attesa: 'bg-border text-muted',
    rifiutato: 'bg-danger/10 text-danger',
    annullato: 'bg-border text-muted',
    completato: 'bg-primary-light text-primary-dark',
    no_show: 'bg-border text-muted',
    attivo: 'bg-primary-light text-primary-dark',
    in_approvazione: 'bg-accent-light text-accent-dark',
  };
  const label = stato === 'confermato' && checkIn ? 'a bordo' : stato === 'lista_attesa' ? 'lista d\'attesa' : stato.replace('_', ' ');
  return <span className={`badge ${map[stato] || 'bg-border text-muted'} capitalize`}>{label}</span>;
}

function EmptyState({ text }) {
  return (
    <div className="card text-center py-10 text-sm text-muted">{text}</div>
  );
}

const GIORNI_LABEL = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab', 7: 'Dom' };

function RecurringRides() {
  const [turni, setTurni] = useState(null);
  const [inPausa, setInPausa] = useState(false); // documenti del conducente da accettare
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/recurring-rides/mie').then((d) => { setTurni(d.turni); setInPausa(!!d.documenti_da_accettare); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleAttivo = async (t) => {
    if (t.attivo && !confirm('Sospendere questo turno fisso? I passaggi futuri già generati verranno annullati.')) return;
    try {
      await api.put(`/recurring-rides/${t.id}/attivo`, { attivo: t.attivo ? 0 : 1 });
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const elimina = async (id) => {
    if (!confirm('Eliminare definitivamente questo turno fisso?')) return;
    try {
      await api.del(`/recurring-rides/${id}`);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (turni === null) return <div className="card animate-pulse h-24" />;
  if (turni.length === 0) return <EmptyState text="Non hai ancora turni fissi. Puoi crearne uno dalla pagina Offri passaggio." />;

  return (
    <div className="space-y-3">
      {inPausa && turni.some((t) => t.attivo) && (
        <div role="status" className="rounded-xl border border-accent bg-accent-light text-accent-dark px-3.5 py-3 text-sm">
          <p className="font-semibold">I tuoi turni fissi sono in pausa</p>
          <p className="mt-1">
            Le corse già in calendario restano valide, ma non se ne generano di nuove finché non accetti i
            documenti del conducente aggiornati. Dopo l'accettazione i turni riprendono da soli.
          </p>
          <Link to="/offri" className="btn-primary !py-1.5 !text-sm inline-block mt-2">Leggi e accetta i documenti</Link>
        </div>
      )}
      {turni.map((t) => (
        <div key={t.id} className={`card ${!t.attivo ? 'opacity-60' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Repeat size={14} className="text-primary shrink-0" />
                <span className="font-display font-semibold text-sm">{t.ora}</span>
                <span className="badge-primary">{t.tipo === 'andata' ? 'Andata' : 'Ritorno'}</span>
                {!t.attivo && <span className="badge bg-border text-muted">Sospeso</span>}
                {!!t.attivo && inPausa && <span className="badge bg-border text-muted">In pausa</span>}
              </div>
              <p className="text-sm text-muted mt-1">{t.punto_partenza} → {t.punto_arrivo}</p>
              <p className="text-xs text-muted mt-1">
                {t.giorni_settimana.split(',').map((g) => GIORNI_LABEL[g]).join(', ')}
                {t.data_fine ? ` · fino al ${dataLocale(t.data_fine).toLocaleDateString('it-IT')}` : ' · a tempo indeterminato'}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button className="p-2 rounded-lg text-muted hover:bg-bg hover:text-primary" onClick={() => toggleAttivo(t)} title={t.attivo ? 'Sospendi' : 'Riattiva'}>
                {t.attivo ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
              </button>
              <button className="p-2 rounded-lg text-muted hover:bg-bg hover:text-danger" onClick={() => elimina(t.id)} title="Elimina">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {t.attivo && <TurnoEccezioni turno={t} />}
        </div>
      ))}
    </div>
  );
}

// Salta singole date (es. ferie, malattia di un giorno) senza sospendere l'intero turno.
function TurnoEccezioni({ turno }) {
  const [eccezioni, setEccezioni] = useState(null);
  const [erroreCarica, setErroreCarica] = useState('');
  const [nuovaData, setNuovaData] = useState('');
  const [saving, setSaving] = useState(false);
  const idData = useId();
  const oggi = dataISO(); // calendario locale

  // Un errore non svuota l'elenco: si tiene l'ultimo disponibile e si offre di riprovare.
  const load = useCallback(() => {
    setErroreCarica('');
    api.get(`/recurring-rides/${turno.id}/eccezioni`)
      .then((d) => setEccezioni(d.eccezioni))
      .catch((e) => setErroreCarica(e.message || 'Impossibile caricare le date saltate.'));
  }, [turno.id]);
  useEffect(() => { load(); }, [load]);

  const salta = async () => {
    if (!nuovaData) return;
    setSaving(true);
    try {
      await api.post(`/recurring-rides/${turno.id}/eccezioni`, { data: nuovaData });
      setNuovaData('');
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };
  const ripristina = async (data) => {
    try {
      await api.del(`/recurring-rides/${turno.id}/eccezioni/${data}`);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <label htmlFor={idData} className="block text-xs font-medium text-muted uppercase tracking-wide mb-2">Salta una data (ferie, malattia...)</label>
      <div className="flex gap-2 items-center flex-wrap">
        <input id={idData} type="date" min={oggi} className="input !w-auto !py-1.5 !text-xs" value={nuovaData} onChange={(e) => setNuovaData(e.target.value)} />
        <button type="button" className="btn-outline !py-1.5 !text-xs shrink-0" disabled={!nuovaData || saving} onClick={salta}>
          Salta questa data
        </button>
      </div>
      {erroreCarica && (
        <div className="mt-2 flex items-center gap-2 text-xs text-danger" role="alert">
          <span>{erroreCarica}</span>
          <button type="button" className="underline text-primary" onClick={load}>Riprova</button>
        </div>
      )}
      {eccezioni && eccezioni.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {eccezioni.map((d) => (
            <div key={d} className="flex items-center justify-between gap-2 text-xs text-muted">
              <span>{dataLocale(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} — saltata</span>
              <button type="button" className="text-primary shrink-0" onClick={() => ripristina(d)}>Ripristina</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
