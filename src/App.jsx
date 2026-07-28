import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Mic, MicOff, Loader2, CheckCircle2, Building2, MapPin, FileText, RotateCcw, ArrowRight, AlertCircle, Download, FileDown, BarChart3, Map as MapIcon } from 'lucide-react';

const BACKEND_URL = 'https://redpar-backend.vercel.app';

// PAINT expose un endpoint qui renvoie directement le PDF de l'extrait
// cadastral officiel. Il attend commune, préfixe, section et numéro : or notre
// référence à quatorze caractères les contient exactement, dans cet ordre.
// REDPAR est même mieux placé que l'interface de PAINT, qui doit deviner le
// préfixe via l'IGN quand la saisie est manuelle.
// ⚠ Ce service interroge le service de consultation du plan cadastral par un
// procédé non officiel, sujet à limitation de débit : un lien à la demande,
// jamais de génération en masse.
const PAINT_URL = 'https://paint-blue.vercel.app';

// Deux liens, deux usages assumés.
// À l'écran : on ouvre PAINT, qui génère l'extrait ET colorie la parcelle, prêt
// à annoter et à exporter — c'est l'outil de travail.
// Dans le classeur : on pointe le PDF brut, parce qu'un tableur remis à un tiers
// doit livrer une pièce, pas ouvrir une application du cabinet.
// ----------------------------------------------------------------------
// PROJECTION CONIQUE CONFORME DE LAMBERT — méthode EPSG 9802, ellipsoïde GRS80
// Les extraits DGFiP portent leurs coordonnées en projection conique conforme
// (RGF93CC50 pour Saint-Omer). Convertir le contour dans cette projection
// permet à PAINT de savoir EXACTEMENT quels pixels appartiennent à la parcelle,
// par simple application du géoréférencement qu'il lit en marge du plan.
// Neuf zones : CC42 à CC50. Parallèle d'origine = numéro de zone, parallèles
// automécoïques à ±0,75°, méridien central 3° Est, constante en X 1 700 000 m,
// constante en Y (zone − 41) millions + 200 000.
// Vérifié contre le géoréférencement mesuré sur la planche de Saint-Omer : le
// centroïde d'AV 1 se projette en X 1 647 577 / Y 9 283 388, soit exactement
// entre les étiquettes 1647500-1647600 et 9283300-9283400, et au centre du
// cadre — là où l'extrait est effectivement centré.
// ⚠ LIMITE : cette projection ne couvre que la métropole et la Corse. Appliquée
// à Pointe-à-Pitre elle donne X = −5 170 838, valeur absurde. D'où la garde de
// latitude ci-dessous ; les départements d'outre-mer emploient d'autres
// projections et retomberont sur la détection par taille.
// ----------------------------------------------------------------------
const LAMBERT_A = 6378137.0;
const LAMBERT_APLAT = 1 / 298.257222101;
const LAMBERT_E2 = 2 * LAMBERT_APLAT - LAMBERT_APLAT * LAMBERT_APLAT;
const LAMBERT_E = Math.sqrt(LAMBERT_E2);
const enRad = (d) => d * Math.PI / 180;
const tIsometrique = (phi) => {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2)
    / Math.pow((1 - LAMBERT_E * s) / (1 + LAMBERT_E * s), LAMBERT_E / 2);
};
const mParallele = (phi) =>
  Math.cos(phi) / Math.sqrt(1 - LAMBERT_E2 * Math.sin(phi) ** 2);

const versConiqueConforme = (lat, lon) => {
  if (!(lat > 41 && lat < 52)) return null;          // hors métropole et Corse
  const z = Math.min(50, Math.max(42, Math.round(lat)));
  const phi0 = enRad(z), phi1 = enRad(z - 0.75), phi2 = enRad(z + 0.75), lam0 = enRad(3);
  const X0 = 1700000, Y0 = (z - 41) * 1000000 + 200000;
  const phi = enRad(lat), lam = enRad(lon);
  const m1 = mParallele(phi1), m2 = mParallele(phi2);
  const t1 = tIsometrique(phi1), t2 = tIsometrique(phi2);
  const t0 = tIsometrique(phi0), t = tIsometrique(phi);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const Fc = m1 / (n * Math.pow(t1, n));
  const r0 = LAMBERT_A * Fc * Math.pow(t0, n);
  const r = LAMBERT_A * Fc * Math.pow(t, n);
  const theta = n * (lam - lam0);
  return { zone: z, X: X0 + r * Math.sin(theta), Y: Y0 + r0 - r * Math.cos(theta) };
};

// Simplification de Douglas-Peucker. Nécessaire parce que le contour voyage dans
// une URL, et qu'Excel plafonne ses liens hypertexte à environ 2 000 caractères :
// on ne peut pas y mettre deux cents sommets. Une tolérance d'un demi-mètre est
// insensible à l'échelle d'un extrait cadastral, et l'on plafonne à 40 points.
const simplifier = (pts, tol) => {
  if (pts.length <= 2) return pts;
  const dist2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return (p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2;
  };
  const garder = new Array(pts.length).fill(false);
  garder[0] = garder[pts.length - 1] = true;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [i, j] = pile.pop();
    let pire = -1, dPire = 0;
    for (let k = i + 1; k < j; k++) {
      const d = dist2(pts[k], pts[i], pts[j]);
      if (d > dPire) { dPire = d; pire = k; }
    }
    if (pire > 0 && dPire > tol * tol) {
      garder[pire] = true;
      pile.push([i, pire], [pire, j]);
    }
  }
  return pts.filter((_, i) => garder[i]);
};

// Point GARANTI INTÉRIEUR au polygone. Le centroïde suffit dans la plupart des
// cas, mais il tombe hors d'une parcelle concave ou en L : on le teste, et à
// défaut on balaie la boîte englobante pour trouver un point intérieur.
const dansPolygone = (x, y, anneau) => {
  let dedans = false;
  for (let i = 0, j = anneau.length - 2; i < anneau.length - 1; j = i++) {
    const [xi, yi] = anneau[i], [xj, yj] = anneau[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dedans = !dedans;
  }
  return dedans;
};

const pointInterieur = (anneau) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < anneau.length - 1; i++) {
    const [x0, y0] = anneau[i], [x1, y1] = anneau[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a !== 0) {
    const c = [cx / (3 * a), cy / (3 * a)];
    if (dansPolygone(c[0], c[1], anneau)) return c;
  }
  const xs = anneau.map((q) => q[0]), ys = anneau.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let i = 1; i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const x = x0 + (x1 - x0) * i / 8, y = y0 + (y1 - y0) * j / 8;
      if (dansPolygone(x, y, anneau)) return [x, y];
    }
  }
  return null;
};

// Descripteurs métriques d'une parcelle, calculés sur son contour cadastral.
// Ils permettent à PAINT de PRÉDIRE la taille attendue de la parcelle en pixels
// au lieu de la deviner : un extrait A4 à 1/1000 couvre 210 m de largeur, donc
// connaissant la largeur du rendu on connaît l'échelle pixels par mètre.
// Projection locale équirectangulaire : suffisante à l'échelle d'une parcelle,
// et sans dépendance à une bibliothèque de projection.
const descripteursForme = (geom) => {
  if (!geom) return null;
  const anneaux = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0]) : [];
  if (!anneaux.length) return null;
  // Anneau extérieur le plus vaste, comme côté serveur pour le centroïde.
  const aireBrute = (a) => {
    let s2 = 0;
    for (let i = 0; i < a.length - 1; i++) s2 += a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1];
    return Math.abs(s2 / 2);
  };
  const anneau = anneaux.reduce((m, a) => (aireBrute(a) > aireBrute(m) ? a : m));
  if (anneau.length < 4) return null;
  const lat0 = anneau.reduce((t, pt) => t + pt[1], 0) / anneau.length;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  const xy = anneau.map(([lo, la]) => [lo * mx, la * my]);
  let a2 = 0;
  for (let i = 0; i < xy.length - 1; i++) a2 += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
  const aire = Math.abs(a2 / 2);
  const xs = xy.map((q) => q[0]), ys = xy.map((q) => q[1]);
  const largeur = Math.max(...xs) - Math.min(...xs);
  const hauteur = Math.max(...ys) - Math.min(...ys);
  if (!(largeur > 0) || !(hauteur > 0)) return null;
  // Point intérieur, projeté en conique conforme.
  const pi = pointInterieur(anneau);
  const cc = pi ? versConiqueConforme(pi[1], pi[0]) : null;

  // CONTOUR PROJETÉ, sommet par sommet. C'est lui qui permet à PAINT de PEINDRE
  // le polygone au lieu de le tracer par remplissage. Décisif en rural : les
  // limites y sont dessinées en traits d'axe interrompus — tirets et points —
  // qu'un remplissage traverse. Observé à Pusey : 42 % du plan atteint.
  // Simplifié à 40 sommets au plus, contrainte des liens hypertexte d'Excel.
  let poly = null;
  if (cc) {
    const projetes = [];
    for (const [lo, la] of anneau) {
      const q = versConiqueConforme(la, lo);
      if (!q || q.zone !== cc.zone) { projetes.length = 0; break; }
      projetes.push([q.X, q.Y]);
    }
    if (projetes.length >= 4) {
      let reduit = simplifier(projetes, 0.5);
      // Si la tolérance d'un demi-mètre ne suffit pas, on la desserre par paliers
      // jusqu'à tenir dans quarante sommets.
      for (let tol = 1; reduit.length > 40 && tol <= 32; tol *= 2) {
        reduit = simplifier(projetes, tol);
      }
      poly = reduit.slice(0, 40);
    }
  }
  return {
    largeur: Math.round(largeur * 10) / 10,
    hauteur: Math.round(hauteur * 10) / 10,
    aire: Math.round(aire),
    remplissage: Math.round(100 * aire / (largeur * hauteur)) / 100,
    cc,
    poly,
  };
};

// ----------------------------------------------------------------------
// CHOIX DE L'ÉCHELLE ET DU FORMAT
// Le 1/1000 est la norme des éditions du cabinet et le reste : on ne s'en écarte
// que lorsque la parcelle n'y tient pas.
//
// EMPRISES TERRAIN EXACTES, relevées dans api/extrait.js de PAINT (constante
// MAP_SIZES, exprimée en centièmes de millimètre) — ce ne sont donc pas des
// estimations mais les dimensions réelles de la carte produite :
//     A4 portrait 195,5 × 211,0 mm      A4 paysage 210,7 × 197,0 mm
//     A3 portrait 281,5 × 301,0 mm      A3 paysage 316,0 × 283,0 mm
// À 1/1000, un A4 portrait couvre donc 195,5 × 211,0 m de terrain.
//
// TROIS PRINCIPES, dans cet ordre :
//  1. l'ORIENTATION change avant l'ÉCHELLE — passer en paysage préserve le
//     1/1000, ce qu'une échelle plus lâche ne fait pas ;
//  2. le FORMAT A4 est préservé aussi longtemps que possible : un A3 ne
//     s'imprime pas au cabinet aussi facilement ;
//  3. on n'offre d'abord à la parcelle que 60 % du cadre, pour qu'on voie son
//     voisinage ; ce n'est qu'en dernier recours qu'on la laisse le remplir.
//
// Mesuré sur la base : 88,3 % des parcelles tiennent à 1/1000. La couverture
// maximale atteignable est l'A3 paysage à 1/5000, soit 1 580 × 1 415 m ; au-delà
// il reste 0,025 % des parcelles, soit 4 649 sur 18,7 millions, pour l'essentiel
// des emprises forestières de Guyane de 100 000 hectares — qui relèvent de la
// carte et non de l'extrait cadastral.
// ----------------------------------------------------------------------
const CARTES = {
  'A4|portrait': { l: 195.5, h: 211.0, a3: false },
  'A4|paysage': { l: 210.7, h: 197.0, a3: false },
  'A3|portrait': { l: 281.5, h: 301.0, a3: true },
  'A3|paysage': { l: 316.0, h: 283.0, a3: true },
};
// PLAFOND À 1/5000, VÉRIFIÉ EXPÉRIMENTALEMENT le 28/07/2026 : une demande à
// 1/10000 est SILENCIEUSEMENT SERVIE À 1/1000 par le service du cadastre. Pas de
// refus, pas de message — le cartouche indique 1/1000 et le plan couvre dix fois
// moins de terrain que demandé. Ne pas rétablir 10000 ni 25000 sans avoir
// revérifié : la substitution est invisible et produirait un plan faux sur une
// pièce de dossier. PAINT contrôle désormais l'échelle réellement délivrée en la
// mesurant sur les étiquettes de coordonnées.
const ECHELLES = [1000, 1250, 1500, 2000, 2500, 4000, 5000];

