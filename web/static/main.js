const boardEl = document.getElementById('board');
const fileLabelsEl = document.getElementById('filelabels');
const rankLabelsEl = document.getElementById('ranklabels');
const depthEl = document.getElementById('depth');
const newgameBtn = document.getElementById('newgame');
const themeEl = document.getElementById('theme');
const piecesEl = document.getElementById('pieces');
const colorEl = document.getElementById('color');
const turnEl = document.getElementById('turn');
const gameoverEl = document.getElementById('gameover');
const overlay = document.getElementById('winner-overlay');
const overlayTitle = document.getElementById('winner-title');
const overlaySub = document.getElementById('winner-sub');
const playAgainBtn = document.getElementById('play-again');
const thinkingEl = document.getElementById('thinking');
const promoOverlay = document.getElementById('promo-overlay');

let state = {
  fen: null,
  turn: 'white',
  legal_moves: [],
  game_over: false,
  result: null,
  orientation: 'white',
};

let selected = null;
let dragFrom = null;
let pendingPromotion = null; // { from, to }

// Simple move sound using Web Audio API
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

function playTone(freq, duration = 0.12, type = 'triangle', startGain = 0.2) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(startGain, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

function playMoveSound() {
  playTone(660, 0.12, 'triangle', 0.2);
}

function playCaptureSound() {
  playTone(520, 0.08, 'sawtooth', 0.25);
  setTimeout(() => playTone(390, 0.1, 'sawtooth', 0.22), 70);
}

function playCheckSound() {
  playTone(880, 0.14, 'square', 0.22);
}

function playGameEndSound() {
  playTone(523.25, 0.12, 'triangle', 0.22);
  setTimeout(() => playTone(659.25, 0.12, 'triangle', 0.22), 120);
  setTimeout(() => playTone(783.99, 0.18, 'triangle', 0.22), 240);
}

const PIECE_TO_EMOJI = {
  'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔',
  'p': '♟︎', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
};

function sqName(file, rank) {
  return String.fromCharCode('a'.charCodeAt(0) + file) + (8 - rank);
}

function renderBoardFromFEN(fen) {
  boardEl.innerHTML = '';
  if (fileLabelsEl && rankLabelsEl) {
    renderCoordinates();
  }
  const position = fen.split(' ')[0];
  const rows = position.split('/');
  // Build a grid of pieces [rankIndex 0..7 -> file 0..7]
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    let file = 0;
    for (const ch of row) {
      const maybeNum = parseInt(ch);
      if (!isNaN(maybeNum)) {
        for (let i = 0; i < maybeNum; i++) {
          grid[r][file] = null;
          file++;
        }
      } else {
        grid[r][file] = ch;
        file++;
      }
    }
  }

  const orientBlack = state.orientation === 'black';
  // Render in display order; dataset squares use actual board coords
  for (let uiR = 0; uiR < 8; uiR++) {
    for (let uiF = 0; uiF < 8; uiF++) {
      const r = orientBlack ? (7 - uiR) : uiR;
      const f = orientBlack ? (7 - uiF) : uiF;
      addSquare(f, r, grid[r][f]);
    }
  }
}

function addSquare(file, rank, piece) {
  const div = document.createElement('div');
  div.className = 'square ' + ((file + rank) % 2 === 0 ? 'light' : 'dark');
  div.dataset.square = sqName(file, rank);
  if (piece) div.textContent = PIECE_TO_EMOJI[piece] || '';
  if (piecesEl && piecesEl.value === 'letters' && piece) {
    div.textContent = piece;
  }
  // Drag-and-drop support
  div.draggable = !!piece && !state.game_over;
  div.addEventListener('dragstart', (e) => {
    initAudio();
    dragFrom = div.dataset.square;
    e.dataTransfer.setData('text/plain', dragFrom);
  });
  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    div.classList.add('drag-over');
  });
  div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
  div.addEventListener('drop', (e) => {
    e.preventDefault();
    div.classList.remove('drag-over');
    const from = e.dataTransfer.getData('text/plain') || dragFrom;
    const to = div.dataset.square;
    if (!from || !to || from === to) return;
    clearHighlights();
    selected = null;
    handleMoveWithPromotion(from, to);
  });
  div.addEventListener('click', () => { initAudio(); onSquareClick(div); });
  boardEl.appendChild(div);
}

