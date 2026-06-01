import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Mic, MicOff, Loader2, CheckCircle2, Building2, MapPin, FileText, RotateCcw, ArrowRight, AlertCircle, Download, FileDown, BarChart3, Map as MapIcon } from 'lucide-react';

const BACKEND_URL = 'https://redpar-backend.vercel.app';

// Formatage des nombres pour le PDF (espace simple compatible avec les polices PDF)
const formatNumberForPdf = (n) => {
  if (n === null || n === undefined || n === '') return '';
  return Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const FidalLogo = () => (
  <div className="flex-shrink-0">
    <img src="/logo-fidal.png" alt="FIDAL Notaires" style={{ height: '105px', width: 'auto', display: 'block' }} />
  </div>
);

const buildSatelliteLink = (coords) => {
  if (!coords) return null;
  const [lat, lng] = coords.split(',').map(s => s.trim());
  if (!lat || !lng) return null;
  return `https://www.google.com/maps/@${lat},${lng},19z/data=!3m1!1e3`;
};

const parseCoords = (coords) => {
  if (!coords) return null;
  const [lat, lng] = coords.split(',').map(s => parseFloat(s.trim()));
  if (isNaN(lat) || isNaN(lng)) return null;
  return [lat, lng];
};

function ParcellesMap({ parcelles, companyName }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!window.L || !mapRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    const L = window.L;
    const validParcelles = parcelles.filter(p => parseCoords(p.coordonnees));
    if (validParcelles.length === 0) return;

    const map = L.map(mapRef.current).setView([46.5, 2.5], 6);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const fidalIcon = L.divIcon({
      className: 'custom-fidal-icon',
      html: '<div style="background:#1e2952;color:#fbbf24;width:24px;height:24px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3)">●</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const markers = L.markerClusterGroup({
      chunkedLoading: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div style="background:#1e2952;color:#fbbf24;width:40px;height:40px;border-radius:50%;border:3px solid #fbbf24;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${count}</div>`,
          className: 'custom-cluster-icon',
          iconSize: [40, 40],
        });
      },
    });

    const bounds = [];
    validParcelles.forEach((p, i) => {
      const coords = parseCoords(p.coordonnees);
      if (!coords) return;
      bounds.push(coords);
      const satLink = buildSatelliteLink(p.coordonnees);
      const marker = L.marker(coords, { icon: fidalIcon });
      const popupContent = `
        <div style="font-family:system-ui;min-width:220px">
          <div style="font-weight:700;color:#1e2952;margin-bottom:6px;border-bottom:2px solid #fbbf24;padding-bottom:4px">Parcelle ${i + 1}</div>
          <div style="font-size:12px;color:#1e2952;margin-bottom:3px"><strong>📍 ${p.adresse || ''}</strong></div>
          <div style="font-size:12px;color:#475569;margin-bottom:3px">${p.commune || ''} (${p.departement || ''})</div>
          <div style="font-size:12px;color:#475569;margin-bottom:3px">📐 ${(p.contenance || 0).toLocaleString('fr-FR')} m² • ${p.natureCulture || ''}</div>
          <div style="font-family:monospace;font-size:10px;color:#94a3b8;margin-bottom:6px">${p.codeParcelle || ''}</div>
          ${satLink ? `<a href="${satLink}" target="_blank" rel="noreferrer" style="display:inline-block;background:#1e2952;color:#fbbf24;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;text-decoration:none">Vue satellite ↗</a>` : ''}
        </div>
      `;
      marker.bindPopup(popupContent);
      markers.addLayer(marker);
    });
    map.addLayer(markers);

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [parcelles, companyName]);

  return <div ref={mapRef} style={{ height: '500px', width: '100%' }} />;
}

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
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
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

  useEffect(() => {
    if (window.__fidalLogoData) return;
    fetch('/logo-fidal.png')
      .then(r => r.blob())
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(dataUrl => { window.__fidalLogoData = dataUrl; })
      .catch(err => console.warn('Logo non préchargé', err));
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

  const computeStats = () => {
    const byDept = {};
    const byCommune = {};
    parcelles.forEach(p => {
      const dept = p.departement || 'N/C';
      const comm = p.commune || 'N/C';
      if (!byDept[dept]) byDept[dept] = { count: 0, surface: 0 };
      byDept[dept].count++;
      byDept[dept].surface += (p.contenance || 0);
      if (!byCommune[comm]) byCommune[comm] = { count: 0, surface: 0, departement: dept };
      byCommune[comm].count++;
      byCommune[comm].surface += (p.contenance || 0);
    });
    const totalCount = parcelles.length;
    const depts = Object.entries(byDept)
      .map(([nom, d]) => ({ nom, ...d, pct: Math.round((d.count / totalCount) * 100) }))
      .sort((a, b) => b.count - a.count);
    const communes = Object.entries(byCommune)
      .map(([nom, c]) => ({ nom, ...c, pct: Math.round((c.count / totalCount) * 100) }))
      .sort((a, b) => b.count - a.count);
    return { depts, communes };
  };

  // Dessine le bandeau de marque sur un canvas et renvoie un PNG (dataURL)
  const drawBannerDataUrl = (wPx, hPx) => {
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = wPx * scale;
    cv.height = hPx * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    const drawSpaced = (text, x, y, gap) => {
      let cx = x;
      for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; }
      return cx;
    };
    ctx.fillStyle = '#0F2238';
    ctx.fillRect(0, 0, wPx, hPx);
    ctx.fillStyle = '#E3CC7A';
    ctx.fillRect(0, hPx - 3, wPx, 3);
    ctx.textBaseline = 'middle';
    let x = 40;
    ctx.fillStyle = '#ffffff';
    ctx.font = "bold 34px Georgia, 'Times New Roman', serif";
    ctx.fillText('FIDAL', x, 70);
    x += ctx.measureText('FIDAL').width + 10;
    ctx.fillStyle = '#E3CC7A';
    ctx.font = "bold 40px Georgia, 'Times New Roman', serif";
    ctx.fillText('/', x, 70);
    x += ctx.measureText('/').width + 12;
    ctx.fillStyle = '#ffffff';
    ctx.font = "15px 'Segoe UI', Arial, sans-serif";
    x = drawSpaced('NOTAIRES', x, 70, 3) + 22;
    ctx.strokeStyle = 'rgba(101,125,150,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 42); ctx.lineTo(x, 108); ctx.stroke();
    x += 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = "bold 46px Georgia, 'Times New Roman', serif";
    ctx.fillText('REDPAR', x, 62);
    ctx.fillStyle = '#6DD5DC';
    ctx.font = "14px 'Segoe UI', Arial, sans-serif";
    drawSpaced('PATRIMOINE FONCIER DES PERSONNES MORALES', x + 2, 98, 3);
    const ps = 54, px = wPx - 40 - ps, py = 48;
    const poly = [[5, 4], [19, 7], [20, 17], [8, 20], [4, 11]].map(([a, b]) => [px + (a / 24) * ps, py + (b / 24) * ps]);
    ctx.strokeStyle = '#33838B';
    ctx.fillStyle = '#33838B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    poly.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
    ctx.closePath(); ctx.stroke();
    poly.forEach(pt => { ctx.beginPath(); ctx.arc(pt[0], pt[1], 2.4, 0, Math.PI * 2); ctx.fill(); });
    return cv.toDataURL('image/png');
  };

  const exportExcel = async () => {
    if (!parcelles.length || !window.ExcelJS) {
      if (!window.ExcelJS) alert("Librairie Excel (ExcelJS) non chargée");
      return;
    }
    setExportingExcel(true);
    try {
      const ExcelJS = window.ExcelJS;
      const headers = ['#', 'Référence cadastrale', 'Commune', 'Département', 'Région', 'Adresse', 'Surface (m²)', 'Nature culture', 'Google Maps'];
      const numCols = headers.length;
      const widths = [5, 18, 22, 18, 22, 35, 12, 14, 18];

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Parcelles', { views: [{ state: 'frozen', ySplit: 3 }] });
      ws.columns = widths.map(w => ({ width: w }));

      // --- Ligne 1 : bandeau image ---
      const bannerW = 1010, bannerH = 150;
      ws.getRow(1).height = bannerH * 0.75; // px -> points
      const imgId = wb.addImage({ base64: drawBannerDataUrl(bannerW, bannerH), extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: bannerW, height: bannerH } });

      // --- Ligne 2 : sujet du rapport ---
      const subjectText = `${selectedCompany?.nom || ''}  |  SIREN : ${selectedCompany?.siren || ''}  |  ${selectedCompany?.formeJuridique || ''}  |  ${totalParcelles.toLocaleString('fr-FR')} parcelle(s)  |  Source : MAJIC (DGFiP) via Koumoul  |  Généré le ${new Date().toLocaleDateString('fr-FR')}`;
      ws.mergeCells(2, 1, 2, numCols);
      const subjectCell = ws.getCell(2, 1);
      subjectCell.value = subjectText;
      subjectCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF0F2238' } };
      subjectCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F4E0' } };
      subjectCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(2).height = 18;

      // --- Ligne 3 : en-têtes de colonnes ---
      const headerRow = ws.getRow(3);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFE3CC7A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2238' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FFE3CC7A' } } };
      });
      headerRow.height = 24;

      // --- Données ---
      parcelles.forEach((p, i) => {
        const r = i + 4;
        const link = buildSatelliteLink(p.coordonnees);
        const row = ws.getRow(r);
        const navy = { name: 'Calibri', size: 10, color: { argb: 'FF0F2238' } };
        row.getCell(1).value = i + 1;
        row.getCell(2).value = p.codeParcelle || '';
        row.getCell(3).value = p.commune || '';
        row.getCell(4).value = p.departement || '';
        row.getCell(5).value = p.region || '';
        row.getCell(6).value = p.adresse || '';
        row.getCell(7).value = p.contenance || 0;
        row.getCell(8).value = p.natureCulture || '';
        const linkCell = row.getCell(9);
        if (link) {
          linkCell.value = { text: 'Voir (satellite)', hyperlink: link };
          linkCell.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF33838B' } };
        } else {
          linkCell.value = '';
        }
        for (let c = 1; c <= numCols; c++) {
          const cell = row.getCell(c);
          if (c !== 9) cell.font = navy;
          if (c === 1 || c === 8) cell.alignment = { horizontal: 'center', vertical: 'middle' };
          else if (c === 7) { cell.alignment = { horizontal: 'right', vertical: 'middle' }; cell.numFmt = '#,##0'; }
          else if (c === 9) cell.alignment = { horizontal: 'center', vertical: 'middle' };
          else cell.alignment = { vertical: 'middle' };
        }
      });

      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + parcelles.length, column: numCols } };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const dateStr = new Date().toISOString().split('T')[0];
      const cleanName = (selectedCompany?.nom || 'export').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `REDPAR_${cleanName}_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { alert("Erreur Excel : " + err.message); }
    finally { setExportingExcel(false); }
  };

  const exportPdf = () => {
    if (!parcelles.length || !window.jspdf || !window.jspdf.jsPDF) {
      alert("Librairie PDF non chargée");
      return;
    }
    setExportingPdf(true);
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 12;
      const stats = computeStats();
      const dateStr = new Date().toLocaleDateString('fr-FR');

      // ===== Palette charte FIDAL =====
      const NAVY = [15, 34, 56];      // #0F2238
      const OCRE = [227, 204, 122];   // #E3CC7A (slash, accents)
      const CYAN = [109, 213, 220];   // #6DD5DC (sous-titre)
      const TEAL = [51, 131, 139];    // #33838B (polygone)
      const GREYBLUE = [101, 125, 150];
      const GOLD = OCRE;              // accents du corps (sections, tableaux)
      const BEIGE = [248, 244, 224];  // teinte ocre très pâle

      // ===== Bandeau marque (même identité que le web) =====
      const bandH = 26;
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, pageWidth, bandH, 'F');
      doc.setFillColor(...OCRE);
      doc.rect(0, bandH, pageWidth, 1.2, 'F');

      // Lockup FIDAL / NOTAIRES
      let lx = margin;
      doc.setFont('times', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(255, 255, 255);
      doc.text('FIDAL', lx, 13);
      lx += doc.getTextWidth('FIDAL') + 2;
      doc.setTextColor(...OCRE);
      doc.setFontSize(17);
      doc.text('/', lx, 13.5);
      lx += doc.getTextWidth('/') + 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text('NOTAIRES', lx, 12.5, { charSpace: 0.8 });
      lx += doc.getTextWidth('NOTAIRES') + 0.8 * 7 + 6;

      // Séparateur vertical
      doc.setDrawColor(...GREYBLUE);
      doc.setLineWidth(0.3);
      doc.line(lx, 5, lx, 21);
      const titleX = lx + 6;

      // REDPAR + sous-titre
      doc.setFont('times', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      doc.text('REDPAR', titleX, 14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...CYAN);
      doc.text('PATRIMOINE FONCIER DES PERSONNES MORALES', titleX + 0.5, 20, { charSpace: 0.7 });

      // Emblème polygone (à droite)
      try {
        const ps = 14, px = pageWidth - margin - ps, py = 6;
        const poly = [[5, 4], [19, 7], [20, 17], [8, 20], [4, 11]].map(([a, b]) => [px + (a / 24) * ps, py + (b / 24) * ps]);
        doc.setDrawColor(...TEAL);
        doc.setFillColor(...TEAL);
        doc.setLineWidth(0.5);
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          doc.line(a[0], a[1], b[0], b[1]);
        }
        poly.forEach(pt => doc.circle(pt[0], pt[1], 0.7, 'F'));
      } catch (e) { /* polygone optionnel */ }

      // ===== Sujet du rapport =====
      doc.setTextColor(...TEAL);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text('RAPPORT REDPAR', margin, bandH + 7, { charSpace: 0.5 });
      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(selectedCompany?.nom || '', margin, bandH + 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...GREYBLUE);
      doc.text(`SIREN : ${selectedCompany?.siren} • ${selectedCompany?.formeJuridique || ''}`, margin, bandH + 18);
      doc.setTextColor(...NAVY);
      doc.text(dateStr, pageWidth - margin, bandH + 18, { align: 'right' });

      let y = bandH + 26;

      doc.setFillColor(...BEIGE);
      doc.rect(margin, y - 4, pageWidth - 2 * margin, 10, 'F');
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(1.5);
      doc.line(margin, y - 4, margin, y + 6);
      doc.setTextColor(...NAVY);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(`${formatNumberForPdf(totalParcelles)} parcelle(s) au total`, margin + 3, y);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.text('Source : MAJIC (DGFiP) via Koumoul • Cadastre 2022', margin + 3, y + 4);
      y += 14;

      const cellW = (pageWidth - 2 * margin - 8) / 3;
      const totalSurfaceCalc = parcelles.reduce((s, p) => s + (p.contenance || 0), 0);
      const stats3 = [
        { label: 'PARCELLES', value: formatNumberForPdf(totalParcelles) },
        { label: 'SURFACE TOTALE', value: formatNumberForPdf(totalSurfaceCalc) + ' m2' },
        { label: 'COMMUNES', value: formatNumberForPdf(stats.communes.length) },
      ];
      stats3.forEach((s, i) => {
        const x = margin + i * (cellW + 4);
        doc.setDrawColor(...NAVY);
        doc.setLineWidth(0.3);
        doc.rect(x, y, cellW, 16);
        doc.setFillColor(...NAVY);
        doc.rect(x, y, cellW, 5, 'F');
        doc.setTextColor(...GOLD);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text(s.label, x + cellW / 2, y + 3.5, { align: 'center' });
        doc.setTextColor(...NAVY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(s.value, x + cellW / 2, y + 12, { align: 'center' });
      });
      y += 22;

      doc.setFillColor(...NAVY);
      doc.rect(margin, y, pageWidth - 2 * margin, 6, 'F');
      doc.setTextColor(...GOLD);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(stats.depts.length > 1 ? `REPARTITION PAR DEPARTEMENT (${stats.depts.length})` : 'DEPARTEMENT', margin + 2, y + 4);
      y += 8;

      doc.autoTable({
        startY: y,
        head: [['Département', 'Parcelles', 'Surface (m2)', '%']],
        body: stats.depts.map(d => [d.nom, formatNumberForPdf(d.count), formatNumberForPdf(d.surface), d.pct + '%']),
        theme: 'grid',
        headStyles: { fillColor: NAVY, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: NAVY },
        alternateRowStyles: { fillColor: [250, 250, 249] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 6;

      const showCommunes = stats.communes.length <= 10 ? stats.communes : stats.communes.slice(0, 10);
      const communeTitle = stats.communes.length <= 10
        ? `REPARTITION PAR COMMUNE (${stats.communes.length})`
        : `TOP 10 COMMUNES (sur ${stats.communes.length})`;

      if (y > pageHeight - 50) { doc.addPage(); y = margin; }
      doc.setFillColor(...NAVY);
      doc.rect(margin, y, pageWidth - 2 * margin, 6, 'F');
      doc.setTextColor(...GOLD);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(communeTitle, margin + 2, y + 4);
      y += 8;

      doc.autoTable({
        startY: y,
        head: [['Commune', 'Département', 'Parcelles', 'Surface (m2)', '%']],
        body: showCommunes.map(c => [c.nom, c.departement, formatNumberForPdf(c.count), formatNumberForPdf(c.surface), c.pct + '%']),
        theme: 'grid',
        headStyles: { fillColor: NAVY, textColor: GOLD, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: NAVY },
        alternateRowStyles: { fillColor: [250, 250, 249] },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 8;

      doc.addPage();
      y = margin;
      doc.setFillColor(...NAVY);
      doc.rect(margin, y, pageWidth - 2 * margin, 6, 'F');
      doc.setTextColor(...GOLD);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`DETAIL DES PARCELLES (${formatNumberForPdf(parcelles.length)})`, margin + 2, y + 4);
      y += 8;

      doc.autoTable({
        startY: y,
        head: [['#', 'Référence', 'Commune', 'Département', 'Adresse', 'Surface', 'Nat.']],
        body: parcelles.map((p, i) => [
          i + 1,
          p.codeParcelle || '',
          p.commune || '',
          p.departement || '',
          p.adresse || '',
          formatNumberForPdf(p.contenance || 0) + ' m2',
          p.natureCulture || '',
        ]),
        theme: 'grid',
        headStyles: { fillColor: NAVY, textColor: GOLD, fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: NAVY },
        alternateRowStyles: { fillColor: [250, 250, 249] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 8 },
          1: { cellWidth: 28, font: 'courier', fontSize: 6 },
          2: { cellWidth: 30 },
          3: { cellWidth: 25 },
          4: { cellWidth: 'auto' },
          5: { halign: 'right', cellWidth: 18 },
          6: { halign: 'center', cellWidth: 10 },
        },
        margin: { left: margin, right: margin, top: 14 },
        didDrawPage: () => {
          const ph = doc.internal.pageSize.getHeight();
          doc.setFontSize(7);
          doc.setTextColor(...NAVY);
          doc.text(`REDPAR — ${selectedCompany?.nom} — SIREN ${selectedCompany?.siren}`, margin, 8);
          doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageWidth - margin, 8, { align: 'right' });
          doc.setDrawColor(...GOLD);
          doc.setLineWidth(0.5);
          doc.line(margin, ph - 8, pageWidth - margin, ph - 8);
          doc.setTextColor(100);
          doc.setFontSize(6);
          doc.text(`Généré par REDPAR — FIDAL Notaires — ${dateStr}`, pageWidth / 2, ph - 4, { align: 'center' });
        },
      });

      const cleanName = (selectedCompany?.nom || 'export').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      const isoDate = new Date().toISOString().split('T')[0];
      doc.save(`REDPAR_${cleanName}_${isoDate}.pdf`);
    } catch (err) {
      alert("Erreur PDF : " + err.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const totalSurface = parcelles.reduce((s, p) => s + (p.contenance || 0), 0);
  const stats = parcelles.length > 0 ? computeStats() : { depts: [], communes: [] };
  const showAllCommunes = stats.communes.length <= 10;
  const displayedCommunes = showAllCommunes ? stats.communes : stats.communes.slice(0, 10);

  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* ===== En-tête REDPAR — charte FIDAL ===== */}
        <div className="mb-8">
          <header className="redpar-header">
            <style>{`
              .redpar-header{background:#0F2238;border-radius:12px;height:120px;display:flex;align-items:center;gap:26px;padding:0 30px;color:#fff;box-sizing:border-box;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;animation:redpar-rise .5s ease both;}
              @keyframes redpar-rise{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:none;}}
              @media (prefers-reduced-motion:reduce){.redpar-header{animation:none;}}
              .redpar-lockup{display:flex;align-items:baseline;gap:6px;}
              .redpar-divider{width:1px;height:52px;background:#657D96;opacity:.55;}
              .redpar-wordmark{font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1;}
              .redpar-subtitle{font-size:12px;letter-spacing:4px;color:#6DD5DC;margin-top:7px;}
              @media (max-width:640px){.redpar-header{gap:16px;padding:0 18px;}.redpar-wordmark{font-size:26px;}.redpar-subtitle{font-size:10px;letter-spacing:2.5px;}.redpar-divider,.redpar-mark{display:none;}}
            `}</style>
            <div className="redpar-lockup" aria-label="FIDAL Notaires">
              <span style={{ fontFamily: "Georgia, serif", fontSize: 26, letterSpacing: ".5px" }}>FIDAL</span>
              <span style={{ fontFamily: "Georgia, serif", fontSize: 30, color: "#E3CC7A" }}>/</span>
              <span style={{ fontSize: 11, letterSpacing: "3px" }}>NOTAIRES</span>
            </div>
            <div className="redpar-divider" aria-hidden="true" />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="redpar-wordmark">REDPAR</span>
              <span className="redpar-subtitle">PATRIMOINE FONCIER DES PERSONNES MORALES</span>
            </div>
            <div style={{ flex: 1 }} />
            <svg className="redpar-mark" width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#33838B" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5,4 19,7 20,17 8,20 4,11" />
              <circle cx="5" cy="4" r="1.7" fill="#33838B" stroke="none" />
              <circle cx="19" cy="7" r="1.7" fill="#33838B" stroke="none" />
              <circle cx="20" cy="17" r="1.7" fill="#33838B" stroke="none" />
              <circle cx="8" cy="20" r="1.7" fill="#33838B" stroke="none" />
              <circle cx="4" cy="11" r="1.7" fill="#33838B" stroke="none" />
            </svg>
          </header>
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
              <div className="flex items-center gap-2 flex-wrap">
                {!parcellesLoading && parcelles.length > 0 && (
                  <>
                    <button onClick={exportExcel} disabled={exportingExcel} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-950 text-amber-400 rounded-lg hover:bg-blue-900 font-medium shadow-sm disabled:opacity-50">
                      {exportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Excel
                    </button>
                    <button onClick={exportPdf} disabled={exportingPdf} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-400 text-blue-950 rounded-lg hover:bg-amber-500 font-medium shadow-sm disabled:opacity-50">
                      {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}PDF
                    </button>
                  </>
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
                    <div className="text-2xl font-semibold text-blue-950">{stats.communes.length}</div>
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2">
                    <MapIcon className="w-4 h-4 text-blue-950" />
                    <h3 className="font-semibold text-blue-950">Carte interactive</h3>
                    <span className="text-xs text-stone-500">— cliquez sur un marqueur pour les détails</span>
                  </div>
                  <ParcellesMap parcelles={parcelles} companyName={selectedCompany?.nom} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-950" />
                      <h3 className="font-semibold text-blue-950">
                        {stats.depts.length > 1 ? `Répartition par département (${stats.depts.length})` : 'Département'}
                      </h3>
                    </div>
                    <div className="p-4 space-y-3">
                      {stats.depts.map((d) => (
                        <div key={d.nom}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-blue-950">{d.nom}</span>
                            <span className="text-sm text-stone-600">{d.count.toLocaleString('fr-FR')} • {d.surface.toLocaleString('fr-FR')} m²</span>
                          </div>
                          <div className="w-full bg-stone-100 rounded-full h-3 overflow-hidden">
                            <div className="h-full bg-blue-950 rounded-full" style={{ width: `${d.pct}%` }} />
                          </div>
                          <div className="text-right text-xs text-blue-950 font-medium mt-0.5">{d.pct}%</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-blue-950" />
                      <h3 className="font-semibold text-blue-950">
                        {showAllCommunes ? `Communes (${stats.communes.length})` : `Top 10 communes (sur ${stats.communes.length})`}
                      </h3>
                    </div>
                    <div className="p-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-stone-200">
                            <th className="text-left text-xs font-semibold text-stone-500 uppercase pb-2">Commune</th>
                            <th className="text-right text-xs font-semibold text-stone-500 uppercase pb-2">Parc.</th>
                            <th className="text-right text-xs font-semibold text-stone-500 uppercase pb-2">Surface</th>
                            <th className="text-right text-xs font-semibold text-stone-500 uppercase pb-2">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedCommunes.map((c, i) => (
                            <tr key={c.nom} className="border-b border-stone-100 last:border-0">
                              <td className="py-2 flex items-center gap-2">
                                <div className="w-5 h-5 rounded bg-blue-950 text-amber-400 text-[10px] font-semibold flex items-center justify-center">{i + 1}</div>
                                <span className="text-blue-950">{c.nom}</span>
                              </td>
                              <td className="py-2 text-right text-blue-950">{c.count}</td>
                              <td className="py-2 text-right text-stone-600">{c.surface.toLocaleString('fr-FR')} m²</td>
                              <td className="py-2 text-right text-blue-950 font-medium">{c.pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2 flex-wrap">
                    <MapPin className="w-4 h-4 text-blue-950" />
                    <h3 className="font-semibold text-blue-950">Détail des parcelles</h3>
                    <span className="ml-2 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded border border-green-200">Données MAJIC (DGFiP) via Koumoul</span>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">#</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Référence</th>
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
                                  <a href={link} target="_blank" rel="noreferrer" className="text-blue-900 hover:text-blue-700 underline text-xs font-medium">Voir</a>
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
