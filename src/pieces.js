// SVG Chess Pieces (cburnett-style, public domain inspired)
const PIECE_SVG = {};

// Helper to create piece SVGs
function makeSvg(paths, viewBox = '0 0 45 45') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${paths}</svg>`;
}

// White pieces
PIECE_SVG['wK'] = makeSvg(`
  <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/>
    <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#fff" stroke-linecap="butt" stroke-linejoin="miter"/>
    <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" fill="#fff"/>
    <path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0"/>
  </g>
`);

PIECE_SVG['wQ'] = makeSvg(`
  <g fill="#fff" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM24.5 7.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0z"/>
    <path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15L14 11v14L7 14l2 12z" stroke-linecap="butt"/>
    <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" stroke-linecap="butt"/>
    <path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none"/>
  </g>
`);

PIECE_SVG['wR'] = makeSvg(`
  <g fill="#fff" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap="butt"/>
    <path d="M34 14l-3 3H14l-3-3"/>
    <path d="M15 17v7h15v-7" stroke-linecap="butt" stroke-linejoin="miter"/>
    <path d="M14 29.5v-13h17v13H14z" stroke-linecap="butt" stroke-linejoin="miter"/>
    <path d="M14 29.5L11 36h23l-3-6.5H14z" stroke-linecap="butt"/>
    <path d="M11 14h23" fill="none" stroke-linejoin="miter"/>
  </g>
`);

PIECE_SVG['wB'] = makeSvg(`
  <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <g fill="#fff" stroke-linecap="butt">
      <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/>
      <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/>
      <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"/>
    </g>
    <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" stroke-linejoin="miter"/>
  </g>
`);

PIECE_SVG['wN'] = makeSvg(`
  <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#fff"/>
    <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="#fff"/>
    <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0zm5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5z" fill="#000"/>
  </g>
`);

PIECE_SVG['wP'] = makeSvg(`
  <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>
`);

// Black pieces
PIECE_SVG['bK'] = makeSvg(`
  <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22.5 11.63V6" stroke-linejoin="miter"/>
    <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#000" stroke-linecap="butt" stroke-linejoin="miter"/>
    <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" fill="#000"/>
    <path d="M20 8h5" stroke-linejoin="miter"/>
    <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" stroke="#fff"/>
  </g>
`);

PIECE_SVG['bQ'] = makeSvg(`
  <g fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <g fill="#000" stroke="none">
      <circle cx="6" cy="12" r="2.75"/>
      <circle cx="14" cy="9" r="2.75"/>
      <circle cx="22.5" cy="8" r="2.75"/>
      <circle cx="31" cy="9" r="2.75"/>
      <circle cx="39" cy="12" r="2.75"/>
    </g>
    <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z" fill="#000" stroke-linecap="butt"/>
    <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill="#000" stroke-linecap="butt"/>
    <path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none" stroke="#fff"/>
  </g>
`);

PIECE_SVG['bR'] = makeSvg(`
  <g fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 39h27v-3H9v3zM12.5 32l1.5-2.5h17l1.5 2.5h-20zM12 36v-4h21v4H12z" stroke-linecap="butt" fill="#000"/>
    <path d="M14 29.5v-13h17v13H14z" stroke-linecap="butt" stroke-linejoin="miter" fill="#000"/>
    <path d="M14 16.5L11 14h23l-3 2.5H14zM11 14V9h4v2h5V9h5v2h5V9h4v5H11z" stroke-linecap="butt" fill="#000"/>
    <path d="M12 35.5h21M13 31.5h19M14 29.5h17M14 16.5h17M11 14h23" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="miter"/>
  </g>
`);

PIECE_SVG['bB'] = makeSvg(`
  <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z" fill="#000"/>
    <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" fill="#000"/>
    <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill="#000"/>
    <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" fill="none" stroke="#fff" stroke-linejoin="miter"/>
  </g>
`);

PIECE_SVG['bN'] = makeSvg(`
  <g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#000"/>
    <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="#000"/>
    <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0zm5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5z" fill="#fff" stroke="#fff"/>
  </g>
`);

PIECE_SVG['bP'] = makeSvg(`
  <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>