function renderCoordinates() {
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = ['8','7','6','5','4','3','2','1'];
  const orientBlack = state.orientation === 'black';
  const f = orientBlack ? [...files].reverse() : files;
  const r = orientBlack ? [...ranks].reverse() : ranks;
  fileLabelsEl.innerHTML = f.map(ch => `<div>${ch}</div>`).join('');
  rankLabelsEl.innerHTML = r.map(ch => `<div>${ch}</div>`).join('');
}

function onSquareClick(div) {
  if (state.game_over) return;
  const square = div.dataset.square;
  if (!selected) {
    selected = square;
    clearHighlights();
    div.classList.add('highlight');
    showLegalTargets(square);
  } else {
    const from = selected;
    clearHighlights();
    selected = null;
    handleMoveWithPromotion(from, square);
  }
}

function clearHighlights() {
  document.querySelectorAll('.square.highlight').forEach(el => el.classList.remove('highlight'));
  document.querySelectorAll('.square.legal').forEach(el => el.classList.remove('legal'));
}

async function fetchJSON(url, options) {
  const res = await fetch(url, Object.assign({headers: {'Content-Type': 'application/json'}}, options));
  return res.json();
}

async function newGame() {
  // Reset UI state immediately
  initAudio();
  selected = null;
  clearHighlights();
  hideWinnerOverlay();
  const color = (colorEl && (colorEl.value === 'black' || colorEl.value === 'white')) ? colorEl.value : 'white';
  state.orientation = color;
  const depth = parseInt(depthEl.value) || 2;
  setBusy(true);
  try {
    const data = await fetchJSON('/api/new', {method: 'POST', body: JSON.stringify({ color, depth })});
    // If AI moved first, the server may include pre_fen + ai_move for animation
    if (data.pre_fen && data.ai_move) {
      const ori = state.orientation || 'white';
      // Show the starting position from before the AI move
      renderBoardFromFEN(data.pre_fen);
      const preTurn = (data.pre_fen.split(' ')[1] === 'w') ? 'white' : 'black';
      // Keep state minimally consistent for the brief animation phase
      state = { ...state, fen: data.pre_fen, turn: preTurn, orientation: ori, game_over: false };
      turnEl.textContent = preTurn;
      // Show start position for ~1s before animating AI's first move
      setTimeout(() => {
        // Defer sound to final snapshot so we can choose correct variant
        window._skipNextAiSoundMove = null;
        applyOptimisticMove(data.ai_move);
        // After a short moment, commit to the final snapshot from the server
        setTimeout(() => {
          updateState(data);
        }, 200);
      }, 1000);
    } else {
      updateState(data);
    }
  } finally {
    setBusy(false);
  }
}

async function doMove(uci) {
  const depth = parseInt(depthEl.value) || 2;
  // Optimistic UI update: show the piece move immediately
  const prevFEN = state.fen;
  const prevTurn = state.turn;
  // Detect capture optimistically by checking if target square has a piece before move
  const to = uci.slice(2, 4);
  const toElBefore = document.querySelector(`.square[data-square="${to}"]`);
  const wasCapture = !!(toElBefore && toElBefore.textContent);
  applyOptimisticMove(uci);
  if (wasCapture) playCaptureSound(); else playMoveSound();
  setBusy(true);
  try {
    const data = await fetchJSON('/api/move', {method: 'POST', body: JSON.stringify({move: uci, depth})});
    if (data.error) {
      console.warn('Illegal move:', data.error);
      // Revert optimistic move
      renderBoardFromFEN(prevFEN);
      turnEl.textContent = prevTurn;
      return;
    }
    updateState(data);
  } finally {
    setBusy(false);
  }
}

function updateState(snap) {
  // Preserve current orientation when replacing state
  const orientation = state.orientation || 'white';
  state = { ...snap, orientation };
  renderBoardFromFEN(snap.fen);
  turnEl.textContent = snap.turn;
  applyPositionHighlights(snap);
  // Server-confirmed sound variant
  if (snap.game_over) {
    playGameEndSound();
  } else if (snap.in_check) {
    playCheckSound();
  } else if (snap.last_move_capture) {
    playCaptureSound();
  } else if (snap.last_move || snap.ai_move) {
    playMoveSound();
  }
  if (window._skipNextAiSoundMove) window._skipNextAiSoundMove = null;
  if (snap.game_over) {
    const result = snap.result || '';
    gameoverEl.textContent = 'Game Over: ' + result;
    gameoverEl.classList.remove('hidden');
    showWinnerOverlay(result);
  } else {
    gameoverEl.classList.add('hidden');
  }
}

