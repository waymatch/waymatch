import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Gift, Trophy, Medal, History, QrCode } from 'lucide-react';
import { api, caricaImmagineAutenticata } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { dataLocale } from '../dateTimeUtils.js';
import Avatar from '../components/Avatar.jsx';

const PERIODI = [
  { value: '7', label: '7 giorni' },
  { value: '30', label: '1 mese' },
  { value: '90', label: '3 mesi' },
  { value: '180', label: '6 mesi' },
  { value: '365', label: '1 anno' },
  { value: '', label: 'Da sempre' },
];

const STATO_LABEL = {
  in_attesa: 'In attesa',
  approvato: 'Approvato',
  rifiutato: 'Rifiutato',
  consegnato: 'Consegnato',
  annullato: 'Annullato (punteggi azzerati)',
};
const STATO_COLORE = {
  in_attesa: 'bg-accent-light text-accent-dark',
  approvato: 'bg-primary-light text-primary-dark',
  rifiutato: 'bg-danger/10 text-danger',
  consegnato: 'bg-primary-light text-primary-dark',
  annullato: 'bg-border text-muted',
};

export default function Rewards() {
  const { user } = useAuth();
  const [rewards, setRewards] = useState(null);
  const [punti, setPunti] = useState(0);
  const [puntiGuadagnati, setPuntiGuadagnati] = useState(0);
  const [classifica, setClassifica] = useState(null);
  const [periodo, setPeriodo] = useState('30');
  const [contests, setContests] = useState(null);
  const [storico, setStorico] = useState(null);
  const [msg, setMsg] = useState('');
  const [erroreCarica, setErroreCarica] = useState('');
  const [erroreClassifica, setErroreClassifica] = useState('');
  const [riscattando, setRiscattando] = useState(false);
  const inRiscatto = useRef(false);        // blocca un secondo invio dello stesso gesto, prima del rendering
  const richiestaClassifica = useRef(0);   // identifica l'ultima classifica richiesta
  const richiestaCaricamento = useRef(0);  // identifica l'ultimo caricamento: le risposte superate si ignorano

  const load = useCallback(() => {
    setErroreCarica('');
    const mia = ++richiestaCaricamento.current;
    const ancora = () => mia === richiestaCaricamento.current;
    const errore = (e) => { if (ancora()) setErroreCarica(e.message || 'Impossibile caricare i premi.'); };
    api.get('/rewards').then((d) => { if (ancora()) { setRewards(d.rewards); setPunti(d.punti_disponibili); } }).catch(errore);
    api.get('/auth/me').then((d) => { if (ancora()) setPuntiGuadagnati(d.punti_guadagnati); }).catch(errore);
    api.get('/contests').then((d) => { if (ancora()) setContests(d.contests); }).catch(errore);
    api.get('/rewards/redemptions/mie').then((d) => { if (ancora()) setStorico(d.redemptions); }).catch(errore);
  }, []);
  useEffect(() => { load(); }, [load]);

  const caricaClassifica = useCallback(() => {
    const mia = ++richiestaClassifica.current;
    setErroreClassifica('');
    setClassifica(null); // cambiando periodo non resta quella del periodo precedente
    const params = periodo ? `?periodo_giorni=${periodo}` : '';
    api.get(`/points/classifica${params}`)
      .then((d) => { if (mia === richiestaClassifica.current) setClassifica(d.classifica); })
      .catch((e) => { if (mia === richiestaClassifica.current) setErroreClassifica(e.message || 'Impossibile caricare la classifica.'); });
  }, [periodo]);
  useEffect(() => { caricaClassifica(); }, [caricaClassifica]);

  const redeem = async (id) => {
    if (inRiscatto.current) return; // un doppio clic non deve addebitare due volte
    inRiscatto.current = true;
    setRiscattando(true);
    setMsg('');
    try {
      await api.post(`/rewards/${id}/redeem`);
      setMsg('Richiesta di riscatto inviata! Il Mobility Manager la valuterà a breve.');
      load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      inRiscatto.current = false;
      setRiscattando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl">Premi e classifica</h1>
        <p className="text-muted text-sm mt-0.5">Guadagna punti offrendo e condividendo passaggi.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card bg-primary text-white border-none">
          <p className="text-xs opacity-80 uppercase tracking-wide">Saldo spendibile</p>
          <p className="font-display font-bold text-3xl mt-0.5">{punti}</p>
          <p className="text-xs opacity-70 mt-1">Usa questi per i premi</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted uppercase tracking-wide">Totale guadagnato</p>
          <p className="font-display font-bold text-3xl mt-0.5 text-primary">{puntiGuadagnati}</p>
          <p className="text-xs text-muted mt-1">Conta per la classifica</p>
        </div>
      </div>

      {contests && contests.length > 0 && (
        <section>
          <SectionTitle icon={Trophy} title="Contest attivi" />
          <div className="space-y-3">
            {contests.map((c) => (
              <div key={c.id} className="card">
                <p className="font-semibold text-sm">{c.nome}</p>
                <p className="text-xs text-muted mt-0.5">
                  {dataLocale(c.data_inizio).toLocaleDateString('it-IT')} – {dataLocale(c.data_fine).toLocaleDateString('it-IT')}
                  {c.sede_nome ? ` · ${c.sede_nome}` : ' · tutte le sedi'}
                </p>
                {c.descrizione && <p className="text-sm mt-2">{c.descrizione}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle icon={Gift} title="Catalogo premi" />
        {erroreCarica && (
          <div className="mb-3 flex items-center justify-between gap-2 text-sm text-danger" role="alert">
            <span>{erroreCarica}</span>
            <button type="button" className="btn-outline !py-1 !text-xs shrink-0" onClick={load}>Riprova</button>
          </div>
        )}
        {rewards === null ? (
          erroreCarica ? null : <div className="card animate-pulse h-16" />
        ) : rewards.length === 0 ? (
          <div className="card text-center py-6 text-sm text-muted">Nessun premio configurato al momento.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rewards.map((r) => (
              <div key={r.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{r.nome}</p>
                  {r.descrizione && <p className="text-xs text-muted mt-0.5">{r.descrizione}</p>}
                </div>
                <button
                  type="button"
                  className="btn-accent shrink-0"
                  disabled={punti < r.punti_richiesti || riscattando}
                  onClick={() => redeem(r.id)}
                >
                  {r.punti_richiesti} pt
                </button>
              </div>
            ))}
          </div>
        )}
        {msg && <p className="text-sm text-muted mt-3">{msg}</p>}
      </section>

      {storico && storico.length > 0 && (
        <section>
          <SectionTitle icon={History} title="I tuoi riscatti" />
          <div className="card divide-y divide-border">
            {storico.map((s) => (
              <div key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.reward_nome}</p>
                    <p className="text-xs text-muted">{new Date(s.created_at).toLocaleDateString('it-IT')} · {s.punti_richiesti} pt</p>
                  </div>
                  <span className={`badge shrink-0 ${STATO_COLORE[s.stato] || 'bg-border text-muted'}`}>{STATO_LABEL[s.stato] || s.stato}</span>
                </div>
                {s.codice_voucher && <VoucherViewer redemptionId={s.id} codice={s.codice_voucher} />}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <SectionTitle icon={Medal} title="Classifica" />
          <select aria-label="Periodo della classifica" className="input !w-auto !py-1.5 !text-sm" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODI.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        {erroreClassifica ? (
          <div className="card text-center py-6 space-y-3" role="alert">
            <p className="text-sm text-danger">{erroreClassifica}</p>
            <button type="button" className="btn-outline !text-xs" onClick={caricaClassifica}>Riprova</button>
          </div>
        ) : classifica === null ? (
          <div className="card animate-pulse h-16" />
        ) : (
          <div className="card divide-y divide-border">
            {classifica.slice(0, 10).map((c, i) => (
              <div key={c.id} className={`flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 ${c.id === user.id ? 'font-semibold' : ''}`}>
                <span className="w-6 text-center text-sm text-muted">{i + 1}</span>
                <Avatar id={c.id} nome={c.nome} cognome={c.cognome} versione={c.foto_versione} dimensione="xs" />
                <span className="flex-1 text-sm truncate">{c.nome} {c.cognome}</span>
                <span className="text-sm text-primary">{c.punti} pt</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={16} className="text-muted" />
      <h2 className="font-display font-semibold text-sm">{title}</h2>
    </div>
  );
}

function VoucherViewer({ redemptionId, codice }) {
  const [aperto, setAperto] = useState(false);
  const [imgUrl, setImgUrl] = useState(null);
  const [caricando, setCaricando] = useState(false);
  const [errore, setErrore] = useState('');
  // L'object URL del voucher si revoca quando cambia o quando il componente si smonta.
  const urlCorrente = useRef(null);
  useEffect(() => () => { if (urlCorrente.current) URL.revokeObjectURL(urlCorrente.current); }, []);

  const apri = async () => {
    if (aperto) { setAperto(false); return; }
    setAperto(true);
    if (imgUrl) return;
    setCaricando(true);
    setErrore('');
    try {
      const url = await caricaImmagineAutenticata(`/rewards/redemptions/${redemptionId}/voucher-image`);
      if (urlCorrente.current) URL.revokeObjectURL(urlCorrente.current);
      urlCorrente.current = url;
      setImgUrl(url);
    } catch (e) {
      setErrore(e.message);
    } finally {
      setCaricando(false);
    }
  };

  return (
    <div className="mt-2">
      <button type="button" className="text-xs text-primary flex items-center gap-1" onClick={apri}>
        <QrCode size={13} /> {aperto ? 'Nascondi voucher' : 'Visualizza voucher digitale'}
      </button>
      {aperto && (
        <div className="mt-2">
          {caricando && <div className="card animate-pulse h-32" />}
          {errore && <p className="text-xs text-danger">{errore}</p>}
          {imgUrl && <img src={imgUrl} alt={`Voucher ${codice}`} className="rounded-xl border border-border w-full max-w-xs" />}
          <p className="text-xs text-muted mt-1.5">Codice: <span className="font-mono">{codice}</span></p>
        </div>
      )}
    </div>
  );
}
