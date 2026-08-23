import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, query, orderBy, limit, startAfter, getDocs, doc, getDoc, setDoc, where } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";

const themeStorageKey = "wordSmash.theme";
const themeToggle = document.querySelector("#theme-toggle");

const firebaseConfig = {
  apiKey: "AIzaSyCiuC9xyvBrP1scOnDQTlXBesceaeUWstU",
  authDomain: "wordsmash-cda66.firebaseapp.com",
  projectId: "wordsmash-cda66",
  storageBucket: "wordsmash-cda66.firebasestorage.app",
  messagingSenderId: "296751243456",
  appId: "1:296751243456:web:b1ef91ac378fdb19518d25"
};

const firebaseApp = initializeApp(firebaseConfig);
const appCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaEnterpriseProvider("6Le54ZQtAAAAAAD0THUveULsrVT1qbDPY_EzbXPy"),
  isTokenAutoRefreshEnabled: true,
});
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let currentUser = null;
signInAnonymously(auth).catch(console.error);

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.dataset.theme = isDark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.querySelector(".theme-icon").textContent = isDark ? "☀" : "☾";
  themeToggle.querySelector(".theme-label").textContent = isDark ? "Use light theme" : "Use dark theme";
}

function getSavedTheme() {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

applyTheme(getSavedTheme());
themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem(themeStorageKey, nextTheme);
  } catch {
    return;
  }
});

const ui = {
  status: document.querySelector("#dictionary-status"),
  playPanel: document.querySelector(".play-panel"),
  board: document.querySelector("#board"),
  hand: document.querySelector("#hand"),
  score: document.querySelector("#score"),
  moveCount: document.querySelector("#move-count"),
  feedback: document.querySelector("#feedback"),
  history: document.querySelector("#history"),
  dealButton: document.querySelector("#deal-button"),
  playButton: document.querySelector("#play-button"),
  smashButton: document.querySelector("#smash-button"),
  nextRoundButton: document.querySelector("#next-round-button"),
  shopHandSelection: document.querySelector("#shop-hand-selection"),
  hintResult: document.querySelector("#hint-result"),
  moveSelection: document.querySelector("#move-selection"),
  moveLeft: document.querySelector("#move-left"),
  moveRight: document.querySelector("#move-right"),
  moveReset: document.querySelector("#move-reset"),
  shopBuyButtons: [...document.querySelectorAll("[data-shop-item]")],
  leaderboardBody: document.querySelector("#leaderboard-body"),
  leaderboardStatus: document.querySelector("#leaderboard-status"),
  leaderboardScroll: document.querySelector("#leaderboard-scroll"),
  leaderboardEnd: document.querySelector("#leaderboard-end"),
  gameOverModal: document.querySelector("#game-over-modal"),
  modalScore: document.querySelector("#modal-score"),
  modalWords: document.querySelector("#modal-words"),
  playerNameInput: document.querySelector("#player-name"),
  modalSkipBtn: document.querySelector("#modal-skip-btn"),
  modalSubmitBtn: document.querySelector("#modal-submit-btn"),
  modalError: document.querySelector("#modal-error"),
};

let selectedHand = new Set();
let selectedBoard = new Set();
let selectedShopHand = new Set();
let moveSourceIndex = null;
let moveDestinationIndex = null;
let currentState = null;
let previousState = null;
let animateNextHandDeal = false;
let audioContext = null;