const choisirEchelle = (largeurM, hauteurM) => {
  const L = Number(largeurM) || 0, H = Number(hauteurM) || 0;
  if (!L || !H) return { echelle: '1000', format: 'A4|portrait', occupation: 0.6, deborde: false };
  // Trois passes de plus en plus permissives, pour n'élargir qu'à contrecœur.
  const passes = [
    { occ: 0.60, a3: false },   // confortable, A4
    { occ: 0.95, a3: false },   // la parcelle remplit le cadre, A4
    { occ: 0.95, a3: true },    // dernier recours : A3
  ];
  for (const passe of passes) {
    for (const ech of ECHELLES) {
      for (const [nom, c] of Object.entries(CARTES)) {
        if (c.a3 && !passe.a3) continue;
        if (L <= c.l * ech / 1000 * passe.occ && H <= c.h * ech / 1000 * passe.occ) {
          return { echelle: String(ech), format: nom, occupation: passe.occ, deborde: false };
        }
      }
    }
  }
  // Aucune combinaison ne suffit : l'extrait cadastral n'est pas le bon document.
  return { echelle: '25000', format: 'A3|paysage', occupation: 1, deborde: true };
};

const lienPaintColorise = (codeParcelle, nomCommune, geom) => {
  const r = String(codeParcelle || '');
  if (r.length !== 14) return null;
  const qs = new URLSearchParams({
    commune: r.slice(0, 5),
    nomCommune: nomCommune || '',
    prefixe: r.slice(5, 8),
    section: r.slice(8, 10),
    parcelle: r.slice(10, 14),
    // Valeurs par défaut, remplacées plus bas dès que les dimensions de la
    // parcelle sont connues (voir choisirEchelle).
    echelle: '1000',
    format: 'A4|portrait',
    // Carmin profond, et non l'orange : sur l'extrait cadastral le bâti est
    // lui-même figuré en orange, ce qui rendrait la parcelle retenue
    // indistinguable des constructions. Teinte choisie par mesure de l'écart au
    // pêche du bâti composé à 45 % d'opacité — le rouge doux de la palette, lui,
    // tombe dans la zone de confusion. Détail dans le code de PAINT.
    couleur: '#A01040',
    auto: '1',
  });
  // Dimensions réelles de la parcelle, en mètres, quand le contour est connu :
  // PAINT en déduit la taille attendue en pixels et cesse de deviner.
  const f = descripteursForme(geom);
  if (f) {
    const ef = choisirEchelle(f.largeur, f.hauteur);
    qs.set('echelle', ef.echelle);
    qs.set('format', ef.format);
    // Parcelle plus grande que ce qu'un extrait peut montrer : on retire le
    // déclenchement automatique. Colorier une parcelle dont les limites sortent
    // du cadre n'aurait pas de sens — le remplissage s'arrêterait au bord de la
    // carte, donnant une emprise fausse sur une pièce de dossier.
    if (ef.deborde) qs.delete('auto');
    qs.set('dim', `${f.largeur}x${f.hauteur}`);
    qs.set('surface', String(f.aire));
    qs.set('remplissage', String(f.remplissage));
    // Point intérieur en coordonnées projetées : PAINT le confronte au
    // géoréférencement qu'il lit en marge de l'extrait, et sait alors
    // exactement où amorcer le remplissage.
    if (f.cc) {
      qs.set('pt', `${f.cc.X.toFixed(1)},${f.cc.Y.toFixed(1)}`);
      qs.set('crs', `CC${f.cc.zone}`);
      // Contour projeté : PAINT peint le polygone plutôt que de le tracer par
      // remplissage, ce qui le rend insensible aux traits de limite interrompus.
      if (f.poly) {
        qs.set('poly', f.poly.map(([X, Y]) => `${X.toFixed(1)},${Y.toFixed(1)}`).join(';'));
      }
    }
  }
  return `${PAINT_URL}/?${qs.toString()}`;
};

const lienExtraitCadastral = (codeParcelle) => {
  const r = String(codeParcelle || '');
  if (r.length !== 14) return null;
  const qs = new URLSearchParams({
    commune: r.slice(0, 5),
    prefixe: r.slice(5, 8),
    section: r.slice(8, 10),
    parcelle: r.slice(10, 14),
    echelle: '1000',
    taille: 'A4',
  });
  return `${PAINT_URL}/api/extrait?${qs.toString()}`;
};

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

// Surface : sommer sur les PARCELLES DISTINCTES, jamais sur les lignes. Une
// parcelle figure autant de fois qu'elle a de titulaires de droits
// (propriétaire, gérant, syndic, usufruitier...) ; sommer les lignes la compte
// plusieurs fois. Écart mesuré au niveau national : +41 %.
// Fonction déclarée hors du composant : hissée, donc utilisable avant sa
// position dans le fichier, et pure, donc sans raison d'être recréée à chaque
// rendu.
// ----------------------------------------------------------------------
// RECHERCHE ET TRI DES TABLEAUX
// Un relevé de quinze mille lots sans filtre ni tri est inexploitable : on
// cherche « la parcelle de la rue Jean-Jaurès » ou « les plus grandes
// surfaces », pas la ligne numéro 8 412.
// ----------------------------------------------------------------------
const normTexte = (v) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Tous les mots saisis doivent être présents, dans n'importe quel ordre et
// n'importe quelle colonne : « jaures anstaing » trouve la ligne.
function filtrerTexte(liste, q, champs) {
  const t = normTexte(q).trim();
  if (!t) return liste;
  const mots = t.split(/\s+/);
  return liste.filter((o) => {
    const blob = champs.map((c) => normTexte(o[c])).join(' ');
    return mots.every((m) => blob.includes(m));
  });
}

