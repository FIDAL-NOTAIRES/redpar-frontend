import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Mic, MicOff, Loader2, CheckCircle2, Building2, MapPin, FileText, RotateCcw, ArrowRight, AlertCircle, Download } from 'lucide-react';

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

// Génère un lien Google Maps vue satellite depuis "lat,lng"
const buildSatelliteLink = (coords) => {
  if (!coords) return null;
  const [lat, lng] = coords.split(',').map(s => s.trim());
  if (!lat || !lng) return null;
  return `https://www.google.com/maps/@${lat},${lng},19z/data=!3m1!1e3`;
};

export default function App() {
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [pappersResults, setPappersResults] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [pappersLoading, setPappersLoading] = useState(false);
  const [pappersError, setPappersError] = useState(null);
  const [parcellesLoading, setParcellesLoading] = useState(false);
  const [parcellesError, setParcellesError] = useState(null);
  const [parcelles, setParcelles] = useState([]);
  const [totalParcelles, setTotalParcelles] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [exporting, setExporting] = useState(false);
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

  const searchSiren = async () => {
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

  const fetchParcelles = async (siren) => {
    setParcellesLoading(true); setParcellesError(null); setParcelles([]); setTotalParcelles(0); setTruncated(false);
    try {
      const r = await fetch(`${BACKEND_URL}/api/parcelles?siren=${encodeURIComponent(siren)}&maxResults=10000`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      const data = await r.json();
      setParcelles(data.parcelles || []);
      setTotalParcelles(data.total || 0);
      setTruncated(data.truncated || false);
    } catch (e) { setParcellesError(`Erreur : ${e.message}`); }
    finally { setParcellesLoading(false); }
  };

  const goToStep1 = () => setStep(1);
  const goToStep2 = () => { if (companyName.trim().length < 2) return; setStep(2); searchSiren(); };
  const selectCompany = (c) => setSelectedCompany(c);
  const confirmCompany = () => {
    if (!selectedCompany) return;
    setStep(3);
    fetchParcelles(selectedCompany.siren);
  };

  const resetAll = () => {
    setStep(1); setCompanyName(''); setPappersResults([]); setSelectedCompany(null);
    setPappersError(null); setParcelles([]); setTotalParcelles(0); setParcellesError(null); setTruncated(false);
  };

  // Export Excel xlsx avec SheetJS — charte Fidal + AutoFilter + liens GMaps satellite
  const exportExcel = () => {
    if (!parcelles.length || !window.XLSX) {
      if (!window.XLSX) alert("La librairie d'export n'est pas encore chargée, attendez quelques secondes et réessayez.");
      return;
    }
    setExporting(true);

    try {
      const XLSX = window.XLSX;

      // Données : ligne d'en-tête + lignes de parcelles
      const headers = ['#', 'Référence cadastrale', 'Commune', 'Département', 'Région', 'Adresse', 'Surface (m²)', 'Nature culture', 'Google Maps'];

      const aoa = [headers];
      parcelles.forEach((p, i) => {
        const link = buildSatelliteLink(p.coordonnees);
        aoa.push([
          i + 1,
          p.codeParcelle || '',
          p.commune || '',
          p.departement || '',
          p.region || '',
          p.adresse || '',
          p.contenance || 0,
          p.natureCulture || '',
          link ? { t: 's', v: 'Voir (satellite)', l: { Target: link, Tooltip: 'Ouvrir Google Maps en vue satellite' } } : '',
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Largeurs des colonnes
      ws['!cols'] = [
        { wch: 5 },   // #
        { wch: 18 },  // Réf
        { wch: 22 },  // Commune
        { wch: 18 },  // Dépt
        { wch: 22 },  // Région
        { wch: 35 },  // Adresse
        { wch: 12 },  // Surface
        { wch: 14 },  // Nature culture
        { wch: 18 },  // Google Maps
      ];

      // Hauteur ligne d'en-tête
      ws['!rows'] = [{ hpx: 26 }];

      // Styles : en-têtes (bleu marine + texte doré) et cellules
      const headerStyle = {
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FBBF24' } },
        fill: { fgColor: { rgb: '1E2952' }, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          bottom: { style: 'medium', color: { rgb: 'FBBF24' } },
        },
      };
      const numCols = headers.length;
      for (let c = 0; c < numCols; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[addr]) ws[addr].s = headerStyle;
      }

      // Style cellules de données
      const cellBase = {
        font: { name: 'Calibri', sz: 10, color: { rgb: '1E2952' } },
        alignment: { vertical: 'center' },
      };
      const cellCenter = { ...cellBase, alignment: { horizontal: 'center', vertical: 'center' } };
      const cellRight = { ...cellBase, alignment: { horizontal: 'right', vertical: 'center' } };
      const cellLink = {
        font: { name: 'Calibri', sz: 10, color: { rgb: '1E2952' }, underline: true, bold: true },
        alignment: { horizontal: 'center', vertical: 'center' },
      };

      for (let r = 1; r <= parcelles.length; r++) {
        for (let c = 0; c < numCols; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (!ws[addr]) continue;
          // # et Nature culture : centrés
          if (c === 0 || c === 7) ws[addr].s = cellCenter;
          // Surface : aligné à droite + format nombre
          else if (c === 6) { ws[addr].s = cellRight; ws[addr].z = '#,##0'; }
          // Google Maps : centré, souligné (lien)
          else if (c === 8) ws[addr].s = cellLink;
          // Autres : alignement par défaut (gauche, centré verticalement)
          else ws[addr].s = cellBase;
        }
      }

      // AutoFilter sur toute la plage (active les filtres/tri Excel)
      const range = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: parcelles.length, c: numCols - 1 },
      });
      ws['!autofilter'] = { ref: range };

      // Figer la 1re ligne
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' }];

      // Création workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Parcelles');

      // Propriétés du fichier
      wb.Props = {
        Title: `REDPAR - ${selectedCompany?.nom || ''}`,
        Subject: 'Recherche de parcelles',
        Author: 'FIDAL Notaires',
        Company: 'FIDAL Notaires',
        CreatedDate: new Date(),
      };

      const dateStr = new Date().toISOString().split('T')[0];
      const cleanName = (selectedCompany?.nom || 'export').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      XLSX.writeFile(wb, `REDPAR_${cleanName}_${dateStr}.xlsx`);
    } catch (err) {
      alert('Erreur lors de l\'export Excel : ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const totalSurface = parcelles.reduce((s, p) => s + (p.contenance || 0), 0);
  const uniqueCommunes = new Set(parcelles.map(p => p.commune)).size;

  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <div className="flex items-start gap-4 mb-2">
            <FidalLogo />
            <div className="border-l-2 border-amber-400 pl-4 pt-2">
              <h1 className="text-2xl font-semibold text-blue-950">REDPAR</h1>
              <p className="text-sm text-stone-500">REcherche De PARcelles</p>
            </div>
          </div>
        </div>

        {step < 3 && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {['Entreprise', 'Vérification SIREN', 'Parcelles'].map((label, i) => {
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
              <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goToStep2()} placeholder="Ex : LOGIS METROPOLE" className="w-full px-4 py-4 pr-14 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 text-blue-950 text-lg" autoFocus />
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
              <CheckCircle2 className="w-3.5 h-3.5" />Source : API officielle gouv.fr
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
              <button onClick={confirmCompany} disabled={!selectedCompany} className="flex items-center gap-2 px-5 py-2.5 bg-blue-950 text-white rounded-lg font-medium hover:bg-blue-900 disabled:bg-stone-300">Rechercher parcelles <ArrowRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm text-blue-950">
                {parcellesLoading ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-amber-500" />}
                {parcellesLoading ? 'Recherche dans la base MAJIC...' : `${totalParcelles.toLocaleString('fr-FR')} parcelle${totalParcelles > 1 ? 's' : ''} • ${parcelles.length.toLocaleString('fr-FR')} affichée${parcelles.length > 1 ? 's' : ''}`}
              </div>
              <div className="flex items-center gap-2">
                {!parcellesLoading && parcelles.length > 0 && (
                  <button onClick={exportExcel} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-950 text-amber-400 rounded-lg hover:bg-blue-900 font-medium shadow-sm transition-colors disabled:opacity-50">
                    {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Exporter Excel
                  </button>
                )}
                <button onClick={resetAll} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-950 rounded-lg hover:bg-stone-100"><RotateCcw className="w-4 h-4" />Nouvelle recherche</button>
              </div>
            </div>

            <div className="bg-blue-950 text-white rounded-xl shadow-sm overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-amber-400" />
              <div className="p-6">
                <div className="flex items-center gap-2 text-xs text-amber-400 mb-2"><FileText className="w-3.5 h-3.5" />RAPPORT REDPAR</div>
                <h2 className="text-2xl font-semibold mb-1">{selectedCompany?.nom}</h2>
                <div className="text-sm text-blue-200">SIREN : <span className="font-mono text-white">{selectedCompany?.siren}</span> • {selectedCompany?.formeJuridique}</div>
              </div>
            </div>

            {parcellesLoading && (
              <div className="bg-white rounded-xl border border-stone-200 p-12 shadow-sm flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                <span className="text-stone-600">Interrogation de la base MAJIC (Koumoul / DGFiP)...</span>
                <span className="text-xs text-stone-400">Récupération de toutes les parcelles, merci de patienter</span>
              </div>
            )}

            {!parcellesLoading && parcellesError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div><div className="font-medium text-red-900">Erreur</div><div className="text-sm text-red-700">{parcellesError}</div></div>
              </div>
            )}

            {!parcellesLoading && !parcellesError && parcelles.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
                <AlertCircle className="w-8 h-8 text-amber-600 mx-auto mb-2" />
                <div className="font-semibold text-amber-900 mb-1">Aucune parcelle trouvée</div>
                <div className="text-sm text-amber-800">Cette personne morale n'apparaît pas dans le fichier MAJIC (cadastre 2022).</div>
              </div>
            )}

            {!parcellesLoading && parcelles.length > 0 && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Parcelles</div>
                    <div className="text-2xl font-semibold text-blue-950">{totalParcelles.toLocaleString('fr-FR')}</div>
                    {truncated && <div className="text-xs text-amber-700 mt-1">⚠ {parcelles.length.toLocaleString('fr-FR')} récupérées (limite 10 000)</div>}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Surface totale</div>
                    <div className="text-2xl font-semibold text-blue-950">{totalSurface.toLocaleString('fr-FR')} m²</div>
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Communes</div>
                    <div className="text-2xl font-semibold text-blue-950">{uniqueCommunes.toLocaleString('fr-FR')}</div>
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2 flex-wrap">
                    <MapPin className="w-4 h-4 text-blue-950" />
                    <h3 className="font-semibold text-blue-950">Détail des parcelles</h3>
                    <span className="ml-2 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded border border-green-200">Données officielles MAJIC (DGFiP) via Koumoul</span>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">#</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Référence cadastrale</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Commune</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Département</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Adresse</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">Surface</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-stone-600 uppercase">Nature</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-stone-600 uppercase">Carte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parcelles.map((p, i) => {
                          const link = buildSatelliteLink(p.coordonnees);
                          return (
                            <tr key={p.codeParcelle + '-' + i} className="border-b border-stone-100 hover:bg-stone-50">
                              <td className="px-4 py-3"><div className="w-6 h-6 rounded-full bg-blue-950 text-amber-400 text-xs font-semibold flex items-center justify-center">{i + 1}</div></td>
                              <td className="px-4 py-3 font-mono text-xs text-blue-950 whitespace-nowrap">{p.codeParcelle}</td>
                              <td className="px-4 py-3 text-blue-950">{p.commune}</td>
                              <td className="px-4 py-3 text-stone-600">{p.departement}</td>
                              <td className="px-4 py-3 text-blue-950 text-xs">{p.adresse}</td>
                              <td className="px-4 py-3 text-right text-blue-950 whitespace-nowrap">{(p.contenance || 0).toLocaleString('fr-FR')} m²</td>
                              <td className="px-4 py-3 text-center text-blue-950">{p.natureCulture}</td>
                              <td className="px-4 py-3 text-center">
                                {link && (
                                  <a href={link} target="_blank" rel="noreferrer" className="text-blue-900 hover:text-blue-700 underline text-xs font-medium">
                                    Voir
                                  </a>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
