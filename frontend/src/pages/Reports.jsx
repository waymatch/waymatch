import React, { useEffect, useState, useCallback, useRef } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Leaf, Route, Wallet, Users, FileDown, FileSpreadsheet } from 'lucide-react';
import { api, scaricaFile } from '../api.js';
import { useBranding } from '../context/BrandingContext.jsx';
import Avatar from '../components/Avatar.jsx';

export default function Reports() {
  const { branding: { gamification } } = useBranding();
  const [sedi, setSedi] = useState([]);
  const [sedeId, setSedeId] = useState('');
  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  // Il report si associa ai filtri che lo hanno prodotto: cambiandoli non si mostra quello vecchio.
  const [risultato, setRisultato] = useState(null); // { chiave, report }
  const [caricamento, setCaricamento] = useState(true);
  // Errori separati: il successo di un'operazione non nasconde il fallimento dell'altra.
  const [error, setError] = useState('');          // caricamento del report
  const [erroreExport, setErroreExport] = useState('');
  const [erroreSedi, setErroreSedi] = useState('');
  const richiesta = useRef(0); // identifica l'ultimo caricamento: le risposte superate si ignorano

  const caricaSedi = useCallback(() => {
    setErroreSedi('');
    api.get('/sedi').then((d) => setSedi(d.sedi)).catch((e) => setErroreSedi(e.message || 'Impossibile caricare le sedi.'));
  }, []);
  useEffect(() => { caricaSedi(); }, [caricaSedi]);

  const chiave = `${sedeId}|${dal}|${al}`;
  const report = risultato && risultato.chiave === chiave ? risultato.report : null;

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (sedeId) params.set('sede_id', sedeId);
    if (dal) params.set('dal', dal);
    if (al) params.set('al', al);
    const mia = ++richiesta.current;
    setError('');
    setCaricamento(true);
    api.get(`/reports/summary?${params.toString()}`)
      .then((d) => { if (mia !== richiesta.current) return; setRisultato({ chiave: `${sedeId}|${dal}|${al}`, report: d }); setError(''); })
      .catch((e) => { if (mia === richiesta.current) setError(e.message); })
      .finally(() => { if (mia === richiesta.current) setCaricamento(false); });
  }, [sedeId, dal, al]);
  useEffect(() => { load(); }, [load]);

  const meseData = report ? Object.entries(report.per_mese).map(([mese, v]) => ({
    mese, km: Math.round(v.km), co2: Math.round(v.co2_kg), costo: Math.round(v.costo),
  })).sort((a, b) => a.mese.localeCompare(b.mese)) : [];

  const sedeData = report ? Object.entries(report.per_sede).map(([sede, v]) => ({
    sede, km: Math.round(v.km), co2: Math.round(v.co2_kg), costo: Math.round(v.costo),
  })) : [];

  const [exporting, setExporting] = useState('');

  const esporta = async (formato) => {
    setExporting(formato);
    setErroreExport('');
    try {
      const params = new URLSearchParams();
      if (sedeId) params.set('sede_id', sedeId);
      if (dal) params.set('dal', dal);
      if (al) params.set('al', al);
      await scaricaFile(`/reports/export/${formato}?${params.toString()}`, `report-carpooling.${formato}`);
    } catch (e) {
      setErroreExport(e.message);
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl">Benefici del carpooling</h1>
          <p className="text-muted text-sm mt-0.5">CO2, chilometri e costi risparmiati grazie ai viaggi condivisi.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline !text-xs" disabled={exporting} onClick={() => esporta('xlsx')}>
            <FileSpreadsheet size={14} /> {exporting === 'xlsx' ? 'Esporto...' : 'Excel'}
          </button>
          <button className="btn-outline !text-xs" disabled={exporting} onClick={() => esporta('pdf')}>
            <FileDown size={14} /> {exporting === 'pdf' ? 'Esporto...' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="reports-0" className="label">Sede</label>
          <select id="reports-0" className="input" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            <option value="">Tutte le sedi</option>
            {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          {erroreSedi && (
            <div className="mt-1 flex items-center gap-2 text-xs text-danger" role="alert">
              <span>{erroreSedi}</span>
              <button type="button" className="underline text-primary" onClick={caricaSedi}>Riprova</button>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-[120px]">
          <label htmlFor="reports-1" className="label">Dal</label>
          <input id="reports-1" type="date" className="input" value={dal} onChange={(e) => setDal(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label htmlFor="reports-2" className="label">Al</label>
          <input id="reports-2" type="date" className="input" value={al} onChange={(e) => setAl(e.target.value)} />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {erroreExport && <ErrorBanner message={`Esportazione non riuscita: ${erroreExport}`} />}

      {!report ? (
        caricamento ? (
          <div className="card animate-pulse h-32" />
        ) : (
          <div className="card text-center py-8 space-y-3">
            <p className="text-sm text-muted">Non è stato possibile caricare il report con questi filtri.</p>
            <button type="button" className="btn-outline !text-xs" onClick={load}>Riprova</button>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi icon={Leaf} label="CO2 risparmiata" value={`${report.totali.co2_kg_risparmiata} kg`} />
            <Kpi icon={Route} label="Km risparmiati" value={report.totali.km_risparmiati} />
            <Kpi icon={Wallet} label="Costo risparmiato" value={`€ ${report.totali.costo_risparmiato_eur}`} />
            <Kpi icon={Users} label="Viaggi completati" value={report.totali.viaggi_completati} />
          </div>

          {(meseData.length > 0 || sedeData.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {meseData.length > 0 && (
                <div className="card">
                  <h2 className="font-display font-semibold text-sm mb-4">CO2 risparmiata per mese (kg)</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={meseData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E6EAEE" vertical={false} />
                      <XAxis dataKey="mese" tick={{ fontSize: 12, fill: '#5B6B70' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#5B6B70' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E6EAEE' }} />
                      <Bar dataKey="co2" fill="#14424F" radius={[6, 6, 0, 0]} name="CO2 (kg)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {sedeData.length > 0 && (
                <div className="card">
                  <h2 className="font-display font-semibold text-sm mb-4">Confronto tra sedi</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={sedeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E6EAEE" vertical={false} />
                      <XAxis dataKey="sede" tick={{ fontSize: 12, fill: '#5B6B70' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#5B6B70' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E6EAEE' }} />
                      <Bar dataKey="km" fill="#3CC8B8" radius={[6, 6, 0, 0]} name="Km risparmiati" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h2 className="font-display font-semibold text-sm mb-3">Utenti più attivi</h2>
            <div className="divide-y divide-border">
              {report.top_utenti.map((u, i) => (
                <div key={u.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="w-6 text-center text-sm text-muted">{i + 1}</span>
                  <Avatar id={u.id} nome={u.nome} cognome={u.cognome} versione={u.foto_versione} dimensione="xs" />
                  <span className="flex-1 text-sm truncate">{u.nome} {u.cognome}</span>
                  <span className="text-sm text-primary">{gamification ? `${u.punti} pt` : `${u.viaggi} viaggi`}</span>
                </div>
              ))}
            </div>
          </div>

          {report.metodo && report.qualita && <MetodoEQualita metodo={report.metodo} q={report.qualita} />}
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }) {
  return (
    <div className="card">
      <Icon size={18} className="text-primary mb-2" />
      <p className="font-display font-bold text-xl leading-none">{value}</p>
      <p className="text-xs text-muted mt-1.5">{label}</p>
    </div>
  );
}

// Come sono stati calcolati i numeri e quanto sono solidi i dati: lo stesso che sta nell'export.
function MetodoEQualita({ metodo, q }) {
  const quota = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : 'n.d.');
  return (
    <div className="card space-y-2 text-sm">
      <h2 className="font-display font-semibold text-sm">Metodo e qualità dei dati</h2>
      <p className="text-xs text-muted">
        {metodo.nome}: conta la CO2 che i passeggeri con check-in non hanno emesso lasciando a casa la
        propria auto, al netto della deviazione dell'autista; solo CO2 allo scarico. Fattori: {metodo.fonte_fattori},
        valori {metodo.fonte_anno} ({metodo.fonte_licenza}). Stime per il monitoraggio interno, non una certificazione.
        Il testo completo è in Informazioni → Metodo di calcolo.
      </p>
      <ul className="text-xs text-muted space-y-0.5 list-disc pl-5">
        <li>{q.viaggi_con_km_verificati} viaggi su {q.viaggi_completati} ({quota(q.viaggi_con_km_verificati, q.viaggi_completati)}) hanno i chilometri verificati dal server{q.viaggi_con_deviazione_non_calcolabile > 0 ? `; per ${q.viaggi_con_deviazione_non_calcolabile} la deviazione dell'autista non è calcolabile` : ''}.</li>
        <li>{q.passeggeri_conteggiati} passeggeri su {q.passeggeri_completati} contano nel calcolo{q.esclusi_scenario + q.esclusi_senza_auto > 0 ? ` (${q.esclusi_scenario} non avrebbero usato l'auto, ${q.esclusi_senza_auto} senza auto indicata)` : ''}.</li>
        <li>Fattore di emissione: {q.fattori.segmento_euro} per segmento e classe Euro, {q.fattori.alimentazione} per alimentazione, {q.fattori.media} auto media.</li>
      </ul>
    </div>
  );
}