function getAudioContext() {
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function playTone(frequency, duration = 0.08, type = "sine", volume = 0.035, delay = 0) {
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playSound(name) {
  if (name === "select") playTone(420, 0.05, "triangle", 0.025);
  if (name === "board") playTone(300, 0.06, "triangle", 0.025);
  if (name === "deal") { playTone(260, 0.08, "sine", 0.02, 0); playTone(390, 0.1, "sine", 0.02, 0.07); }
  if (name === "success") { playTone(520, 0.1, "triangle", 0.03, 0); playTone(700, 0.13, "triangle", 0.03, 0.08); }
  if (name === "smash") playTone(150, 0.12, "square", 0.025);
  if (name === "error") playTone(180, 0.12, "sawtooth", 0.018);
  if (name === "game-over") { playTone(260, 0.16, "triangle", 0.03, 0); playTone(170, 0.22, "triangle", 0.03, 0.14); playTone(110, 0.3, "sine", 0.025, 0.33); }
}

function setControls(enabled) {
  ui.dealButton.disabled = !enabled;
  ui.playButton.disabled = !enabled;
  ui.smashButton.disabled = !enabled;
  ui.nextRoundButton.disabled = !enabled;
}

function playAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  element.addEventListener("animationend", () => element.classList.remove(className), { once: true });
}

function renderMoveSelection(state, moveEnabled) {
  const board = state.board.slice();
  const selected = moveSourceIndex !== null;
  if (selected && moveDestinationIndex !== null) {
    const movedTile = board.splice(moveSourceIndex, 1)[0];
    board.splice(moveDestinationIndex, 0, movedTile);
  }
  ui.moveSelection.innerHTML = `<div class="move-board-copy" aria-label="Select a board tile to move">${board.map((letter, index) => `<button class="move-copy-tile ${letter ? "filled" : "empty"} ${selected && index === moveDestinationIndex ? "selected" : ""}" data-move-copy-index="${index}" type="button" aria-label="${letter ? `Letter ${letter.toUpperCase()}, worth ${state.letter_points[letter]} points` : "Empty board space"}" ${moveEnabled ? "" : "disabled"}>${letter ? letter.toUpperCase() : ""}</button>`).join("")}</div>`;
  ui.moveLeft.disabled = !moveEnabled || !selected || moveDestinationIndex <= 0;
  ui.moveRight.disabled = !moveEnabled || !selected || moveDestinationIndex >= state.board.length - 1;
  ui.moveReset.disabled = !moveEnabled || !selected;
}

function renderShop(state) {
  const shop = state.shop;
  const active = Boolean(shop) && !state.game_over;
  if (!shop) {
    ui.shopBuyButtons.forEach(button => { button.disabled = true; });
    renderMoveSelection(state, false);
    return;
  }

  const replaceItem = shop.items.find(item => item.id === "replace_hand_tiles");
  const moveItem = shop.items.find(item => item.id === "move_board_tile");
  const replaceEnabled = active && replaceItem.affordable;
  const moveEnabled = active && moveItem.affordable;
  selectedShopHand = new Set([...selectedShopHand].filter(index => index < state.hand.length));
  ui.shopHandSelection.innerHTML = state.hand.map((letter, index) => `<button class="shop-hand-card ${selectedShopHand.has(index) ? "selected" : ""}" data-shop-hand-index="${index}" type="button" ${replaceEnabled ? "" : "disabled"}>${letter.toUpperCase()}</button>`).join("");
  if (!moveEnabled) {
    moveSourceIndex = null;
    moveDestinationIndex = null;
  }
  renderMoveSelection(state, moveEnabled);

  shop.items.forEach(item => {
    const button = document.querySelector(`[data-shop-item="${item.id}"]`);
    button.querySelector(`[data-shop-price="${item.id}"]`).textContent = item.price;
    const ready = item.id === "hint"
      ? state.phase === "build"
      : item.id === "replace_hand_tiles"
      ? selectedShopHand.size >= 1 && selectedShopHand.size <= 4
      : item.id === "move_board_tile"
        ? moveSourceIndex !== null && moveDestinationIndex !== null && moveSourceIndex !== moveDestinationIndex
      : true;
    button.disabled = !active || !item.affordable || !ready;
  });
}

function purchaseShopItem(itemId) {
  if (typeof window.pyPurchaseShopItem !== "function") return;
  const purchase = { item_id: itemId };
  if (itemId === "replace_hand_tiles") purchase.hand_indexes = [...selectedShopHand];
  if (itemId === "move_board_tile") {
    purchase.source_index = moveSourceIndex;
    purchase.destination_index = moveDestinationIndex;
  }
  selectedShopHand.clear();
  selectedHand.clear();
  selectedBoard.clear();
  moveSourceIndex = null;
  moveDestinationIndex = null;
  window.pyPurchaseShopItem(JSON.stringify(purchase));
}

function render(stateText) {
  previousState = currentState;
  currentState = JSON.parse(stateText);
  const state = currentState;
  const previousBoard = previousState?.board ?? [];
  const boardWasSmashed = previousBoard.some((letter, index) => letter && state.board[index] === null);
  const wordWasBuilt = state.history.length > (previousState?.history.length ?? 0);
  const scoreChanged = state.score !== (previousState?.score ?? state.score);
  const newRoundStarted = !state.game_over && (animateNextHandDeal || !previousState || previousState.phase === "smash" && state.phase === "build");
  animateNextHandDeal = false;
  renderShop(state);
  document.querySelector("#hand-limit").textContent = state.hand_limit;
  document.querySelector("#hand-limit-hint").textContent = state.hand_limit;
  document.querySelector("#board-size-limit").textContent = state.board_max_size;
  document.querySelector("#board-size-limit-hint").textContent = state.board_max_size;
  document.querySelector("#starting-hand-size").textContent = state.starting_hand_size;
  document.querySelector("#board-start-size").textContent = state.board_start_size;
  document.querySelector("#smash-limit").textContent = state.max_hammer_smash;
  const occupiedIndexes = state.board.map((letter, index) => letter === null ? -1 : index).filter(index => index >= 0);
  const activeLength = Math.max(4, occupiedIndexes.length ? Math.max(...occupiedIndexes) + 1 : 4);
  const requiredCards = state.board.slice(0, activeLength).filter(letter => letter === null).length;
  const emptyCount = state.board.filter(letter => letter === null).length;
  const previewBoard = state.board.slice();
  ui.board.style.setProperty("--board-slots", state.board.length);
  const selectedLetters = [...selectedHand].map(index => state.hand[index]);
  let selectedLetterIndex = 0;
  previewBoard.forEach((letter, index) => {
    if (letter === null && selectedLetterIndex < selectedLetters.length) {
      previewBoard[index] = selectedLetters[selectedLetterIndex++];
    }
  });
  document.querySelector("#board-size").textContent = state.board.length;
  document.querySelector("#phase-note").textContent = state.game_over
    ? "Game over. Deal a new board to play again."
    : state.phase === "build"
      ? `Select at least ${requiredCards} card${requiredCards === 1 ? "" : "s"} to fill the word.`
      : `Select up to ${state.max_hammer_smash - state.smashes_used} letter${state.max_hammer_smash - state.smashes_used === 1 ? "" : "s"}, then smash.`;
  ui.board.innerHTML = previewBoard.map((letter, index) => {
    const isPreview = state.board[index] === null && letter !== null;
    const wasFilled = previousBoard[index] !== null && previousBoard[index] !== undefined;
    const wasSmashed = wasFilled && state.board[index] === null;
    const wasNewlyFilled = wordWasBuilt && previousBoard[index] === null && state.board[index] !== null;
    const points = letter ? (state.board_points[index] ?? state.letter_points[letter]) : "";
    return `<button class="board-slot ${letter ? "filled" : "empty"} ${isPreview ? "preview" : ""} ${selectedBoard.has(index) ? "selected" : ""} ${wasSmashed ? "smash-impact" : ""} ${wasNewlyFilled ? "word-success" : ""}" data-board-index="${index}" type="button" ${state.phase !== "smash" || !state.board[index] ? "disabled" : ""}>${letter ? `<span class="board-letter">${letter.toUpperCase()}</span><span class="board-points">${points}</span>` : ""}</button>`;
  }).join("");
  ui.hand.innerHTML = state.hand.map((letter, index) => `<button class="hand-card ${selectedHand.has(index) ? "selected" : ""} ${newRoundStarted ? "deal-in" : ""}" data-hand-index="${index}" type="button" ${state.game_over || state.phase !== "build" ? "disabled" : ""}><span class="card-letter">${letter.toUpperCase()}</span><span class="card-points">${state.hand_points[index]}</span></button>`).join("");
  ui.score.textContent = state.score;
  ui.hintResult.textContent = state.hint_word ? `Try: ${state.hint_word.toUpperCase()}` : "";
  ui.moveCount.textContent = `${state.moves} ${state.moves === 1 ? "word" : "words"} built`;
  ui.dealButton.classList.toggle("subdued", state.history.length > 0 && !state.game_over);
  ui.dealButton.classList.toggle("prominent", state.game_over);
  ui.playButton.textContent = `Build word (${selectedHand.size}${requiredCards ? `/${requiredCards}+` : ""})`;
  ui.smashButton.textContent = `Smash letters (${state.smashes_used}/${state.max_hammer_smash})`;
  ui.smashButton.disabled = !state || state.phase !== "smash" || state.game_over || state.smashes_used >= state.max_hammer_smash;
  ui.nextRoundButton.disabled = !state || state.phase !== "smash" || state.game_over;
  ui.playButton.disabled = !state || state.phase !== "build" || selectedHand.size < requiredCards || selectedHand.size > emptyCount || state.game_over;
  ui.history.innerHTML = state.history.length
    ? state.history.map((word, index) => `<span class="history-word ${wordWasBuilt && index === state.history.length - 1 ? "word-success" : ""}">${word.toUpperCase()} <b>+${state.history_points[index]}</b></span>`).join("")
    : `<span class="empty-state">No words built yet.</span>`;
  ui.feedback.textContent = state.message;
  ui.feedback.className = `feedback ${state.kind}`.trim();
  if (state.kind === "error") playAnimation(ui.feedback, "error-shake");
  if (scoreChanged) {
    ui.score.classList.add("score-pulse");
    ui.score.addEventListener("animationend", () => ui.score.classList.remove("score-pulse"), { once: true });
  }
  if (boardWasSmashed) playAnimation(ui.board, "smash-impact");
  if (state.game_over && !previousState?.game_over) {
    playAnimation(ui.dealButton, "game-over-pulse");
    playSound("game-over");
    showGameOverModal(state.score, state.history.length);
  }
  if (state.kind === "success") playSound(previousState?.phase === "smash" ? "smash" : "success");
  if (state.kind === "error") playSound("error");
}

function setLoading(message) {
  ui.status.textContent = message;
  ui.status.className = "status-dot";
  setControls(false);
}

function setReady(count) {
  ui.status.textContent = `${count.toLocaleString()} dictionary words ready`;
  ui.status.className = "status-dot ready";
  setControls(true);
  ui.feedback.textContent = "Deal a board to start playing.";
}

function setError(message) {
  ui.status.textContent = "Dictionary unavailable";
  ui.status.className = "status-dot error";
  ui.feedback.textContent = message;
  ui.feedback.className = "feedback error";
  setControls(false);
}

function toggleHand(index) {
  if (selectedHand.has(index)) selectedHand.delete(index);
  else if (selectedHand.size < currentState.board.filter(letter => letter === null).length) {
    selectedHand.add(index);
    playSound("select");
  }
  render(JSON.stringify({ ...currentState, message: "", kind: "" }));
}

function toggleBoard(index) {
  if (selectedBoard.has(index)) selectedBoard.delete(index);
  else if (selectedBoard.size < currentState.max_hammer_smash - currentState.smashes_used) { selectedBoard.add(index); playSound("board"); }
  else return;
  render(JSON.stringify({ ...currentState, message: "", kind: "" }));
}

ui.board.addEventListener("click", event => {
  const slot = event.target.closest("[data-board-index]");
  if (slot && currentState.phase === "smash") toggleBoard(Number(slot.dataset.boardIndex));
});
ui.moveSelection.addEventListener("click", event => {
  const tile = event.target.closest("[data-move-copy-index]");
  if (!tile || tile.disabled || moveSourceIndex !== null) return;
  moveSourceIndex = Number(tile.dataset.moveCopyIndex);
  moveDestinationIndex = moveSourceIndex;
  render(JSON.stringify({ ...currentState, message: "", kind: "" }));
});
ui.moveLeft.addEventListener("click", () => {
  if (moveDestinationIndex > 0) {
    moveDestinationIndex -= 1;
    render(JSON.stringify({ ...currentState, message: "", kind: "" }));
  }
});
ui.moveRight.addEventListener("click", () => {
  if (moveDestinationIndex < currentState.board.length - 1) {
    moveDestinationIndex += 1;
    render(JSON.stringify({ ...currentState, message: "", kind: "" }));
  }
});
ui.moveReset.addEventListener("click", () => {
  moveSourceIndex = null;
  moveDestinationIndex = null;
  render(JSON.stringify({ ...currentState, message: "", kind: "" }));
});
ui.hand.addEventListener("click", event => {
  const card = event.target.closest("[data-hand-index]");
  if (card) toggleHand(Number(card.dataset.handIndex));
});
ui.shopHandSelection.addEventListener("click", event => {
  const card = event.target.closest("[data-shop-hand-index]");
  if (!card) return;
  const index = Number(card.dataset.shopHandIndex);
  if (selectedShopHand.has(index)) selectedShopHand.delete(index);
  else if (selectedShopHand.size < 4) selectedShopHand.add(index);
  render(JSON.stringify({ ...currentState, message: "", kind: "" }));
});
ui.shopBuyButtons.forEach(button => {
  button.addEventListener("click", () => purchaseShopItem(button.dataset.shopItem));
});
ui.feedback.addEventListener("click", () => ui.feedback.classList.add("dismissed"));
ui.dealButton.addEventListener("click", () => {
  selectedHand.clear();
  selectedBoard.clear();
  selectedShopHand.clear();
  moveSourceIndex = null;
  moveDestinationIndex = null;
  playSound("deal");
  animateNextHandDeal = true;
  window.pyStartRound();
  if (window.matchMedia("(max-width: 700px)").matches) {
    requestAnimationFrame(() => ui.playPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
});
ui.playButton.addEventListener("click", () => {
  const indexes = JSON.stringify([...selectedHand]);
  selectedHand.clear();
  window.pyPlaySelected(indexes);
});
ui.smashButton.addEventListener("click", () => {
  const indexes = JSON.stringify([...selectedBoard]);
  selectedBoard.clear();
  playSound("smash");
  window.pySmashSelected(indexes);
});
ui.nextRoundButton.addEventListener("click", () => {
  selectedHand.clear();
  selectedBoard.clear();
  playSound("deal");
  window.pyNextRound();
});

const LEADERBOARD_PAGE_SIZE = 50;
const LEADERBOARD_CACHE_TTL = 60000;
let pendingGameOverData = null;
let leaderboardCursor = null;
let leaderboardLoading = false;
let leaderboardDone = false;
let leaderboardRank = 0;
let playerInfo = null;
let leaderboardCache = null;

const NAME_COOKIE = "wordSmash.name";

function getCookieValue(name) {
  const raw = document.cookie;
  const part = (raw || "").split("; ").find(item => item.startsWith(`${name}=`));
  if (!part) return "";
  try {
    return decodeURIComponent(part.slice(name.length + 1));
  } catch {
    return part.slice(name.length + 1);
  }
}

function setCookieValue(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000;SameSite=Lax`;
  try {
    localStorage.setItem(name, value);
  } catch {
    return;
  }
}

function getSavedName() {
  return getCookieValue(NAME_COOKIE) || (typeof localStorage !== "undefined" && localStorage.getItem(NAME_COOKIE)) || "";
}

function setSavedName(value) {
  setCookieValue(NAME_COOKIE, value);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function sanitizeName(value) {
  return String(value).replace(/[^a-zA-Z0-9 _\-]/g, "").slice(0, 20);
}

function nameKey(name) {
  return encodeURIComponent(name.trim().toLowerCase());
}

function showGameOverModal(score, wordCount) {
  pendingGameOverData = { score, wordCount };
  ui.modalScore.textContent = score;
  ui.modalWords.textContent = wordCount;
  ui.playerNameInput.value = getSavedName();
  ui.playerNameInput.focus();
  ui.playerNameInput.select();
  if (ui.modalError) ui.modalError.hidden = true;
  if (typeof ui.gameOverModal?.showModal === "function") {
    ui.gameOverModal.showModal();
  } else {
    ui.gameOverModal.setAttribute("open", "");
  }
}

function closeGameOverModal() {
  if (typeof ui.gameOverModal?.close === "function") {
    ui.gameOverModal.close();
  } else {
    ui.gameOverModal.removeAttribute("open");
  }
  pendingGameOverData = null;
}

function builderRow(d, index, isPlayer = false) {
  return `<tr${isPlayer ? ' class="leaderboard-player-row"' : ""}>
    <td class="ld-rank">#${index}</td>
    <td class="ld-name">${escapeHtml(d.name)}${isPlayer ? " (you)" : ""}</td>
    <td class="ld-score">${Number(d.score).toLocaleString()}</td>
    <td class="ld-words">${Number(d.word_count) || 0}</td>
  </tr>`;
}

function setLeaderboardError(message) {
  leaderboardDone = true;
  if (message && !ui.leaderboardBody.innerHTML) {
    ui.leaderboardBody.innerHTML = `<tr><td colspan="4" class="empty-state error">${escapeHtml(message)}</td></tr>`;
  }
  ui.leaderboardStatus.textContent = "Error";
}

async function countHigher(orderValue) {
  const q = query(collection(db, "leaderboard"), where("order_value", ">", orderValue));
  const snap = await getDocs(q);
  return snap.size;
}

function chipRowHtml(p) {
  return `<tr class="leaderboard-chip-row" data-ld-jump="1" style="cursor:pointer">
    <td class="ld-rank">#${p.rank}</td>
    <td class="ld-name">${escapeHtml(p.name)} (you)</td>
    <td class="ld-score">${p.score.toLocaleString()}</td>
    <td class="ld-words">${p.wordCount}</td>
  </tr>`;
}

function syncPlayerChip() {
  if (!playerInfo) return;
  ui.leaderboardBody.querySelectorAll("tr.leaderboard-chip-row").forEach(r => r.remove());
  const playerRow = ui.leaderboardBody.querySelector("tr.leaderboard-player-row");
  const wrap = ui.leaderboardScroll;
  let playerVisible = false;
  if (playerRow && wrap) {
    const rowTop = playerRow.offsetTop - wrap.offsetTop;
    playerVisible = rowTop >= wrap.scrollTop && rowTop < wrap.scrollTop + wrap.clientHeight - 40;
  }
  if (!playerVisible) {
    ui.leaderboardBody.insertAdjacentHTML("beforeend", chipRowHtml(playerInfo));
  }
}

async function submitScoreSafe(name, score, wordCount) {
  if (!currentUser) {
    try {
      const cred = await signInAnonymously(auth);
      currentUser = cred.user;
    } catch (e) {
      console.error("Anonymous auth failed", e);
      return { ok: false, error: "Anonymous sign-in failed. Check that the Anonymous auth method is enabled and the API key is valid." };
    }
  }
  const cleanName = name.slice(0, 20);
  const orderValue = score * 1000000000 + (1000000000 - wordCount);
  try {
    const entryId = nameKey(name);
    const existing = await getDoc(doc(db, "leaderboard", entryId));
    if (existing.exists() && score <= Number(existing.data().score || -1)) {
      return { ok: true, updated: false };
    }
    await setDoc(doc(db, "leaderboard", entryId), {
      name: cleanName,
      score,
      word_count: wordCount,
      order_value: orderValue,
      timestamp: Date.now()
    }, { merge: false });
    return { ok: true, updated: true };
  } catch (e) {
    console.error("Firestore submit failed", e);
    return { ok: false, error: "Score submit failed. Check Firestore rules allow authenticated writes and that the database exists: " + String(e.message || e) };
  }
}

async function handleSubmit() {
  const rawName = (ui.playerNameInput.value || "").trim() || "Anonymous";
  const name = sanitizeName(rawName);
  if (ui.modalError) ui.modalError.hidden = true;
  setSavedName(name);
  const data = pendingGameOverData;
  closeGameOverModal();
  if (!data) return;
  const result = await submitScoreSafe(name, data.score, data.wordCount);
  if (result && !result.ok && ui.modalError) {
    ui.modalError.textContent = result.error;
    ui.modalError.hidden = false;
    ui.gameOverModal.showModal();
  } else {
    leaderboardCache = null;
    await fetchLeaderboard(true);
  }
}

ui.modalSubmitBtn?.addEventListener("click", handleSubmit);
ui.modalSkipBtn?.addEventListener("click", closeGameOverModal);
ui.playerNameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSubmit();
  }
});
ui.playerNameInput?.addEventListener("input", (e) => {
  e.target.value = sanitizeName(e.target.value);
});

async function fetchLeaderboard(reset = false) {
  if (leaderboardLoading || (!reset && leaderboardDone)) return;
  leaderboardLoading = true;
  try {
    if (reset) {
      leaderboardCursor = null;
      leaderboardDone = false;
      leaderboardRank = 0;
      playerInfo = null;
      ui.leaderboardBody.innerHTML = "";
      ui.leaderboardEnd.hidden = true;
      ui.leaderboardEnd.textContent = "";
      const savedName = getSavedName();
      if (savedName) {
        const pinRef = doc(db, "leaderboard", nameKey(savedName));
        const pinSnap = await getDoc(pinRef);
        if (pinSnap.exists()) {
          const d = pinSnap.data();
          playerInfo = {
            id: pinSnap.id,
            name: String(d.name),
            score: Number(d.score) || 0,
            wordCount: Number(d.word_count) || 0,
            rank: (await countHigher(Number(d.order_value) || 0)) + 1,
          };
        }
      }
      const now = Date.now();
      if (leaderboardCache && now - leaderboardCache.time < LEADERBOARD_CACHE_TTL) {
        renderLeaderboardPage(leaderboardCache.docs);
        leaderboardLoading = false;
        return;
      }
    }
    let q = query(collection(db, "leaderboard"), orderBy("order_value", "desc"), limit(LEADERBOARD_PAGE_SIZE));
    if (leaderboardCursor) q = query(q, startAfter(leaderboardCursor));
    const snap = await getDocs(q);

    if (!leaderboardCursor) {
      leaderboardCache = { docs: snap.docs, time: Date.now() };
    }

    renderLeaderboardPage(snap.docs);
  } catch (e) {
    console.error("Leaderboard load failed", e);
    setLeaderboardError(e.message || String(e));
  } finally {
    leaderboardLoading = false;
    const wrap = ui.leaderboardScroll;
    if (!leaderboardDone && wrap && wrap.scrollHeight <= wrap.clientHeight + 2) {
      fetchLeaderboard();
    }
  }
}

function renderLeaderboardPage(docs) {
  let morePages = docs.length >= LEADERBOARD_PAGE_SIZE;
  const rendered = docs.map(docEntry => {
    leaderboardRank += 1;
    return builderRow(docEntry.data(), leaderboardRank, playerInfo && docEntry.id === playerInfo.id);
  }).join("");

  if (docs.length === 0 && !ui.leaderboardBody.innerHTML) {
    ui.leaderboardBody.innerHTML = '<tr><td colspan="4" class="empty-state">No scores yet. Be the first!</td></tr>';
    ui.leaderboardStatus.textContent = "";
    leaderboardDone = true;
    return;
  }
  leaderboardCursor = docs[docs.length - 1];
  if (rendered) ui.leaderboardBody.insertAdjacentHTML("beforeend", rendered);

  leaderboardDone = !morePages;
  ui.leaderboardEnd.hidden = false;
  ui.leaderboardEnd.textContent = morePages ? "Scroll for more" : (ui.leaderboardBody.innerHTML ? "All caught up" : "");
  ui.leaderboardStatus.textContent = "";
  syncPlayerChip();
}

ui.leaderboardBody?.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-ld-jump]")) return;
  const body = ui.leaderboardBody;
  const wrap = ui.leaderboardScroll;
  if (!wrap) return;
  let guard = 0;
  while (!body.querySelector("tr.leaderboard-player-row") && !leaderboardDone && guard < 10) {
    await fetchLeaderboard();
    guard++;
  }
  const row = body.querySelector("tr.leaderboard-player-row");
  if (row && wrap) {
    const target = row.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
    wrap.scrollTo({ top: Math.max(0, target - 20), behavior: "smooth" });
  }
});

let scrollTimer = null;
ui.leaderboardScroll?.addEventListener("scroll", () => {
  syncPlayerChip();
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    const wrap = ui.leaderboardScroll;
    if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 32) {
      fetchLeaderboard();
    }
  }, 300);
});

auth.onAuthStateChanged(user => {
  currentUser = user;
});

fetchLeaderboard(true);

window.wordSmashUI = { render, setLoading, setReady, setError };

document.querySelectorAll("details.how-to-play").forEach(details => {
  const summary = details.querySelector("summary");
  const content = details.querySelector(":not(summary)");
  if (!summary || !content) return;
  content.style.overflow = "hidden";
  summary.addEventListener("click", (e) => {
    e.preventDefault();
    if (details.open) {
      content.style.maxHeight = content.scrollHeight + "px";
      content.offsetHeight;
      content.style.transition = "max-height 0.3s ease";
      content.style.maxHeight = "0px";
      content.addEventListener("transitionend", function h() {
        details.open = false;
        content.style.transition = "";
        content.style.maxHeight = "";
        content.removeEventListener("transitionend", h);
      });
    } else {
      details.open = true;
      content.style.maxHeight = "0px";
      content.offsetHeight;
      content.style.transition = "max-height 0.3s ease";
      content.style.maxHeight = content.scrollHeight + "px";
      content.addEventListener("transitionend", function h() {
        content.style.transition = "";
        content.style.maxHeight = "";
        content.removeEventListener("transitionend", h);
      });
    }
  });
});
