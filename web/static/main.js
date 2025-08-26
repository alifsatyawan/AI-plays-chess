const boardEl = document.getElementById('board');
const depthEl = document.getElementById('depth');
const newgameBtn = document.getElementById('newgame');
const colorEl = document.getElementById('color');
const turnEl = document.getElementById('turn');
const gameoverEl = document.getElementById('gameover');
const overlay = document.getElementById('winner-overlay');
const overlayTitle = document.getElementById('winner-title');
const overlaySub = document.getElementById('winner-sub');
const playAgainBtn = document.getElementById('play-again');
const thinkingEl = document.getElementById('thinking');

let state = {
  fen: null,
  turn: 'white',
  legal_moves: [],
  game_over: false,
  result: null,
  orientation: 'white',
};

let selected = null;

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

function playMoveSound() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 660;
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
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
  div.addEventListener('click', () => { initAudio(); onSquareClick(div); });
  boardEl.appendChild(div);
}

function onSquareClick(div) {
  if (state.game_over) return;
  const square = div.dataset.square;
  if (!selected) {
    selected = square;
    div.classList.add('highlight');
  } else {
    const from = selected;
    const move = from + square;
    clearHighlights();
    selected = null;
    // Server validates, but try to only send plausible moves
    if (state.legal_moves.includes(move) || state.legal_moves.some(m => m.startsWith(from) && m.slice(0, 4) === move)) {
      doMove(move);
    } else {
      doMove(move); // Let server reject (covers promotions without suffix)
    }
  }
}

function clearHighlights() {
  document.querySelectorAll('.square.highlight').forEach(el => el.classList.remove('highlight'));
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
        // Avoid double-playing sound when finalizing snapshot
        window._skipNextAiSoundMove = data.ai_move;
        applyOptimisticMove(data.ai_move);
        playMoveSound();
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
  applyOptimisticMove(uci);
  playMoveSound();
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
  if (snap.ai_move && snap.ai_move !== window._skipNextAiSoundMove) {
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
playAgainBtn.addEventListener('click', () => {
  newGame();
});

// Allow clicking outside the card to close overlay (without new game)
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) {
    hideWinnerOverlay();
  }
});

// Kick off
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