function trierListe(liste, tri) {
  if (!tri || !tri.champ) return liste;
  const sens = tri.sens === 'desc' ? -1 : 1;
  return [...liste].sort((a, b) => {
    const va = a[tri.champ], vb = b[tri.champ];
    const na = Number(va), nb = Number(vb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return sens * (na - nb);
    return sens * String(va ?? '').localeCompare(String(vb ?? ''), 'fr', { numeric: true });
  });
}

// En-tête cliquable : premier clic croissant, deuxième décroissant.
function EnTete({ label, champ, tri, onTri, align = 'text-left' }) {
  const actif = tri.champ === champ;
  return (
    <th className={`px-4 py-3 ${align} text-xs font-semibold uppercase select-none ${champ ? 'cursor-pointer hover:text-blue-900' : ''} ${actif ? 'text-blue-900' : 'text-stone-600'}`}
      onClick={champ ? () => onTri({ champ, sens: actif && tri.sens === 'asc' ? 'desc' : 'asc' }) : undefined}>
      {label}{actif ? (tri.sens === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function surfaceDistincte(liste) {
  const vues = new Set();
  let m2 = 0;
  liste.forEach((p) => {
    if (!p.codeParcelle || vues.has(p.codeParcelle)) return;
    vues.add(p.codeParcelle);
    m2 += (p.contenance || 0);
  });
  return m2;
}

// Conversion GeoJSON -> Leaflet. Les GeoJSON du cadastre sont en WGS84 avec
// l'ordre [longitude, latitude] ; Leaflet attend [latitude, longitude].
// Inverser est l'erreur classique : on se retrouve au large de la Somalie.
function anneauxLeaflet(geom) {
  if (!geom) return [];
  const inverse = (anneau) => anneau.map(([lng, lat]) => [lat, lng]);
  if (geom.type === 'Polygon') return [geom.coordinates.map(inverse)];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p.map(inverse));
  return [];
}

function ParcellesMap({ parcelles, locaux = [], contours = null, companyName }) {
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
    // Les locaux sont regroupés par parcelle : plusieurs milliers de lots sur
    // le même immeuble donneraient autant de marqueurs superposés, illisibles.
    const immeublesMap = new Map();
    locaux.forEach((l) => {
      if (!parseCoords(l.coordonnees) || !l.codeParcelle) return;
      if (!immeublesMap.has(l.codeParcelle)) immeublesMap.set(l.codeParcelle, { ...l, lots: 0 });
      immeublesMap.get(l.codeParcelle).lots += 1;
    });
    const validImmeubles = [...immeublesMap.values()];
    if (validParcelles.length === 0 && validImmeubles.length === 0) return;

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

    // Bâti en bleu canard de la charte, non bâti en navy : la distinction doit
    // être lisible sans cliquer.
    const batiIcon = L.divIcon({
      className: 'custom-bati-icon',
      html: '<div style="background:#33838B;color:#fff;width:24px;height:24px;border-radius:4px;border:2px solid white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3)">■</div>',
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

    // ---- Contours de parcelles ----------------------------------------------
    // Tracés par-dessus le fond, sous les marqueurs. Carmin de la charte de
    // colorisation, pour que l'écran et le plan colorié parlent la même langue.
    let groupeContours = null;
    if (contours && contours.size > 0) {
      groupeContours = L.layerGroup();
      let tracees = 0;
      parcelles.forEach((p) => {
        const geom = contours.get(p.codeParcelle);
        if (!geom) return;
        anneauxLeaflet(geom).forEach((anneaux) => {
          const poly = L.polygon(anneaux, {
            color: '#A01040', weight: 2, opacity: 0.9,
            fillColor: '#A01040', fillOpacity: 0.25,
          });
          poly.bindPopup(`
            <div style="font-family:system-ui;min-width:200px">
              <div style="font-weight:700;color:#A01040;margin-bottom:6px;border-bottom:2px solid #A01040;padding-bottom:4px">Contour cadastral</div>
              <div style="font-family:monospace;font-size:11px;color:#1e2952">${p.codeParcelle || ''}</div>
              <div style="font-size:12px;color:#475569;margin-top:3px">${p.commune || ''} — ${(p.contenance || 0).toLocaleString('fr-FR')} m²</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:3px">${p.adresse || ''}</div>
            </div>`);
          groupeContours.addLayer(poly);
          anneaux[0].forEach((pt) => bounds.push(pt));
          tracees++;
        });
      });
      if (tracees > 0) map.addLayer(groupeContours);
    }

    if (validImmeubles.length > 0) {
      const groupeBati = L.markerClusterGroup({
        chunkedLoading: true,
        iconCreateFunction: (cluster) => L.divIcon({
          html: `<div style="background:#33838B;color:#fff;width:40px;height:40px;border-radius:6px;border:3px solid #6DD5DC;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${cluster.getChildCount()}</div>`,
          className: 'custom-cluster-bati',
          iconSize: [40, 40],
        }),
      });
      validImmeubles.forEach((im) => {
        const c = parseCoords(im.coordonnees);
        if (!c) return;
        bounds.push(c);
        const m = L.marker(c, { icon: batiIcon });
        m.bindPopup(`
          <div style="font-family:system-ui;min-width:220px">
            <div style="font-weight:700;color:#33838B;margin-bottom:6px;border-bottom:2px solid #6DD5DC;padding-bottom:4px">Immeuble bâti</div>
            <div style="font-size:12px;color:#1e2952;margin-bottom:3px"><strong>📍 ${im.adresse || ''}</strong></div>
            <div style="font-size:12px;color:#475569;margin-bottom:3px">${im.commune || ''} (${im.departement || ''})</div>
            <div style="font-size:12px;color:#475569;margin-bottom:3px">🏢 ${im.lots.toLocaleString('fr-FR')} lot(s) au nom de la société</div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8">${im.codeParcelle || ''}</div>
          </div>`);
        groupeBati.addLayer(m);
      });
      map.addLayer(groupeBati);
      const couches = { 'Parcelles (non bâti)': markers, 'Immeubles (bâti)': groupeBati };
      if (groupeContours) couches['Contours cadastraux'] = groupeContours;
      L.control.layers(null, couches, { collapsed: false }).addTo(map);
    } else if (groupeContours) {
      L.control.layers(null, {
        'Parcelles (non bâti)': markers,
        'Contours cadastraux': groupeContours,
      }, { collapsed: false }).addTo(map);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [parcelles, locaux, contours, companyName]);

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
  const [parcellesBrutes, setParcellesBrutes] = useState([]);
  const [totalParcelles, setTotalParcelles] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [locauxBruts, setLocauxBruts] = useState([]);
  const [totalLocaux, setTotalLocaux] = useState(0);
  const [locauxLoading, setLocauxLoading] = useState(false);
  const [locauxError, setLocauxError] = useState(null);
  const [locauxTronque, setLocauxTronque] = useState(false);
  const [geoStatus, setGeoStatus] = useState(null);
  // Millésime annoncé par le backend, jamais codé en dur côté interface.
  const [millesime, setMillesime] = useState('2025');

  // ----------------------------------------------------------------------
  // FILTRE PAR TITRE DE DROIT
  // Le fichier DGFiP ne recense pas que des propriétaires : 8,5 % des lignes
  // portent un autre titre — gérant, gestionnaire d'un bien de l'État, syndic,
  // emphytéote, nu-propriétaire, usufruitier... Confondre les deux fausse la
  // lecture : l'ONF apparaît avec 5,85 millions d'hectares alors qu'il n'en
  // possède que 216 250, et le Ministère des Armées avec 188 162 hectares pour
  // 23 parcelles en propriété. Les agrégats ne portent donc que sur les titres
  // RETENUS, la propriété étant sélectionnée par défaut.
  // Le nu-propriétaire, l'emphytéote ou le preneur à construction détiennent
  // aussi des droits réels : c'est au notaire de décider s'il les inclut, d'où
  // un sélecteur plutôt qu'une règle figée.
  // ----------------------------------------------------------------------
  const [droitsChoisis, setDroitsChoisis] = useState(null);
  const [qParcelles, setQParcelles] = useState('');
  const [triParcelles, setTriParcelles] = useState({ champ: '', sens: 'asc' });
  const [qLocaux, setQLocaux] = useState('');
  const [triLocaux, setTriLocaux] = useState({ champ: '', sens: 'asc' });
  const [locauxGroupes, setLocauxGroupes] = useState(true);
  // Contours : chargés À LA DEMANDE et non avec le relevé. Sur un portefeuille de
  // mille six cents parcelles, les géométries représentent plusieurs mégaoctets —
  // inutile de les imposer à qui veut seulement le tableau et les exports.
  const [contours, setContours] = useState(null);

  const droitsPresents = (() => {
    const m = new Map();
    [...parcellesBrutes, ...locauxBruts].forEach((o) => {
      const d = o.codeDroit || '(non renseigné)';
      m.set(d, (m.get(d) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const propriete = droitsPresents.filter(([d]) => d.startsWith('P')).map(([d]) => d);
  // Par défaut TOUS les titres sont retenus : un relevé de patrimoine doit
  // d'abord montrer tout ce sur quoi la société apparaît, y compris les droits
  // réels autres que la propriété — emphytéose, bail à construction, usufruit.
  // On exclut ensuite en conscience, plutôt que de risquer d'omettre un bien.
  // Contrepartie assumée : les agrégats mêlent alors propriété et gestion, d'où
  // la part de propriété affichée en permanence sous les indicateurs (voir plus
  // bas), pour que la distinction ne puisse pas passer inaperçue.
  const droitsActifs = droitsChoisis ?? droitsPresents.map(([d]) => d);

  // Part de la propriété au sein de ce qui est affiché, pour lecture immédiate.
  const estPropriete = (o) => (o.codeDroit || '').startsWith('P');
  const parcellesPropriete = parcellesBrutes.filter(estPropriete);
  const surfaceEnPropriete = surfaceDistincte(parcellesPropriete);
  const localsPropriete = locauxBruts.filter(estPropriete).length;
  // Vrai dès qu'un titre autre que la propriété est retenu : c'est là que la
  // distinction doit être rappelée à l'écran.
  const melangeDesTitres = droitsActifs.some((d) => !d.startsWith('P'));

  const retenu = (o) => droitsActifs.includes(o.codeDroit || '(non renseigné)');
  const parcelles = parcellesBrutes.filter(retenu);
  const locaux = locauxBruts.filter(retenu);
  const ecartesParcelles = parcellesBrutes.length - parcelles.length;
  const ecartesLocaux = locauxBruts.length - locaux.length;
  const filtreActif = ecartesParcelles + ecartesLocaux > 0;
  const libelleFiltre = droitsActifs.length === droitsPresents.length
    ? `tous titres de droit (${droitsPresents.length} titre(s) présent(s) dans ce relevé)`
    : `titres retenus : ${droitsActifs.join(' ; ')}`;

  const basculerDroit = (d) => setDroitsChoisis(
    droitsActifs.includes(d) ? droitsActifs.filter((x) => x !== d) : [...droitsActifs, d]);
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

  // Géocodage à la parcelle. Les fichiers DGFiP ne portent aucune coordonnée :
  // on les obtient du plan cadastral via /api/geo, commune par commune.
  // Une SEULE passe couvre les deux volets : un local et une parcelle peuvent
  // partager la même référence cadastrale, il serait absurde de la demander
  // deux fois. Les listes s'affichent d'abord, la carte se remplit ensuite.
  const geocoderTout = async (listeParcelles, listeLocaux) => {
    const parCommune = new Map();
    [...listeParcelles, ...listeLocaux].forEach((o) => {
      if (!o.codeInsee || !o.codeParcelle) return;
      if (!parCommune.has(o.codeInsee)) parCommune.set(o.codeInsee, new Set());
      parCommune.get(o.codeInsee).add(o.codeParcelle);
    });
    if (parCommune.size === 0) return;

    const taches = [];
    for (const [insee, refs] of parCommune) {
      const liste = [...refs];
      for (let i = 0; i < liste.length; i += 400) taches.push([insee, liste.slice(i, i + 400)]);
    }
    setGeoStatus({ communes: parCommune.size, faites: 0, trouvees: 0, demandees: 0 });

    // On mémorise aussi la contenance renvoyée par le PLAN cadastral : comparée
    // à celle de la MATRICE, elle alimente le contrôle de cohérence. Les deux
    // sources sont mises à jour par des chaînes distinctes, un écart signale
    // donc une parcelle qui a bougé — division, réunion, remembrement,
    // arpentage — et qu'il faut instruire.
    const infos = new Map();
    const geometries = new Map();
    let faites = 0, trouvees = 0, demandees = 0;
    let curseur = 0;
    const travailleur = async () => {
      while (curseur < taches.length) {
        const [insee, refs] = taches[curseur++];
        demandees += refs.length;
        try {
          const suffixes = refs.map((r) => r.slice(5)).join(',');
          // contours=1 : la géométrie voyage AVEC le géocodage. Les deux
          // interrogeaient le même endpoint, les mêmes communes, les mêmes
          // références — c'était deux séries d'appels pour rien.
          const r = await fetch(`${BACKEND_URL}/api/geo?insee=${insee}&ids=${suffixes}&contours=1`);
          if (r.ok) {
            const d = await r.json();
            Object.entries(d.geo || {}).forEach(([ref, g]) => {
              infos.set(ref, {
                coordonnees: `${g.lat}, ${g.lng}`,
                contenanceCadastre: g.contenance_cadastre ?? null,
              });
              if (g.contour) geometries.set(ref, g.contour);
              trouvees++;
            });
          }
        } catch { /* une commune absente du plan ne doit pas casser la carte */ }
        faites++;
        setGeoStatus({ communes: parCommune.size, faites, trouvees, demandees });
        setContours(new Map(geometries));   // tracé progressif : la carte se garnit
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, taches.length) }, travailleur));

    const poser = (o) => (infos.has(o.codeParcelle)
      ? { ...o, ...infos.get(o.codeParcelle), _planLu: true }
      : { ...o, _planLu: true, _absenteDuPlan: true });
    setParcellesBrutes((prev) => prev.map(poser));
    setLocauxBruts((prev) => prev.map(poser));
    setContours(new Map(geometries));
    setGeoStatus({ communes: parCommune.size, faites, trouvees, demandees, termine: true });
  };

  const fetchParcelles = async (siren) => {
    setParcellesLoading(true); setParcellesError(null); setParcellesBrutes([]); setTotalParcelles(0); setTruncated(false); setGeoStatus(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/parcelles?siren=${encodeURIComponent(siren)}&maxResults=10000`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.erreur || e.error || `HTTP ${r.status}`); }
      const data = await r.json();
      const liste = data.parcelles || [];
      setParcellesBrutes(liste);
      setTotalParcelles(data.total || 0);
      setTruncated(data.truncated || false);
      setMillesime(data.millesime || '2025');
      setParcellesLoading(false);
      return liste;
    } catch (e) {
      setParcellesError(`Erreur : ${e.message}`); setParcellesLoading(false); return [];
    }
  };

  // Volet bâti, inexistant avant le passage aux fichiers DGFiP 2025.
  const fetchLocaux = async (siren) => {
    setLocauxLoading(true); setLocauxError(null); setLocauxBruts([]); setTotalLocaux(0);
    try {
      const r = await fetch(`${BACKEND_URL}/api/locaux?siren=${encodeURIComponent(siren)}&maxResults=20000`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.erreur || e.error || `HTTP ${r.status}`); }
      const data = await r.json();
      const liste = data.locaux || [];
      setLocauxBruts(liste);
      setTotalLocaux(data.total || 0);
      setLocauxTronque(!!data.tronque);
      return liste;
    } catch (e) { setLocauxError(`Erreur : ${e.message}`); return []; }
    finally { setLocauxLoading(false); }
  };

  const goToStep1 = () => setStep(1);
  const goToStep2 = () => { if (companyName.trim().length < 2) return; setStep(2); searchSiren(); };
  const selectCompany = (c) => setSelectedCompany(c);
  const confirmCompany = () => {
    if (!selectedCompany) return;
    setStep(3);
    setDroitsChoisis(null);
    setQParcelles(''); setQLocaux('');
    setContours(null);
    setTriParcelles({ champ: '', sens: 'asc' }); setTriLocaux({ champ: '', sens: 'asc' });
    // Les deux relevés partent ensemble ; le géocodage attend les deux pour
    // n'interroger chaque commune qu'une fois.
    Promise.all([
      fetchParcelles(selectedCompany.siren),
      fetchLocaux(selectedCompany.siren),
    ]).then(([lp, ll]) => geocoderTout(lp, ll));
  };

  const resetAll = () => {
    setStep(1); setCompanyName(''); setPappersResults([]); setSelectedCompany(null);
    setPappersError(null); setParcellesBrutes([]); setTotalParcelles(0); setParcellesError(null); setTruncated(false);
    setLocauxBruts([]); setTotalLocaux(0); setLocauxError(null); setGeoStatus(null); setLocauxTronque(false);
    setDroitsChoisis(null);
  };

  // ----------------------------------------------------------------------
  // CONTRÔLE DE COHÉRENCE MATRICE / PLAN CADASTRAL
  // La contenance figure dans deux produits DGFiP distincts : la matrice, qui
  // porte la propriété, et le plan, qui porte la géométrie. Ils sont mis à jour
  // par des chaînes différentes et à des rythmes différents. Un écart sur une
  // même référence signale donc que la parcelle a bougé — division, réunion,
  // remembrement, document d'arpentage — et que la désignation qu'on s'apprête
  // à reprendre ne décrit peut-être plus le même objet.
  // Utilité : sur un portefeuille de mille six cents parcelles, personne ne
  // demande mille six cents relevés de propriété. Ce contrôle produit la liste
  // COURTE de celles qui méritent qu'on s'y arrête.
  // ----------------------------------------------------------------------
  const TOLERANCE_M2 = 2;          // en deçà, arrondi ou précision géométrique
  const TOLERANCE_PCT = 0.01;      // 1 %

  const ecartDe = (o) => {
    if (o.contenanceCadastre == null || o.contenance == null) return null;
    return Number(o.contenance) - Number(o.contenanceCadastre);
  };

  const classerEcart = (o) => {
    if (!o._planLu) return 'attente';
    if (o._absenteDuPlan || o.contenanceCadastre == null) return 'absente';
    const m = Number(o.contenance || 0);
    const pl = Number(o.contenanceCadastre);
    const e = m - pl;
    if (e === 0) return 'concordante';
    return Math.abs(e) <= Math.max(TOLERANCE_M2, m * TOLERANCE_PCT) ? 'mineur' : 'notable';
  };

  // Une parcelle détenue à deux titres apparaît deux fois : on ne la contrôle
  // et ne la compte qu'une seule fois.
  const coherence = (() => {
    const vues = new Map();
    parcelles.forEach((o) => {
      if (!o.codeParcelle || vues.has(o.codeParcelle)) return;
      vues.set(o.codeParcelle, { ...o, _classe: classerEcart(o) });
    });
    const tout = [...vues.values()];
    const parClasse = (c) => tout.filter((o) => o._classe === c);
    const ecarts = [...parClasse('notable'), ...parClasse('mineur')]
      .map((o) => ({ ...o, _ecart: Number(o.contenance || 0) - Number(o.contenanceCadastre) }))
      .sort((a, b) => Math.abs(b._ecart) - Math.abs(a._ecart));
    return {
      controlees: tout.length,
      concordantes: parClasse('concordante').length,
      mineurs: parClasse('mineur').length,
      notables: parClasse('notable').length,
      absentes: parClasse('absente').length,
      attente: parClasse('attente').length,
      ecarts,
    };
  })();

  // Vues des tableaux : filtrées puis triées. Les agrégats, la carte et les
  // exports continuent de porter sur l'ensemble — seul l'affichage est réduit,
  // sans quoi un filtre de lecture fausserait un livrable.
  const parcellesAffichees = trierListe(
    filtrerTexte(parcelles, qParcelles,
      ['codeParcelle', 'commune', 'departement', 'region', 'adresse', 'natureCulture', 'codeDroit']),
    triParcelles);

  // Vue par immeuble : un lot par ligne devient illisible passé quelques
  // centaines. On regroupe par parcelle en comptant les lots.
  const immeublesListe = (() => {
    const m = new Map();
    locaux.forEach((l) => {
      const k = l.codeParcelle || '(sans référence)';
      if (!m.has(k)) {
        m.set(k, { ...l, nbLots: 0, titres: new Set(), batiments: new Set() });
      }
      const e = m.get(k);
      e.nbLots += 1;
      if (l.codeDroit) e.titres.add(l.codeDroit);
      if (l.batiment) e.batiments.add(l.batiment);
      return e;
    });
    return [...m.values()].map((e) => ({
      ...e,
      titresTxt: [...e.titres].join(' ; '),
      batimentsTxt: [...e.batiments].sort().join(', '),
    }));
  })();

  const locauxAffiches = trierListe(
    filtrerTexte(locaux, qLocaux,
      ['codeParcelle', 'commune', 'departement', 'adresse', 'batiment', 'entree', 'niveau', 'porte', 'codeDroit']),
    triLocaux);
  const immeublesAffiches = trierListe(
    filtrerTexte(immeublesListe, qLocaux,
      ['codeParcelle', 'commune', 'departement', 'adresse', 'batimentsTxt', 'titresTxt']),
    triLocaux);

  // Nombre d'immeubles distincts : un même lot peut apparaître deux fois à des
  // titres différents (propriétaire ET gérant), ce ne sont pas des doublons.
  const immeubles = new Set(locaux.map((l) => l.codeParcelle).filter(Boolean)).size;

  // Forme juridique affichable, une seule fois pour l'interface et les exports.
  // ⚠ L'API Recherche d'Entreprises renvoie la CHAÎNE « N/C » quand elle ne la
  // connaît pas : un repli par « || » ne se déclenche donc pas. Il faut tester
  // la valeur, pas seulement sa présence.
  const formeJuridiqueAffichee = () => {
    const api = (selectedCompany?.formeJuridique || '').trim();
    if (api && api.toUpperCase() !== 'N/C') return api;
    const src = parcelles[0] || locaux[0] || {};
    return src.formeJuridiqueLibelle
      ? `${src.formeJuridiqueLibelle} (${src.formeJuridique})`
      : 'forme juridique non communiquée';
  };

  const computeStats = () => {
    const byDept = {};
    const byCommune = {};
    const vuesDept = new Set(), vuesComm = new Set();
    parcelles.forEach(p => {
      const dept = p.departement || 'N/C';
      const comm = p.commune || 'N/C';
      // Les surfaces ne s'additionnent qu'une fois par parcelle (cf. surfaceDistincte).
      const cleD = dept + '|' + p.codeParcelle, cleC = comm + '|' + p.codeParcelle;
      const neufD = p.codeParcelle && !vuesDept.has(cleD);
      const neufC = p.codeParcelle && !vuesComm.has(cleC);
      if (neufD) vuesDept.add(cleD);
      if (neufC) vuesComm.add(cleC);
      if (!byDept[dept]) byDept[dept] = { count: 0, surface: 0 };
      byDept[dept].count++;
      if (neufD) byDept[dept].surface += (p.contenance || 0);
      if (!byCommune[comm]) byCommune[comm] = { count: 0, surface: 0, departement: dept };
      byCommune[comm].count++;
      if (neufC) byCommune[comm].surface += (p.contenance || 0);
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

  // Fabrique d'onglet à la charte FIDAL, partagée par les deux volets : même
  // bandeau, même ligne de sujet, mêmes en-têtes navy et or, même filtre
  // automatique. Un seul endroit à corriger le jour où la charte bouge.
  const ajouterOnglet = (wb, { nom, headers, widths, sujet, lignes, remplir, aligner }) => {
    const numCols = headers.length;
    const ws = wb.addWorksheet(nom, { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.columns = widths.map((w) => ({ width: w }));

    // Largeur du bandeau = largeur RÉELLE du tableau, et non une valeur fixe.
    // Une colonne Excel de largeur w (en caractères) mesure environ w × 7 + 5
    // pixels avec Calibri 11. Les deux onglets n'ayant pas les mêmes colonnes
    // (190 unités pour les parcelles, 200 pour les locaux), un bandeau figé à
    // 1 240 px s'arrêtait avant le bord droit du tableau, différemment sur
    // chacun. L'ancrage « br » sur la dernière colonne verrouille le bord.
    const bannerW = widths.reduce((t, w) => t + Math.round(w * 7) + 5, 0);
    const bannerH = 150;
    ws.getRow(1).height = bannerH * 0.75;   // px -> points
    const imgId = wb.addImage({ base64: drawBannerDataUrl(bannerW, bannerH), extension: 'png' });
    // editAs: 'twoCell' est INDISPENSABLE. Par défaut ExcelJS écrit
    // editAs="oneCell", qui signifie « déplacer l'image avec les cellules mais
    // ne pas la redimensionner » : Excel conserve alors la taille propre de
    // l'image et ignore le coin inférieur droit de l'ancrage, si bien que le
    // bandeau s'arrêtait avant le bord du tableau. Avec 'twoCell', l'image est
    // dimensionnée sur la zone ancrée, donc de A1 au bord de la dernière
    // colonne, quelles que soient les largeurs choisies.
    ws.addImage(imgId, {
      tl: { col: 0, row: 0 },
      br: { col: numCols, row: 1 },
      editAs: 'twoCell',
    });

    ws.mergeCells(2, 1, 2, numCols);
    const sujetCell = ws.getCell(2, 1);
    sujetCell.value = sujet;
    sujetCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF0F2238' } };
    sujetCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F4E0' } };
    sujetCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // Hauteur de l'en-tête calculée depuis le repli de chaque intitulé dans sa
    // colonne : à 24 points figés, « Nature culture » ou « Lot (bât./entrée/
    // niv./porte) » se renvoyaient à la ligne puis se faisaient rogner.
    const lignesEntete = Math.max(...headers.map((h, i) =>
      Math.ceil(String(h).length / Math.max(widths[i] - 1, 4))));
    const headerRow = ws.getRow(3);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFE3CC7A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2238' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFE3CC7A' } } };
    });
    headerRow.height = Math.max(24, lignesEntete * 14 + 10);

    const navy = { name: 'Calibri', size: 10, color: { argb: 'FF0F2238' } };
    lignes.forEach((item, i) => {
      const row = ws.getRow(i + 4);
      remplir(row, item, i);
      for (let c = 1; c <= numCols; c++) {
        const cell = row.getCell(c);
        const a = aligner(c);
        if (!a.styleLibre) cell.font = navy;
        if (a.nombre) { cell.alignment = { horizontal: 'right', vertical: 'middle' }; cell.numFmt = '#,##0'; }
        else if (a.centre) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        else cell.alignment = { vertical: 'middle' };
      }
    });

    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + lignes.length, column: numCols } };
    return ws;
  };

  // Lien cartographique : par coordonnées si la parcelle est géocodée, sinon
  // par adresse. Sans repli, la colonne resterait vide pour les 3 % de
  // parcelles absentes du plan cadastral.
  // Distinguer « sans objet » de « non renseigné » : un local n'a pas de nature
  // de culture, une parcelle n'a pas de numéro de lot. Un blanc laisserait
  // croire à une donnée manquante.
  const SANS_OBJET = '—';

  const lienCarte = (o) => buildSatelliteLink(o.coordonnees)
    || (o.adresse && o.commune
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.adresse} ${o.commune}`)}`
      : null);

  const exportExcel = async () => {
    if (!parcelles.length || !window.ExcelJS) {
      if (!window.ExcelJS) alert("Librairie Excel (ExcelJS) non chargée");
      return;
    }
    setExportingExcel(true);
    try {
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      const fj = formeJuridiqueAffichee();
      const sujet = (quoi, n) => `${selectedCompany?.nom || ''}  |  SIREN : ${selectedCompany?.siren || ''}`
        + `  |  ${selectedCompany?.statut === 'Cessée' ? 'SOCIÉTÉ CESSÉE' : 'société active'}`
        + `  |  ${fj}  |  ${n.toLocaleString('fr-FR')} ${quoi}`
        + `  |  Source : fichiers des personnes morales (DGFiP), situation au 1er janvier ${millesime}`
        + ` — Licence Ouverte 2.0  |  ${libelleFiltre}`
        + `  |  Généré le ${new Date().toLocaleDateString('fr-FR')}`;

      // --- Onglet 1 : tous les biens, bâti et non bâti confondus ---
      // Placé EN PREMIER : c'est la vue d'ensemble, celle qu'on ouvre pour
      // instruire un dossier. Les deux onglets de détail suivent.
      // Tri par commune puis référence cadastrale : l'ordre dans lequel on
      // instruit un dossier. Le code INSEE départage les communes homonymes de
      // départements différents.
      const tousBiens = [
        ...parcelles.map((o) => ({ ...o, _bati: false })),
        ...locaux.map((o) => ({ ...o, _bati: true })),
      ].sort((a, b) =>
        (a.commune || '').localeCompare(b.commune || '', 'fr')
        || (a.codeInsee || '').localeCompare(b.codeInsee || '')
        || (a.codeParcelle || '').localeCompare(b.codeParcelle || '')
        || (a._bati ? 1 : 0) - (b._bati ? 1 : 0)
        || `${a.batiment || ''}${a.entree || ''}${a.niveau || ''}${a.porte || ''}`
          .localeCompare(`${b.batiment || ''}${b.entree || ''}${b.niveau || ''}${b.porte || ''}`));

      // Surface à sommer : renseignée UNE SEULE FOIS par parcelle. Une parcelle
      // revient autant de fois qu'elle a de titulaires de droits — la SNCF
      // compte 315 234 lignes pour 159 723 parcelles — donc totaliser la
      // contenance répétée surévaluerait la surface de près du double.
      const dejaComptee = new Set();
      tousBiens.forEach((o) => {
        o._surfaceASommer = (!o._bati && o.codeParcelle && !dejaComptee.has(o.codeParcelle)
          && o.contenance) ? o.contenance : null;
        if (o._surfaceASommer) dejaComptee.add(o.codeParcelle);
      });

      if (tousBiens.length) {
        // Fonds CLAIRS : sur un dossier où 15 451 lignes sur 17 087 sont du
        // bâti, des aplats saturés écrasent la lecture. Le beige et le cyan
        // pâle de la charte suffisent, le symbole et le mot portant le reste.
        const BEIGE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5EDD3' } };
        const CYAN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFF1F3' } };
        const NAVY_TEXTE = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F2238' } };
        ajouterOnglet(wb, {
          nom: 'Tous les biens',
          headers: ['#', 'Nature', 'Référence cadastrale', 'Commune', 'Département', 'Région',
            'Adresse', 'Surface parcelle (m²)', 'Surface à sommer (m²)', 'Surface plan (m²)',
            'Écart (m²)', 'Nature culture', 'Lot bât./ent./niv./porte', 'Droit', 'Carte', 'Extrait DGFiP', 'Plan colorisé'],
          widths: [5, 16, 19, 22, 18, 20, 32, 16, 17, 15, 13, 16, 27, 26, 16, 16, 16],
          sujet: sujet('bien(s) — ● non bâti, ■ bâti', tousBiens.length),
          lignes: tousBiens,
          aligner: (c) => ({ centre: c === 1 || c === 12 || c === 13,
            nombre: c >= 8 && c <= 11, styleLibre: c === 2 || c === 15 || c === 16 || c === 17 }),
          remplir: (row, o, i) => {
            row.getCell(1).value = i + 1;
            // Trois marqueurs redondants : couleur, symbole et mot. Le tableau
            // reste lisible imprimé en noir et blanc, ou par un daltonien.
            const nat = row.getCell(2);
            nat.value = o._bati ? '■ BÂTI' : '● NON BÂTI';
            nat.fill = o._bati ? CYAN_FILL : BEIGE_FILL;
            nat.font = NAVY_TEXTE;
            nat.alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(3).value = o.codeParcelle || '';
            row.getCell(4).value = o.commune || '';
            row.getCell(5).value = o.departement || '';
            row.getCell(6).value = o.region || '';
            row.getCell(7).value = o.adresse || '';
            // Un tiret marque le SANS OBJET ; une cellule vide en colonne 9
            // signifie « surface déjà comptée sur une ligne précédente ».
            row.getCell(8).value = o._bati ? SANS_OBJET : (o.contenance || 0);
            row.getCell(9).value = o._bati ? SANS_OBJET : (o._surfaceASommer || '');
            // Contrôle de cohérence : contenance du PLAN et écart avec la matrice.
            const ec = o._bati ? null : ecartDe(o);
            row.getCell(10).value = o._bati ? SANS_OBJET
              : (o.contenanceCadastre != null ? Number(o.contenanceCadastre) : '');
            row.getCell(11).value = ec == null ? (o._bati ? SANS_OBJET : '') : ec;
            row.getCell(12).value = o._bati ? SANS_OBJET : (o.natureCulture || '');
            row.getCell(13).value = o._bati
              ? [o.batiment, o.entree, o.niveau, o.porte].filter(Boolean).join(' / ')
              : SANS_OBJET;
            row.getCell(14).value = o.codeDroit || '';
            const lien = lienCarte(o);
            const cell = row.getCell(15);
            if (lien) {
              cell.value = { text: o.coordonnees ? 'Voir (parcelle)' : 'Voir (adresse)', hyperlink: lien };
              cell.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF33838B' } };
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cell.value = '';
            // Deux liens, deux usages. « Extrait DGFiP » livre le PDF brut, pièce
            // autonome qu'on peut joindre à un dossier. « Plan colorisé » ouvre
            // PAINT, qui génère l'extrait ET colorie la parcelle en carmin — c'est
            // l'outil de travail, et c'est de là que part l'utilisateur en pratique.
            const extrait = lienExtraitCadastral(o.codeParcelle);
            const cellEx = row.getCell(16);
            if (extrait) {
              cellEx.value = { text: 'Extrait DGFiP', hyperlink: extrait };
              cellEx.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF0F2238' } };
              cellEx.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cellEx.value = '';
            const colorise = lienPaintColorise(o.codeParcelle, o.commune, contours?.get(o.codeParcelle));
            const cellCo = row.getCell(17);
            if (colorise) {
              cellCo.value = { text: 'Colorier', hyperlink: colorise };
              cellCo.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FFA01040' } };
              cellCo.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cellCo.value = '';
          },
        });
      }

      // --- Onglet 2 : la liste courte des écarts de contenance ---
      // C'est la feuille qu'on emporte : les parcelles à instruire, et elles
      // seules. Absente du classeur s'il n'y a rien à signaler.
      if (coherence.ecarts.length) {
        ajouterOnglet(wb, {
          nom: 'Écarts de contenance',
          headers: ['#', 'Ampleur', 'Référence cadastrale', 'Commune', 'Département',
            'Adresse', 'Matrice (m²)', 'Plan (m²)', 'Écart (m²)', 'Écart (%)', 'Droit', 'Carte',
            'Extrait DGFiP', 'Plan colorisé'],
          widths: [5, 12, 19, 22, 18, 32, 14, 13, 13, 12, 26, 16, 16, 16],
          sujet: `${selectedCompany?.nom || ''}  |  ${coherence.ecarts.length} écart(s) sur `
            + `${coherence.controlees} parcelle(s) contrôlée(s)  |  ${coherence.concordantes} concordante(s)`
            + `  |  Matrice DGFiP contre plan cadastral (version Etalab)  |  Écart notable au-delà de 2 m² ou 1 %`,
          lignes: coherence.ecarts,
          aligner: (c) => ({ centre: c === 1 || c === 2, nombre: c >= 7 && c <= 10, styleLibre: c >= 12 }),
          remplir: (row, o, i) => {
            row.getCell(1).value = i + 1;
            row.getCell(2).value = o._classe === 'notable' ? 'NOTABLE' : 'mineur';
            row.getCell(3).value = o.codeParcelle || '';
            row.getCell(4).value = o.commune || '';
            row.getCell(5).value = o.departement || '';
            row.getCell(6).value = o.adresse || '';
            row.getCell(7).value = Number(o.contenance || 0);
            row.getCell(8).value = Number(o.contenanceCadastre || 0);
            row.getCell(9).value = o._ecart;
            row.getCell(10).value = o.contenance
              ? Math.round(1000 * o._ecart / Number(o.contenance)) / 10 : '';
            row.getCell(11).value = o.codeDroit || '';
            const lien = lienCarte(o);
            const cell = row.getCell(12);
            if (lien) {
              cell.value = { text: o.coordonnees ? 'Voir (parcelle)' : 'Voir (adresse)', hyperlink: lien };
              cell.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF33838B' } };
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cell.value = '';
            const extrait = lienExtraitCadastral(o.codeParcelle);
            const cellEx = row.getCell(13);
            if (extrait) {
              cellEx.value = { text: 'Extrait DGFiP', hyperlink: extrait };
              cellEx.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF0F2238' } };
              cellEx.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cellEx.value = '';
            const colorise = lienPaintColorise(o.codeParcelle, o.commune, contours?.get(o.codeParcelle));
            const cellCo = row.getCell(14);
            if (colorise) {
              cellCo.value = { text: 'Colorier', hyperlink: colorise };
              cellCo.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FFA01040' } };
              cellCo.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cellCo.value = '';
          },
        });
      }

      // --- Onglet 3 : le non bâti seul ---
      ajouterOnglet(wb, {
        nom: 'Parcelles',
        headers: ['#', 'Référence cadastrale', 'Commune', 'Département', 'Région', 'Adresse', 'Surface (m²)', 'Nature culture', 'Droit', 'Carte'],
        widths: [5, 18, 22, 18, 22, 35, 12, 14, 26, 18],
        sujet: sujet('parcelle(s)', totalParcelles),
        lignes: parcelles,
        aligner: (c) => ({ centre: c === 1 || c === 8, nombre: c === 7, styleLibre: c === 10 }),
        remplir: (row, p, i) => {
          row.getCell(1).value = i + 1;
          row.getCell(2).value = p.codeParcelle || '';
          row.getCell(3).value = p.commune || '';
          row.getCell(4).value = p.departement || '';
          row.getCell(5).value = p.region || '';
          row.getCell(6).value = p.adresse || '';
          row.getCell(7).value = p.contenance || 0;
          row.getCell(8).value = p.natureCulture || '';
          row.getCell(9).value = p.codeDroit || '';
          const lien = lienCarte(p);
          const cell = row.getCell(10);
          if (lien) {
            cell.value = { text: p.coordonnees ? 'Voir (parcelle)' : 'Voir (adresse)', hyperlink: lien };
            cell.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF33838B' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else cell.value = '';
        },
      });

      // --- Onglet 4 : le bâti seul. Ni surface ni invariant dans la source : un lot
      // s'identifie par bâtiment / entrée / niveau / porte sur sa parcelle. ---
      if (locaux.length) {
        ajouterOnglet(wb, {
          nom: 'Locaux',
          headers: ['#', 'Référence parcelle', 'Commune', 'Département', 'Région', 'Adresse', 'Bâtiment', 'Entrée', 'Niveau', 'Porte', 'Droit', 'Carte'],
          widths: [5, 18, 22, 18, 22, 35, 10, 8, 8, 10, 26, 18],
          sujet: sujet('local(aux)', totalLocaux),
          lignes: locaux,
          aligner: (c) => ({ centre: c === 1 || (c >= 7 && c <= 10), nombre: false, styleLibre: c === 12 }),
          remplir: (row, l, i) => {
            row.getCell(1).value = i + 1;
            row.getCell(2).value = l.codeParcelle || '';
            row.getCell(3).value = l.commune || '';
            row.getCell(4).value = l.departement || '';
            row.getCell(5).value = l.region || '';
            row.getCell(6).value = l.adresse || '';
            row.getCell(7).value = l.batiment || '';
            row.getCell(8).value = l.entree || '';
            row.getCell(9).value = l.niveau || '';
            row.getCell(10).value = l.porte || '';
            row.getCell(11).value = l.codeDroit || '';
            const lien = lienCarte(l);
            const cell = row.getCell(12);
            if (lien) {
              cell.value = { text: l.coordonnees ? 'Voir (parcelle)' : 'Voir (adresse)', hyperlink: lien };
              cell.font = { name: 'Calibri', size: 10, bold: true, underline: true, color: { argb: 'FF33838B' } };
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else cell.value = '';
          },
        });
      }

      // --- Onglet 5 : mentions, à conserver dans tout livrable ---
      const wsM = wb.addWorksheet('Sources et limites');
      wsM.columns = [{ width: 120 }];
      [
        ['Source', `Fichiers des locaux et des parcelles des personnes morales (DGFiP), situation au 1er janvier ${millesime}.`],
        ['Licence', 'Licence Ouverte 2.0 (Etalab). Attribution requise.'],
        ['Géolocalisation', 'Plan cadastral informatisé (DGFiP, version Etalab). Position au centroïde de la parcelle.'],
        ['Portée', "Donnée de pré-contrôle. Seul le relevé de propriété ou l'état hypothécaire fait foi."],
        ['Périmètre', 'Personnes physiques, entreprises individuelles et sociétés unipersonnelles exclues par construction du fichier. Les personnes morales simplement locataires n\'y figurent pas.'],
        ['Surfaces', "La surface totale est calculée sur les parcelles distinctes : une parcelle figure autant de fois qu'elle a de titulaires de droits (propriétaire, gérant, syndic, usufruitier...)."],
        ['Feuille « Tous les biens »', "Tri par défaut : commune, puis référence cadastrale. Deux colonnes de surface : « Surface parcelle » est la contenance, répétée sur chacune des lignes de la parcelle — ne la totalisez pas ; « Surface à sommer » ne la porte qu'une fois par parcelle, c'est celle-là qui se totalise sans erreur. Un tiret (—) signale une donnée SANS OBJET : un local n'a ni surface ni nature de culture dans la source, une parcelle n'a pas de numéro de lot. Une cellule VIDE en « Surface à sommer » signifie que la contenance a déjà été comptée sur une ligne précédente de la même parcelle."],
        ['Bâti', "La source ne fournit aucune surface pour les locaux, ni de numéro invariant : un lot s'identifie par bâtiment, entrée, niveau et porte."],
        ['Plans cadastraux — deux liens', "La colonne « Extrait DGFiP » ouvre le PDF de l'extrait officiel du plan, pièce autonome que l'on peut joindre à un dossier. La colonne « Plan colorisé » ouvre l'application PAINT du cabinet, qui génère le même extrait ET colorie la parcelle en carmin, prêt à annoter et à exporter. Le service interroge le service de consultation du plan cadastral : les liens sont à cliquer un par un, une extraction en masse serait refusée. La colorisation automatique exige que les contours aient été chargés au moment de l'export."],
        ['Statut de la société', `${selectedCompany?.statut === 'Cessée'
          ? "Société CESSÉE au répertoire Sirene, et pourtant encore inscrite à la documentation cadastrale : liquidation non clôturée, biens non liquidés, ou radiation postérieure au 1er janvier " + millesime + ". À instruire avant toute reprise."
          : "Société active au répertoire Sirene à la date de génération du présent document."} Source du statut : API Recherche d'Entreprises (gouv.fr), distincte des fichiers cadastraux.`],
        ['Contrôle de cohérence', `La contenance figure dans deux produits DGFiP distincts, mis à jour par des chaînes différentes : la matrice, qui porte la propriété, et le plan cadastral, qui porte la géométrie. Résultat sur ce relevé : ${coherence.concordantes} parcelle(s) concordante(s), ${coherence.notables} écart(s) notable(s), ${coherence.mineurs} écart(s) mineur(s), ${coherence.absentes} absente(s) du plan, sur ${coherence.controlees} contrôlée(s). Un écart signale une parcelle qui a bougé — division, réunion, remembrement, document d'arpentage — donc une désignation à vérifier avant reprise. Rappel : la contenance cadastrale n'est qu'indicative, seul un arpentage fait foi.`],
        ['Titres de droit', `${libelleFiltre}. Le fichier DGFiP recense les détenteurs de droits réels, pas seulement les propriétaires : gérant, gestionnaire d'un bien de l'État, syndic de copropriété, emphytéote, nu-propriétaire, usufruitier, preneur ou bailleur à construction. Ce classeur ne contient que les lignes portant les titres retenus ci-dessus.`],
        ['Liens cartographiques', (() => {
          const tousDont = [...parcelles, ...locaux];
          const localises = tousDont.filter((o) => o.coordonnees).length;
          const base = `${localises.toLocaleString('fr-FR')} enregistrement(s) sur ${tousDont.length.toLocaleString('fr-FR')} pointent le centroïde de la parcelle ; les autres pointent l'adresse.`;
          return geoStatus && !geoStatus.termine
            ? `${base} ATTENTION : ce classeur a été produit AVANT la fin du géocodage. Réexporter une fois la localisation terminée pour obtenir des liens à la parcelle.`
            : base;
        })()],
      ].forEach(([titre, texte], i) => {
        const r = wsM.getRow(i + 1);
        r.getCell(1).value = `${titre} — ${texte}`;
        r.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: 'FF0F2238' } };
        r.getCell(1).alignment = { vertical: 'top', wrapText: true };
        r.height = 30;
      });

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
      doc.text(`SIREN : ${selectedCompany?.siren} • ${formeJuridiqueAffichee()}`, margin, bandH + 18);
      doc.setFontSize(7.5);
      doc.text(libelleFiltre.charAt(0).toUpperCase() + libelleFiltre.slice(1)
        + (selectedCompany?.statut === 'Cessée'
          ? ' — SOCIÉTÉ CESSÉE au répertoire Sirene, encore inscrite à la documentation cadastrale'
          : ''), margin, bandH + 23);
      doc.setFontSize(9);
      doc.setTextColor(...NAVY);
      doc.text(dateStr, pageWidth - margin, bandH + 18, { align: 'right' });

      // + 31 et non + 26 : la mention des titres de droit occupe la ligne
      // bandH + 23, le cadre beige doit démarrer sous elle.
      let y = bandH + 31;

      // Le cadre doit couvrir le titre PLUS les quatre lignes de mentions, qui
      // descendent jusqu'à y + 14,5. Sous-dimensionné, il laissait les mentions
      // déborder sur le fond blanc.
      const hMentions = 26;   // cinq lignes de mentions
      doc.setFillColor(...BEIGE);
      doc.rect(margin, y - 4, pageWidth - 2 * margin, hMentions, 'F');
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(1.5);
      doc.line(margin, y - 4, margin, y - 4 + hMentions);
      doc.setTextColor(...NAVY);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(`${formatNumberForPdf(totalParcelles)} parcelle(s) au total`, margin + 3, y);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      // Accents conservés : jsPDF les rend correctement en Helvetica, comme le
      // montre la ligne « Généré par REDPAR » du pied de page. Un document
      // remis à un client ne se lit pas en texte désaccentué.
      doc.text(`Source : fichiers des personnes morales (DGFiP), situation au 1er janvier ${millesime} • Licence Ouverte 2.0`, margin + 3, y + 4);
      doc.text('Géolocalisation : plan cadastral informatisé (DGFiP, version Etalab), position au centroïde de la parcelle.', margin + 3, y + 7.5);
      doc.text('Donnée de pré-contrôle : seul le relevé de propriété ou l\'état hypothécaire fait foi. Personnes physiques,', margin + 3, y + 11);
      doc.text('entreprises individuelles et sociétés unipersonnelles hors périmètre ; simples locataires absents.', margin + 3, y + 14.5);
      doc.text(`Cohérence matrice / plan cadastral : ${coherence.concordantes} concordante(s), `
        + `${coherence.notables} écart(s) notable(s), ${coherence.mineurs} mineur(s), `
        + `${coherence.absentes} absente(s) du plan, sur ${coherence.controlees} contrôlée(s).`,
        margin + 3, y + 18);
      y += 21;   // le bloc de mentions compte désormais cinq lignes

      const cellW = (pageWidth - 2 * margin - 8) / 3;
      const totalSurfaceCalc = surfaceDistincte(parcelles);
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

  const totalSurface = surfaceDistincte(parcelles);
  const parcellesDistinctes = new Set(parcelles.map((p) => p.codeParcelle).filter(Boolean)).size;
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
                {parcellesLoading ? 'Recherche dans les fichiers DGFiP...' : `${totalParcelles.toLocaleString('fr-FR')} parcelle${totalParcelles > 1 ? 's' : ''} • ${parcelles.length.toLocaleString('fr-FR')} affichée${parcelles.length > 1 ? 's' : ''}`}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {!parcellesLoading && parcelles.length > 0 && geoStatus && !geoStatus.termine && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-700 mr-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    localisation en cours — attendez pour des liens à la parcelle
                  </span>
                )}
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
                <div className="text-sm text-blue-200 flex items-center gap-2 flex-wrap">
                  <span>SIREN : <span className="font-mono text-white">{selectedCompany?.siren}</span></span>
                  {selectedCompany?.statut && (
                    <span className={`text-xs px-2 py-0.5 rounded border ${selectedCompany.statut === 'Active'
                      ? 'bg-green-900/40 text-green-200 border-green-700'
                      : 'bg-amber-400 text-blue-950 border-amber-300 font-semibold'}`}>
                      {selectedCompany.statut}
                    </span>
                  )}
                  <span>{' • '}</span>
                  {/* L'API Recherche d'Entreprises ne renvoie pas toujours la forme
                      juridique (« N/C ») : on retombe alors sur celle des fichiers
                      DGFiP, avec son code entre parenthèses pour rester vérifiable. */}
                  <span>{formeJuridiqueAffichee()}</span>
                </div>
                {selectedCompany?.statut === 'Cessée' && (
                  <div className="mt-3 text-xs bg-amber-400 text-blue-950 rounded-lg px-3 py-2">
                    <strong>Société cessée</strong> au répertoire Sirene, et pourtant encore inscrite à la
                    documentation cadastrale : liquidation non clôturée, biens non liquidés, ou radiation
                    postérieure au 1er janvier {millesime}. À instruire avant toute reprise.
                  </div>
                )}
              </div>
            </div>

            {parcellesLoading && (
              <div className="bg-white rounded-xl border border-stone-200 p-12 shadow-sm flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                <span className="text-stone-600">Interrogation des fichiers des personnes morales (DGFiP, millésime 2025)...</span>
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
                <div className="text-sm text-amber-800">Cette personne morale n'apparaît pas dans les fichiers DGFiP des personnes morales (situation au 1er janvier 2025). Rappel : les personnes physiques, les entreprises individuelles et les sociétés unipersonnelles en sont absentes par construction.</div>
              </div>
            )}

            {!parcellesLoading && droitsPresents.length > 0 && (
              <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-baseline gap-2 flex-wrap mb-3">
                  <h3 className="font-semibold text-blue-950 text-sm">Titres de droit retenus</h3>
                  <span className="text-xs text-stone-500">
                    les indicateurs, la carte et les exports ne portent que sur les titres cochés
                  </span>
                  <div className="ml-auto flex items-center gap-3">
                    {propriete.length > 0 && propriete.length < droitsPresents.length && (
                      <button onClick={() => setDroitsChoisis(propriete)} className="text-xs text-blue-900 underline hover:text-blue-700">
                        propriété seule
                      </button>
                    )}
                    {droitsActifs.length < droitsPresents.length && (
                      <button onClick={() => setDroitsChoisis(null)} className="text-xs text-blue-900 underline hover:text-blue-700">
                        tous les titres
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {droitsPresents.map(([d, n]) => {
                    const actif = droitsActifs.includes(d);
                    return (
                      <button key={d} onClick={() => basculerDroit(d)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition ${actif
                          ? 'bg-blue-950 text-amber-400 border-blue-950 font-medium'
                          : 'bg-white text-stone-500 border-stone-300 hover:border-stone-400'}`}>
                        {actif ? '✓ ' : ''}{d} <span className="opacity-70">({n.toLocaleString('fr-FR')})</span>
                      </button>
                    );
                  })}
                </div>
                {filtreActif && (
                  <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {ecartesParcelles.toLocaleString('fr-FR')} parcelle(s) et {ecartesLocaux.toLocaleString('fr-FR')} local(aux) écartés par ce filtre : la société y figure à un autre titre que ceux retenus.
                  </div>
                )}
                {melangeDesTitres && (
                  <div className="mt-3 text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    Titres autres que la propriété retenus : les totaux mêlent donc les biens détenus en propriété et ceux sur lesquels la société n'a qu'un autre droit réel ou une mission de gestion. La part de propriété est rappelée sous chaque indicateur.
                  </div>
                )}
                {droitsActifs.length === 0 && (
                  <div className="mt-3 text-xs text-red-700">Aucun titre retenu : cochez-en au moins un.</div>
                )}
              </div>
            )}

            {!parcellesLoading && parcelles.length > 0 && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Parcelles</div>
                    <div className="text-2xl font-semibold text-blue-950">{parcelles.length.toLocaleString('fr-FR')}</div>
                    {ecartesParcelles > 0 && (
                      <div className="text-xs text-stone-500 mt-1">sur {parcellesBrutes.length.toLocaleString('fr-FR')} tous titres confondus</div>
                    )}
                    {melangeDesTitres && (
                      <div className="text-xs text-blue-900 mt-1">dont {parcellesPropriete.length.toLocaleString('fr-FR')} au titre de la propriété</div>
                    )}
                    {truncated && <div className="text-xs text-amber-700 mt-1">⚠ {parcelles.length.toLocaleString('fr-FR')} récupérées sur {totalParcelles.toLocaleString('fr-FR')}</div>}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Surface totale</div>
                    <div className="text-2xl font-semibold text-blue-950">{totalSurface.toLocaleString('fr-FR')} m²</div>
                    {melangeDesTitres && (
                      <div className="text-xs text-blue-900 mt-1">dont {surfaceEnPropriete.toLocaleString('fr-FR')} m² en propriété</div>
                    )}
                    {parcellesDistinctes < parcelles.length && (
                      <div className="text-xs text-stone-500 mt-1">sur {parcellesDistinctes.toLocaleString('fr-FR')} parcelles distinctes — {(parcelles.length - parcellesDistinctes).toLocaleString('fr-FR')} ligne(s) en double titre de droit</div>
                    )}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Communes</div>
                    <div className="text-2xl font-semibold text-blue-950">{stats.communes.length}</div>
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Locaux (bâti)</div>
                    <div className="text-2xl font-semibold text-blue-950">
                      {locauxLoading ? <Loader2 className="w-5 h-5 text-amber-500 animate-spin" /> : locaux.length.toLocaleString('fr-FR')}
                    </div>
                    {!locauxLoading && totalLocaux > 0 && (
                      <div className="text-xs text-stone-500 mt-1">{immeubles.toLocaleString('fr-FR')} immeuble{immeubles > 1 ? 's' : ''}</div>
                    )}
                    {ecartesLocaux > 0 && (
                      <div className="text-xs text-stone-500 mt-1">sur {locauxBruts.length.toLocaleString('fr-FR')} tous titres confondus</div>
                    )}
                    {melangeDesTitres && !locauxLoading && (
                      <div className="text-xs text-blue-900 mt-1">dont {localsPropriete.toLocaleString('fr-FR')} au titre de la propriété</div>
                    )}
                    {locauxTronque && (
                      <div className="text-xs text-amber-700 mt-1">⚠ {locaux.length.toLocaleString('fr-FR')} récupérés sur {totalLocaux.toLocaleString('fr-FR')}</div>
                    )}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Cohérence matrice / plan</div>
                    <div className="text-2xl font-semibold text-blue-950">
                      {coherence.attente > 0 ? '—' : (coherence.notables + coherence.mineurs).toLocaleString('fr-FR')}
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      {coherence.attente > 0
                        ? 'en attente du géocodage'
                        : `écart(s) sur ${coherence.controlees.toLocaleString('fr-FR')} parcelles · ${coherence.concordantes.toLocaleString('fr-FR')} concordantes`}
                    </div>
                    {coherence.absentes > 0 && coherence.attente === 0 && (
                      <div className="text-xs text-stone-500">{coherence.absentes.toLocaleString('fr-FR')} absente(s) du plan</div>
                    )}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-4">
                    <div className="text-xs text-stone-500 mb-1">Géocodage</div>
                    <div className="text-2xl font-semibold text-blue-950">
                      {!geoStatus ? '—' : `${geoStatus.trouvees.toLocaleString('fr-FR')}`}
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      {!geoStatus ? 'en attente'
                        : geoStatus.termine
                          ? `références localisées sur ${(geoStatus.demandees || 0).toLocaleString('fr-FR')} (bâti et non bâti confondus)`
                          : `commune ${geoStatus.faites}/${geoStatus.communes} en cours...`}
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2">
                    <MapIcon className="w-4 h-4 text-blue-950" />
                    <h3 className="font-semibold text-blue-950">Carte interactive</h3>
                    <span className="text-xs text-stone-500">— cliquez sur un marqueur pour les détails</span>
                    <div className="ml-auto flex items-center gap-3">
                      {geoStatus && !geoStatus.termine && (
                        <span className="flex items-center gap-1.5 text-xs text-amber-700">
                          <Loader2 className="w-3 h-3 animate-spin" />localisation en cours
                        </span>
                      )}
                      {/* Les contours arrivent AVEC le géocodage : même endpoint,
                          mêmes communes, mêmes références. Ne pas les redissocier. */}
                      {contours && contours.size > 0 && (
                        <span className="flex items-center gap-2 text-xs text-stone-600">
                          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#A01040', opacity: 0.55 }} />
                          {contours.size.toLocaleString('fr-FR')} contour(s) tracé(s)
                          <span className="text-stone-400">— décochez la couche pour les masquer</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <ParcellesMap parcelles={parcelles} locaux={locaux} contours={contours} companyName={selectedCompany?.nom} />
                  <div className="px-6 py-3 border-t border-stone-200 text-xs text-stone-500">
                    Position au centroïde de la parcelle, d'après le plan cadastral (DGFiP, version Etalab).
                    {' '}Le bâti est regroupé par immeuble : un marqueur porte tous les lots détenus sur la parcelle.
                    {contours && " Les contours proviennent du plan cadastral et sont tracés en carmin, la couleur retenue pour la colorisation des extraits."}
                    {geoStatus?.termine && geoStatus.trouvees < (geoStatus.demandees || 0) && (
                      <span className="text-amber-700"> {((geoStatus.demandees || 0) - geoStatus.trouvees).toLocaleString('fr-FR')} référence(s) sans géométrie : le millésime du plan peut différer de celui de la matrice.</span>
                    )}
                  </div>
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

                {coherence.ecarts.length > 0 && (
                  <div className="bg-white border border-amber-300 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-amber-200 bg-amber-50 flex items-center gap-2 flex-wrap">
                      <AlertCircle className="w-4 h-4 text-amber-700" />
                      <h3 className="font-semibold text-blue-950">Écarts de contenance entre matrice et plan cadastral</h3>
                      <span className="text-xs text-amber-800">— {coherence.ecarts.length.toLocaleString('fr-FR')} parcelle(s) à instruire</span>
                    </div>
                    <div className="px-6 py-3 text-xs text-stone-600 border-b border-stone-200">
                      Les deux sources DGFiP ne se synchronisent pas au même rythme. Un écart signale une parcelle qui a bougé — division, réunion, remembrement, document d'arpentage — donc une désignation à vérifier avant reprise. Écart qualifié de notable au-delà de 2 m² ou de 1 % de la contenance.
                    </div>
                    <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-10">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Référence</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Commune</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">Adresse</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">Matrice</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">Plan</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">Écart</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-stone-600 uppercase">Ampleur</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-stone-600 uppercase">Colorier</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coherence.ecarts.map((o) => {
                            const pct = o.contenance ? (100 * o._ecart / Number(o.contenance)) : 0;
                            return (
                              <tr key={o.codeParcelle} className="border-b border-stone-100 hover:bg-stone-50">
                                <td className="px-4 py-3 font-mono text-xs text-blue-950 whitespace-nowrap">{o.codeParcelle}</td>
                                <td className="px-4 py-3 text-blue-950">{o.commune}</td>
                                <td className="px-4 py-3 text-blue-950 text-xs">{o.adresse}</td>
                                <td className="px-4 py-3 text-right text-blue-950 whitespace-nowrap">{Number(o.contenance || 0).toLocaleString('fr-FR')} m²</td>
                                <td className="px-4 py-3 text-right text-blue-950 whitespace-nowrap">{Number(o.contenanceCadastre || 0).toLocaleString('fr-FR')} m²</td>
                                <td className={`px-4 py-3 text-right whitespace-nowrap font-medium ${o._classe === 'notable' ? 'text-amber-800' : 'text-stone-500'}`}>
                                  {o._ecart > 0 ? '+' : ''}{o._ecart.toLocaleString('fr-FR')} m²
                                </td>
                                <td className="px-4 py-3 text-center text-xs">
                                  <span className={`px-2 py-0.5 rounded border ${o._classe === 'notable'
                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                    : 'bg-stone-50 text-stone-600 border-stone-300'}`}>
                                    {o._classe === 'notable' ? 'notable' : 'mineur'} · {pct > 0 ? '+' : ''}{pct.toFixed(1)} %
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {lienPaintColorise(o.codeParcelle, o.commune, contours?.get(o.codeParcelle)) && (
                                    <a href={lienPaintColorise(o.codeParcelle, o.commune, contours?.get(o.codeParcelle))} target="_blank" rel="noreferrer"
                                      title="Ouvre PAINT pour confronter l'écart au plan, parcelle déjà coloriée"
                                      className="underline text-xs font-semibold" style={{ color: '#A01040' }}>Colorier</a>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2 flex-wrap">
                    <MapPin className="w-4 h-4 text-blue-950" />
                    <h3 className="font-semibold text-blue-950">Détail des parcelles</h3>
                    <input value={qParcelles} onChange={(e) => setQParcelles(e.target.value)}
                      placeholder="Rechercher : commune, adresse, référence, droit..."
                      className="ml-2 px-3 py-1.5 text-sm border border-stone-300 rounded-lg w-72 focus:outline-none focus:border-blue-900" />
                    {qParcelles && (
                      <span className="text-xs text-stone-500">{parcellesAffichees.length.toLocaleString('fr-FR')} sur {parcelles.length.toLocaleString('fr-FR')}</span>
                    )}
                    <span className="ml-2 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded border border-green-200">Fichiers DGFiP des personnes morales — millésime 2025</span>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-10">
                        <tr>
                          <EnTete label="#" champ="" tri={triParcelles} onTri={setTriParcelles} />
                          <EnTete label="Référence" champ="codeParcelle" tri={triParcelles} onTri={setTriParcelles} />
                          <EnTete label="Commune" champ="commune" tri={triParcelles} onTri={setTriParcelles} />
                          <EnTete label="Département" champ="departement" tri={triParcelles} onTri={setTriParcelles} />
                          <EnTete label="Adresse" champ="adresse" tri={triParcelles} onTri={setTriParcelles} />
                          <EnTete label="Surface" champ="contenance" tri={triParcelles} onTri={setTriParcelles} align="text-right" />
                          <EnTete label="Nature" champ="natureCulture" tri={triParcelles} onTri={setTriParcelles} align="text-center" />
                          <EnTete label="Droit" champ="codeDroit" tri={triParcelles} onTri={setTriParcelles} />
                          <EnTete label="Carte" champ="" tri={triParcelles} onTri={setTriParcelles} align="text-center" />
                          <EnTete label="Extrait" champ="" tri={triParcelles} onTri={setTriParcelles} align="text-center" />
                        </tr>
                      </thead>
                      <tbody>
                        {parcellesAffichees.map((p, i) => {
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
                              <td className="px-4 py-3 text-stone-600 text-xs">{p.codeDroit}</td>
                              <td className="px-4 py-3 text-center">
                                {link && (
                                  <a href={link} target="_blank" rel="noreferrer" className="text-blue-900 hover:text-blue-700 underline text-xs font-medium">Voir</a>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {lienPaintColorise(p.codeParcelle, p.commune, contours?.get(p.codeParcelle)) && (
                                  <a href={lienPaintColorise(p.codeParcelle, p.commune, contours?.get(p.codeParcelle))} target="_blank" rel="noreferrer"
                                    title="Ouvre PAINT : extrait cadastral officiel généré et parcelle coloriée"
                                    className="underline text-xs font-semibold" style={{ color: '#A01040' }}>Colorier</a>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-200 flex items-center gap-2 flex-wrap">
                    <Building2 className="w-4 h-4 text-blue-950" />
                    <h3 className="font-semibold text-blue-950">Détail des locaux</h3>
                    <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded border border-green-200">Volet bâti — millésime {millesime}</span>
                    <input value={qLocaux} onChange={(e) => setQLocaux(e.target.value)}
                      placeholder="Rechercher : commune, adresse, référence..."
                      className="ml-2 px-3 py-1.5 text-sm border border-stone-300 rounded-lg w-64 focus:outline-none focus:border-blue-900" />
                    <div className="flex rounded-lg overflow-hidden border border-stone-300 text-xs">
                      <button onClick={() => setLocauxGroupes(true)}
                        className={`px-3 py-1.5 ${locauxGroupes ? 'bg-blue-950 text-amber-400 font-medium' : 'bg-white text-stone-600'}`}>
                        par immeuble
                      </button>
                      <button onClick={() => setLocauxGroupes(false)}
                        className={`px-3 py-1.5 ${!locauxGroupes ? 'bg-blue-950 text-amber-400 font-medium' : 'bg-white text-stone-600'}`}>
                        lot par lot
                      </button>
                    </div>
                    {!locauxLoading && locaux.length > 0 && (
                      <span className="ml-auto text-xs text-stone-500">Inclus dans l'export Excel, onglet « Locaux »</span>
                    )}
                  </div>

                  {locauxLoading && (
                    <div className="px-6 py-8 flex items-center justify-center gap-2 text-sm text-blue-950">
                      <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />Relevé du bâti en cours...
                    </div>
                  )}

                  {locauxError && (
                    <div className="px-6 py-6 text-sm text-red-700">{locauxError}</div>
                  )}

                  {!locauxLoading && !locauxError && locaux.length === 0 && (
                    <div className="px-6 py-8 text-center text-sm text-stone-600">
                      Aucun local bâti au nom de cette personne morale.
                      <div className="text-xs text-stone-500 mt-1">Le fichier des locaux ne comporte ni surface ni numéro invariant : un lot s'identifie par bâtiment, entrée, niveau et porte.</div>
                    </div>
                  )}

                  {!locauxLoading && locaux.length > 0 && (
                    <>
                      <div className="px-6 py-3 border-b border-stone-200 text-xs text-stone-500">
                        {locaux.length.toLocaleString('fr-FR')} lot{locaux.length > 1 ? 's' : ''} sur {immeubles.toLocaleString('fr-FR')} parcelle{immeubles > 1 ? 's' : ''} bâtie{immeubles > 1 ? 's' : ''}.
                        {qLocaux && ` Filtre actif : ${(locauxGroupes ? immeublesAffiches.length : locauxAffiches.length).toLocaleString('fr-FR')} ligne(s) affichée(s).`}
                        {' '}Un même lot peut figurer deux fois à des titres de droit différents.
                      </div>
                      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-10">
                            {locauxGroupes ? (
                              <tr>
                                <EnTete label="#" champ="" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Parcelle" champ="codeParcelle" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Commune" champ="commune" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Adresse" champ="adresse" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Lots" champ="nbLots" tri={triLocaux} onTri={setTriLocaux} align="text-right" />
                                <EnTete label="Bâtiments" champ="batimentsTxt" tri={triLocaux} onTri={setTriLocaux} align="text-center" />
                                <EnTete label="Titres" champ="titresTxt" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Extrait" champ="" tri={triLocaux} onTri={setTriLocaux} align="text-center" />
                              </tr>
                            ) : (
                              <tr>
                                <EnTete label="#" champ="" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Parcelle" champ="codeParcelle" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Commune" champ="commune" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Adresse" champ="adresse" tri={triLocaux} onTri={setTriLocaux} />
                                <EnTete label="Bât." champ="batiment" tri={triLocaux} onTri={setTriLocaux} align="text-center" />
                                <EnTete label="Entrée" champ="entree" tri={triLocaux} onTri={setTriLocaux} align="text-center" />
                                <EnTete label="Niv." champ="niveau" tri={triLocaux} onTri={setTriLocaux} align="text-center" />
                                <EnTete label="Porte" champ="porte" tri={triLocaux} onTri={setTriLocaux} align="text-center" />
                                <EnTete label="Droit" champ="codeDroit" tri={triLocaux} onTri={setTriLocaux} />
                              </tr>
                            )}
                          </thead>
                          <tbody>
                            {locauxGroupes
                              ? immeublesAffiches.map((im, i) => (
                                <tr key={(im.codeParcelle || '') + '-g' + i} className="border-b border-stone-100 hover:bg-stone-50">
                                  <td className="px-4 py-3"><div className="w-6 h-6 rounded-full bg-blue-950 text-amber-400 text-xs font-semibold flex items-center justify-center">{i + 1}</div></td>
                                  <td className="px-4 py-3 font-mono text-xs text-blue-950 whitespace-nowrap">{im.codeParcelle}</td>
                                  <td className="px-4 py-3 text-blue-950">{im.commune}</td>
                                  <td className="px-4 py-3 text-blue-950 text-xs">{im.adresse}</td>
                                  <td className="px-4 py-3 text-right text-blue-950 font-medium whitespace-nowrap">{im.nbLots.toLocaleString('fr-FR')}</td>
                                  <td className="px-4 py-3 text-center text-blue-950 text-xs">{im.batimentsTxt}</td>
                                  <td className="px-4 py-3 text-stone-600 text-xs">{im.titresTxt}</td>
                                  <td className="px-4 py-3 text-center">
                                    {lienPaintColorise(im.codeParcelle, im.commune, contours?.get(im.codeParcelle)) && (
                                      <a href={lienPaintColorise(im.codeParcelle, im.commune, contours?.get(im.codeParcelle))} target="_blank" rel="noreferrer"
                                        title="Ouvre PAINT : extrait généré et parcelle coloriée"
                                        className="underline text-xs font-semibold" style={{ color: '#A01040' }}>Colorier</a>
                                    )}
                                  </td>
                                </tr>
                              ))
                              : locauxAffiches.map((l, i) => (
                                <tr key={(l.codeParcelle || '') + '-' + i} className="border-b border-stone-100 hover:bg-stone-50">
                                  <td className="px-4 py-3"><div className="w-6 h-6 rounded-full bg-blue-950 text-amber-400 text-xs font-semibold flex items-center justify-center">{i + 1}</div></td>
                                  <td className="px-4 py-3 font-mono text-xs text-blue-950 whitespace-nowrap">{l.codeParcelle}</td>
                                  <td className="px-4 py-3 text-blue-950">{l.commune}</td>
                                  <td className="px-4 py-3 text-blue-950 text-xs">{l.adresse}</td>
                                  <td className="px-4 py-3 text-center text-blue-950">{l.batiment}</td>
                                  <td className="px-4 py-3 text-center text-blue-950">{l.entree}</td>
                                  <td className="px-4 py-3 text-center text-blue-950">{l.niveau}</td>
                                  <td className="px-4 py-3 text-center text-blue-950">{l.porte}</td>
                                  <td className="px-4 py-3 text-stone-600 text-xs">{l.codeDroit}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