`);

function pieceLetter(piece) {
  const type = piece?.[1] || 'P';
  return type === 'N' ? 'N' : type;
}

function makeBadgePieceSvg(piece, options) {
  const isWhite = piece[0] === 'w';
  const letter = pieceLetter(piece);
  const motifColor = isWhite ? options.lightMotif : options.darkMotif;
  const fill = isWhite ? options.lightFill : options.darkFill;
  const stroke = isWhite ? options.lightStroke : options.darkStroke;
  const text = isWhite ? options.lightText : options.darkText;
  const glow = options.glow || 'none';
  const detail = options.detail || '';
  return makeSvg(`
    <defs>
      <filter id="piece-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="${options.shadow || '#102438'}" flood-opacity="0.26"/>
      </filter>
    </defs>
    <g filter="url(#piece-shadow)" stroke-linecap="round" stroke-linejoin="round">
      <path d="${options.body}" fill="${fill}" stroke="${stroke}" stroke-width="${options.strokeWidth || 1.8}"/>
      ${detail}
      ${pieceMotif(piece, motifColor || text)}
      <text x="22.5" y="${options.textY || 28.5}" text-anchor="middle"
        font-family="${options.font || 'Georgia, serif'}" font-size="${options.fontSize || 19}"
        font-weight="${options.fontWeight || 800}" fill="${text}" stroke="${options.textStroke || 'none'}"
        stroke-width="${options.textStrokeWidth || 0}" paint-order="stroke">${letter}</text>
      ${glow}
    </g>
  `);
}

function pieceMotif(piece, color) {
  const type = piece?.[1] || 'P';
  const common = `fill="none" stroke="${color}" stroke-width="1.45" opacity="0.86"`;
  if (type === 'K') return `<path d="M22.5 10v6M19.5 13h6" ${common}/>`;
  if (type === 'Q') return `<path d="M17 14l2-4 3.5 4 3.5-4 2 4" ${common}/>`;
  if (type === 'R') return `<path d="M17 15v-5h3v2h5v-2h3v5" ${common}/>`;
  if (type === 'B') return `<path d="M18 15l9-5M20 10h5" ${common}/>`;
  if (type === 'N') return `<path d="M18 16c3-5 7-6 10-2M18 16l4 1.8" ${common}/>`;
  return `<circle cx="22.5" cy="13" r="3.2" fill="${color}" opacity="0.82"/>`;
}

// makeThemedPieceSvg renders letter-badge SVGs for non-PNG themes (glass/wood/
// neon/mono). It is currently UNUSED: the app serves real piece PNGs from
// /assets/pieces/{classic,glass,wood,neo}/ (built by scripts/build-pieces.mjs),
// and getPieceSvgUri() routes through getPieceAssetUri() -> those PNGs, falling
// back to the classic PIECE_SVG set only if a PNG 404s. This badge generator is
// retained as ready-to-wire fallback art if a PNG theme is ever dropped; it is
// not dead-by-accident. PIECE_ASSET_THEMES below intentionally lists exactly
// the four PNG themes that exist on disk.
function makeThemedPieceSvg(piece, theme) {
  const isWhite = piece[0] === 'w';
  if (theme === 'glass') {
    return makeBadgePieceSvg(piece, {
      body: 'M22.5 5.5c8.8 0 15.8 7 15.8 15.8 0 5.5-2.8 10.4-7.1 13.2l2.8 4.8H11l2.8-4.8A15.6 15.6 0 0 1 7.2 21.3c0-8.8 6.6-15.8 15.3-15.8z',
      lightFill: '#f7fbff',
      darkFill: '#243b53',
      lightStroke: '#7fb7d8',
      darkStroke: '#9bd6f0',
      lightText: '#20364c',
      darkText: '#eef9ff',
      strokeWidth: 1.5,
      font: 'Inter, Arial, sans-serif',
      fontSize: 18,
      textY: 28,
      shadow: '#31506f',
      detail: `<path d="M13 15c5-4.5 14-4.5 19 0" fill="none" stroke="${isWhite ? '#ffffff' : '#5f8baa'}" stroke-width="2.5" opacity="0.7"/>`,
    });
  }
  if (theme === 'wood') {
    return makeBadgePieceSvg(piece, {
      body: 'M13 39h19l-2.5-5H15.5L13 39zm2.5-5h14v-6.5c5-2.1 7-6.2 6.1-10.2C34.4 11.7 29.2 8 22.5 8s-11.9 3.7-13.1 9.3c-.9 4 1.1 8.1 6.1 10.2V34z',
      lightFill: '#f0c47f',
      darkFill: '#6d3e20',
      lightStroke: '#5d341d',
      darkStroke: '#2a1710',
      lightText: '#4a2a18',
      darkText: '#ffe3ad',
      strokeWidth: 2,
      font: 'Georgia, serif',
      fontSize: 18,
      textY: 27,
      shadow: '#2b1a10',
      detail: `<path d="M15 18c4.8-2 10.2-2 15 0M15.5 31h14M18 13c2.2 4 2.2 8.4 0 13M27 13c-2.2 4-2.2 8.4 0 13" fill="none" stroke="${isWhite ? '#b77735' : '#a66a38'}" stroke-width="1" opacity="0.65"/>`,
    });
  }
  if (theme === 'neon') {
    const stroke = isWhite ? '#00d4ff' : '#9cff6e';
    const text = isWhite ? '#e8fffb' : '#172033';
    return makeBadgePieceSvg(piece, {
      body: 'M22.5 6 36 15v15L22.5 39 9 30V15L22.5 6z',
      lightFill: '#172033',
      darkFill: '#d9fff8',
      lightStroke: stroke,
      darkStroke: '#172033',
      lightText: text,
      darkText: text,
      textStroke: isWhite ? '#172033' : '#d9fff8',
      textStrokeWidth: 0.8,
      strokeWidth: 2.4,
      font: 'IBM Plex Mono, monospace',
      fontSize: 18,
      textY: 29,
      shadow: stroke,
      detail: `<path d="M14 17h17M12 30h21M22.5 6v33" fill="none" stroke="${stroke}" stroke-width="1.2" opacity="0.72"/>`,
      glow: `<path d="M22.5 6 36 15v15L22.5 39 9 30V15L22.5 6z" fill="none" stroke="${stroke}" stroke-width="1" opacity="0.65"/>`,
    });
  }
  if (theme === 'mono') {
    return makeBadgePieceSvg(piece, {
      body: 'M10 37h25v-4H10v4zm3-4h19V13H13v20zM17 9h11v4H17V9z',
      lightFill: '#f3f3f3',
      darkFill: '#1f1f1f',
      lightStroke: '#111111',
      darkStroke: '#111111',
      lightText: '#111111',
      darkText: '#f3f3f3',
      strokeWidth: 2,
      font: 'IBM Plex Mono, monospace',
      fontSize: 18,
      fontWeight: 900,
      textY: 28.5,
      shadow: '#111111',
    });
  }
  return PIECE_SVG[piece] || '';
}

const PIECE_ASSET_THEMES = new Set(['classic', 'glass', 'wood', 'neo']);

function getPieceAssetTheme() {
  const theme = document.body?.dataset?.pieceTheme || (() => {
    try {
      const raw = window.localStorage?.getItem('sidastuff.engineSettings');
      return raw ? JSON.parse(raw).pieceTheme : 'classic';
    } catch (_) {
      return 'classic';
    }
  })();
  return PIECE_ASSET_THEMES.has(theme) ? theme : 'classic';
}

function getPieceAssetName(piece) {
  if (!piece || piece.length < 2) return '';
  return `${piece[0]}${piece[1].toLowerCase()}`;
}

function getPieceAssetUri(piece) {
  const assetName = getPieceAssetName(piece);
  if (!assetName) return '';
  return `./assets/pieces/${getPieceAssetTheme()}/${assetName}.png`;
}

function getPieceFallbackSvgUri(piece) {
  const svg = PIECE_SVG[piece];
  return svg ? 'data:image/svg+xml,' + encodeURIComponent(svg) : '';
}

// Get image URI for a piece.
function getPieceSvgUri(piece) {
  return getPieceAssetUri(piece) || getPieceFallbackSvgUri(piece);
}

window.PIECE_SVG = PIECE_SVG;
window.makeSvg = makeSvg;
window.getPieceAssetTheme = getPieceAssetTheme;
window.getPieceAssetName = getPieceAssetName;
window.getPieceAssetUri = getPieceAssetUri;
window.getPieceFallbackSvgUri = getPieceFallbackSvgUri;
window.getPieceSvgUri = getPieceSvgUri;
