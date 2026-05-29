import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Mic, MicOff, Loader2, CheckCircle2, Circle, Building2, MapPin, FileText, RotateCcw, ArrowRight, AlertCircle, Users, Calendar } from 'lucide-react';

const BACKEND_URL = 'https://redpar-backend.vercel.app';

const FidalLogo = () => (
  <div className="flex-shrink-0">
    <img
      src="/logo-fidal.png"
      alt="FIDAL Notaires"
      style={{ height: '105px', width: 'auto', display: 'block' }}
    />
  </div>
);

export default function App() {
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [pappersResults, setPappersResults] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [pappersLoading, setPappersLoading] = useState(false);
  const [pappersError, setPappersError] = useState(null);
  const [dvfStatus, setDvfStatus] = useState({});
  const [report, setReport] = useState(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSpeechSupported(false); return; }
    const r = new SR();
    r.lang = 'fr-FR'; r.continuous = false; r.interimResults = false;
    r.onresult = (e) => { setCompanyName(e.results[0][0].transcript); setIsListening(false); };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
  }, []);

  const toggleMicrophone = () => {
    if (!recognitionRef.current) return;
    if (isListening) { recognitionRef.current.stop(); setIsListening(false); }
    else { setIsListening(true); try { recognitionRef.current.start(); } catch (e) { setIsListening(false); } }
  };

  const searchRealApis = async () => {
    setPappersLoading(true); setPappersError(null); setPappersResults([]);
    const query = companyName.trim();
    try {
      const r = await fetch(`${BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      const data = await r.json();
      if (data.results && data.results.length > 0) setPappersResults(data.results);
      else setPappersError(`Aucune entreprise trouvée pour "${query}"`);
    } catch (e) { setPappersError(`Erreur : ${e.message}`); }
    finally { setPappersLoading(false); }
  };

  const goToStep1 = () => setStep(1);
  const goToStep2 = () => { if (companyName.trim().length < 2) return; setStep(2); searchRealApis(); };
  const selectCompany = (c) => setSelectedCompany(c);
  const confirmCompany = () => { if (!selectedCompany) return; setStep(3); startDvfSearch(); };

  const dvfTasks = [
    { id: 'parcelles', label: 'Parcelles détenues', icon: MapPin },
    { id: 'historique', label: 'Historique des transactions', icon: Calendar },
    { id: 'proprietaires', label: 'Propriétaires liés', icon: Users },
    { id: 'societes', label: 'Sociétés affiliées', icon: Building2 },
  ];

  const startDvfSearch = () => {
    const initial = {};
    dvfTasks.forEach(t => { initial[t.id] = 'pending'; });
    setDvfStatus(initial);
    dvfTasks.forEach((task, i) => {
      setTimeout(() => setDvfStatus(p => ({ ...p, [task.id]: 'running' })), i * 700);
      setTimeout(() => setDvfStatus(p => ({ ...p, [task.id]: 'done' })), i * 700 + 2200);
    });
    setTimeout(() => {
      // Données simulées : à brancher sur la vraie API DVF plus tard
      const mockReport = {
        parcelles: [
          { ref: '59368-000-AB-0042', commune: 'La Madeleine (59)', surface: 245, type: 'Bâti commercial', valeur: 1850000, dateAcquisition: '2010-05-12' },
          { ref: '59368-000-CD-0118', commune: 'La Madeleine (59)', surface: 320, type: 'Bâti + Terrain', valeur: 2340000, dateAcquisition: '2014-11-03' },
        ],
        transactions: [
          { date: '2010-05-12', type: 'Acquisition', parcelle: '59368-000-AB-0042', montant: 1450000, contrepartie: 'SCI ANCIENNE PROPRIÉTÉ' },
          { date: '2014-11-03', type: 'Acquisition', parcelle: '59368-000-CD-0118', montant: 1980000, contrepartie: 'M. ANDRÉ LEFEBVRE' },
        ],
        proprietairesLies: [],
        societesAffiliees: [],
      };
      setReport(mockReport);
      setStep(4);
    }, dvfTasks.length * 700 + 2500);
  };

  const resetAll = () => {
    setStep(1); setCompanyName(''); setPappersResults([]); setSelectedCompany(null);
    setPappersError(null); setDvfStatus({}); setReport(null);
  };

  const formatEuros = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const totalValeur = report?.parcelles.reduce((s, p) => s + p.valeur, 0) || 0;
  const totalSurface = report?.parcelles.reduce((s, p) => s + p.surface, 0) || 0;

  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-start gap-4 mb-2">
            <FidalLogo />
            <div className="border-l-2 border-amber-400 pl-4 pt-2">
              <h1 className="text-2xl font-semibold text-blue-950">REDPAR</h1>
              <p className="text-sm text-stone-500">REcherche De PARcelles</p>
            </div>
          </div>
        </div>

        {step < 4 && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {['Entreprise', 'Vérification SIREN', 'Recherche DVF'].map((label, i) => {
                const n = i + 1, active = step === n, done = step > n;
                return (
                  <React.Fragment key={label}>
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${done ? 'bg-blue-950 text-amber-400' : active ? 'bg-blue-900 text-white' : 'bg-white border border-stone-300 text-stone-400'}`}>
                        {done ? <CheckCircle2 className="w-4 h-4" /> : n}
                      </div>
                      <span className={`text-sm font-medium hidden md:block ${active ? 'text-blue-950' : done ? 'text-blue-900' : 'text-stone-400'}`}>{label}</span>
                    </div>
                    {i < 2 && <div className={`flex-1 h-px mx-2 ${step > n ? 'bg-blue-950' : 'bg-stone-200'}`} />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 md:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-blue-950 mb-1">Nom de l'entreprise</h2>
            <p className="text-sm text-stone-500 mb-6">Saisissez le nom au clavier ou utilisez le micro</p>
            <div className="relative">
              <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goToStep2()} placeholder="Ex : LES TROIS MATELOTS" className="w-full px-4 py-4 pr-14 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 text-blue-950 text-lg" autoFocus />
              {speechSupported && (
                <button onClick={toggleMicrophone} className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-950 text-amber-400 hover:bg-blue-900'}`}>
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
            </div>
            {isListening && <div className="mt-3 flex items-center gap-2 text-sm text-red-600"><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />Écoute en cours...</div>}
            <div className="flex justify-end mt-6">
              <button onClick={goToStep2} disabled={companyName.trim().length < 2} className="flex items-center gap-2 px-5 py-2.5 bg-blue-950 text-white rounded-lg font-medium hover:bg-blue-900 disabled:bg-stone-300">Rechercher <ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 md:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-blue-950 mb-1">Vérification SIREN</h2>
            <p className="text-sm text-stone-500 mb-2">Recherche pour : <span className="font-medium text-blue-950">{companyName}</span></p>
            <div className="mb-6 inline-flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded text-xs text-green-800">
              <CheckCircle2 className="w-3.5 h-3.5" />Source : API officielle gouv.fr via backend Fidal
            </div>
            {pappersLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-amber-500 animate-spin" /><span className="ml-3 text-stone-600">Recherche en cours...</span></div>}
            {pappersError && <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"><AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" /><div><div className="font-medium text-red-900">Erreur</div><div className="text-sm text-red-700">{pappersError}</div></div></div>}
            {!pappersLoading && pappersResults.length > 0 && (
              <>
                <div className="mb-4 text-sm text-stone-600"><CheckCircle2 className="w-4 h-4 text-blue-950 inline" /> {pappersResults.length} entreprises trouvées</div>
                <div className="space-y-3">
                  {pappersResults.map((c) => {
                    const sel = selectedCompany?.siren === c.siren;
                    return (
                      <button key={c.siren} onClick={() => selectCompany(c)} className={`w-full text-left p-4 rounded-lg border-2 ${sel ? 'border-blue-950 bg-blue-50' : 'border-stone-200 hover:border-blue-900'}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <Building2 className="w-4 h-4 text-blue-950" />
                              <div className="font-semibold text-blue-950">{c.nom}</div>
                              <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-700 rounded">{c.formeJuridique}</span>
                              <span className={`text-xs px-2 py-0.5 rounded border ${c.statut === 'Active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-stone-100 text-stone-600 border-stone-200'}`}>{c.statut}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                              <div><span className="text-stone-500">SIREN : </span><span className="text-blue-950 font-mono">{c.siren}</span></div>
                              <div><span className="text-stone-500">Créée : </span><span className="text-blue-950">{c.dateCreation}</span></div>
                              <div className="md:col-span-2"><span className="text-stone-500">Adresse : </span><span className="text-blue-950">{c.adresse}</span></div>
                              <div className="md:col-span-2"><span className="text-stone-500">APE : </span><span className="text-blue-950">{c.codeApe}</span></div>
                              <div className="md:col-span-2"><span className="text-stone-500">Dirigeants : </span><span className="text-blue-950">{c.dirigeants.join(', ')}</span></div>
                            </div>
                          </div>
                          {sel && <CheckCircle2 className="w-6 h-6 text-blue-950 flex-shrink-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="flex justify-between mt-8">
              <button onClick={goToStep1} className="flex items-center gap-2 px-5 py-2.5 text-blue-950 rounded-lg font-medium hover:bg-stone-100"><ChevronLeft className="w-4 h-4" />Retour</button>
              <button onClick={confirmCompany} disabled={!selectedCompany} className="flex items-center gap-2 px-5 py-2.5 bg-blue-950 text-white rounded-lg font-medium hover:bg-blue-900 disabled:bg-stone-300">Lancer DVF <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 md:p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-1"><Loader2 className="w-5 h-5 text-amber-500 animate-spin" /><h2 className="text-lg font-semibold text-blue-950">Recherche DVF en cours...</h2></div>
            <p className="text-sm text-stone-500 mb-6">SIREN <span className="font-mono text-blue-950">{selectedCompany?.siren}</span></p>
            <div className="space-y-3">
              {dvfTasks.map(task => {
                const s = dvfStatus[task.id] || 'pending';
                const Icon = task.icon;
                return (
                  <div key={task.id} className={`flex items-center gap-3 p-4 border rounded-lg ${s === 'done' ? 'border-blue-200 bg-blue-50/50' : s === 'running' ? 'border-amber-200 bg-amber-50/50' : 'border-stone-200'}`}>
                    {s === 'pending' && <Circle className="w-5 h-5 text-stone-300" />}
                    {s === 'running' && <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />}
                    {s === 'done' && <CheckCircle2 className="w-5 h-5 text-blue-950" />}
                    <Icon className="w-4 h-4 text-stone-500" />
                    <div className="flex-1 font-medium text-blue-950">{task.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 4 && report && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm text-blue-950"><CheckCircle2 className="w-4 h-4 text-amber-500" />Rapport généré</div>
              <button onClick={resetAll} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-950 rounded-lg hover:bg-stone-100"><RotateCcw className="w-4 h-4" />Nouvelle recherche</button>
            </div>
            <div className="bg-blue-950 text-white rounded-xl shadow-sm overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-amber-400" />
              <div className="p-6">
                <div className="flex items-center gap-2 text-xs text-amber-400 mb-2"><FileText className="w-3.5 h-3.5" />RAPPORT REDPAR</div>
                <h2 className="text-2xl font-semibold mb-1">{selectedCompany?.nom}</h2>
                <div className="text-sm text-blue-200">SIREN : <span className="font-mono text-white">{selectedCompany?.siren}</span> • {selectedCompany?.formeJuridique}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white border border-stone-200 rounded-lg p-4"><div className="text-xs text-stone-500 mb-1">Parcelles</div><div className="text-2xl font-semibold text-blue-950">{report.parcelles.length}</div></div>
              <div className="bg-white border border-stone-200 rounded-lg p-4"><div className="text-xs text-stone-500 mb-1">Surface</div><div className="text-2xl font-semibold text-blue-950">{totalSurface} m²</div></div>
              <div className="bg-white border border-stone-200 rounded-lg p-4"><div className="text-xs text-stone-500 mb-1">Valeur</div><div className="text-2xl font-semibold text-blue-950">{formatEuros(totalValeur)}</div></div>
            </div>

            <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-950" />
                <h3 className="font-semibold text-blue-950">Détail des parcelles</h3>
                <span className="ml-2 text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200">Données simulées — branchement DVF à venir</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 border-b border-stone-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Référence cadastrale</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Commune</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">Surface</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">Valeur</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Acquisition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.parcelles.map((p, i) => (
                      <tr key={p.ref} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-4 py-3"><div className="w-6 h-6 rounded-full bg-blue-950 text-amber-400 text-xs font-semibold flex items-center justify-center">{i + 1}</div></td>
                        <td className="px-4 py-3 font-mono text-xs text-blue-950">{p.ref}</td>
                        <td className="px-4 py-3 text-blue-950">{p.commune}</td>
                        <td className="px-4 py-3 text-blue-950">{p.type}</td>
                        <td className="px-4 py-3 text-right text-blue-950">{p.surface.toLocaleString('fr-FR')} m²</td>
                        <td className="px-4 py-3 text-right font-medium text-blue-950">{formatEuros(p.valeur)}</td>
                        <td className="px-4 py-3 text-stone-600">{new Date(p.dateAcquisition).toLocaleDateString('fr-FR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {report.transactions.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-950" />
                  <h3 className="font-semibold text-blue-950">Historique des transactions</h3>
                </div>
                <div className="p-6">
                  <div className="relative pl-8">
                    <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-stone-200" />
                    {report.transactions.map((t, i) => (
                      <div key={i} className="relative mb-4 last:mb-0">
                        <div className="absolute -left-8 top-1 w-6 h-6 rounded-full bg-amber-400 border-4 border-white shadow-sm" />
                        <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                            <div className="font-medium text-blue-950">{t.type}</div>
                            <div className="text-xs text-stone-500">{new Date(t.date).toLocaleDateString('fr-FR')}</div>
                          </div>
                          <div className="text-sm text-stone-700">Parcelle <span className="font-mono">{t.parcelle}</span></div>
                          <div className="flex items-center justify-between mt-1 text-sm flex-wrap gap-2">
                            <span className="text-stone-600">Contrepartie : {t.contrepartie}</span>
                            <span className="font-semibold text-blue-950">{formatEuros(t.montant)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