newgameBtn.addEventListener('click', newGame);
themeEl && themeEl.addEventListener('change', () => {
  const theme = themeEl.value;
  localStorage.setItem('chess_theme', theme);
  document.documentElement.classList.remove('theme-dark', 'theme-ocean', 'theme-forest', 'theme-sharla');
  if (theme === 'dark') document.documentElement.classList.add('theme-dark');
  else if (theme === 'forest') document.documentElement.classList.add('theme-forest');
  else if (theme === 'ocean') document.documentElement.classList.add('theme-ocean');
});
piecesEl && piecesEl.addEventListener('change', () => {
  const style = piecesEl.value;
  localStorage.setItem('chess_pieces', style);
  renderBoardFromFEN(state.fen);
});
playAgainBtn.addEventListener('click', () => {
  newGame();
});

// Allow clicking outside the card to close overlay (without new game)
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) {
    hideWinnerOverlay();
  }
});

// Promotion overlay handlers
promoOverlay && promoOverlay.addEventListener('click', (e) => {
  if (e.target === promoOverlay) closePromotion();
});
document.querySelectorAll('#promo-overlay [data-promo]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!pendingPromotion) return;
    const suf = btn.getAttribute('data-promo');
    const uci = pendingPromotion.from + pendingPromotion.to + suf;
    pendingPromotion = null;
    closePromotion();
    doMove(uci);
  });
});

// Kick off
// Apply saved theme/piece settings
(() => {
  const savedTheme = localStorage.getItem('chess_theme');
  if (savedTheme && themeEl) {
    themeEl.value = savedTheme;
    const evt = new Event('change');
    themeEl.dispatchEvent(evt);
  }
  const savedPieces = localStorage.getItem('chess_pieces');
  if (savedPieces && piecesEl) piecesEl.value = savedPieces;
})();
newGame();

function showWinnerOverlay(result) {
  let title = 'Game Over';
  if (result === '1-0') title = 'White wins!';
  else if (result === '0-1') title = 'Black wins!';
  else if (result === '1/2-1/2') title = 'Draw';
  overlayTitle.textContent = title;
  overlaySub.textContent = 'Result: ' + (result || '');
  overlay.classList.remove('hidden');
}

function hideWinnerOverlay() {
  overlay.classList.add('hidden');
}

function setBusy(b) {
  if (b) {
    thinkingEl && thinkingEl.classList.remove('hidden');
    boardEl.classList.add('disabled');
  } else {
    thinkingEl && thinkingEl.classList.add('hidden');
    boardEl.classList.remove('disabled');
  }
}

function applyOptimisticMove(uci) {
  if (!uci || uci.length < 4) return;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const fromEl = document.querySelector(`.square[data-square="${from}"]`);
  const toEl = document.querySelector(`.square[data-square="${to}"]`);
  if (!fromEl || !toEl) return;
  const piece = fromEl.textContent;
  // Move piece visually
  fromEl.textContent = '';
  toEl.textContent = piece;
  // Update turn indicator optimistically
  turnEl.textContent = (state.turn === 'white') ? 'black' : 'white';
}

function handleMoveWithPromotion(from, to) {
  const base = from + to;
  // If any legal move is a promotion from->to (length 5), prompt
  const hasPromotion = state.legal_moves.some(m => m.startsWith(base) && m.length === 5);
  if (hasPromotion) {
    pendingPromotion = { from, to };
    openPromotion();
    return;
  }
  doMove(base);
}

function openPromotion() {
  if (!promoOverlay) return;
  promoOverlay.classList.remove('hidden');
}

function closePromotion() {
  if (!promoOverlay) return;
  promoOverlay.classList.add('hidden');
}

function showLegalTargets(fromSquare) {
  const targets = state.legal_moves
    .filter(m => m.startsWith(fromSquare))
    .map(m => m.slice(2, 4));
  for (const t of targets) {
    const el = document.querySelector(`.square[data-square="${t}"]`);
    if (el) el.classList.add('legal');
  }
}

function applyPositionHighlights(snap) {
  // Last move
  const last = snap.last_move;
  if (last && last.length >= 4) {
    const from = last.slice(0, 2);
    const to = last.slice(2, 4);
    const fromEl = document.querySelector(`.square[data-square="${from}"]`);
    const toEl = document.querySelector(`.square[data-square="${to}"]`);
    if (fromEl) fromEl.classList.add('last-move');
    if (toEl) toEl.classList.add('last-move');
  }
  // Check highlight
  if (snap.in_check && snap.check_square) {
    const kEl = document.querySelector(`.square[data-square="${snap.check_square}"]`);
    if (kEl) kEl.classList.add('check');
  }
}


