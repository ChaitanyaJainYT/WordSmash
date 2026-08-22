const themeStorageKey = "wordSmash.theme";
const themeToggle = document.querySelector("#theme-toggle");

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
  moveSelection: document.querySelector("#move-selection"),
  moveLeft: document.querySelector("#move-left"),
  moveRight: document.querySelector("#move-right"),
  moveReset: document.querySelector("#move-reset"),
  shopBuyButtons: [...document.querySelectorAll("[data-shop-item]")],
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
    const ready = item.id === "replace_hand_tiles"
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
    ? "Round over. Deal a new board to play again."
    : state.phase === "build"
      ? `Select at least ${requiredCards} card${requiredCards === 1 ? "" : "s"} to fill the word. Extra cards fill trailing spaces.`
      : `Word scored. Select up to ${state.max_hammer_smash - state.smashes_used} letter${state.max_hammer_smash - state.smashes_used === 1 ? "" : "s"}, then smash.`;
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
  if (state.game_over && !previousState?.game_over) playAnimation(ui.dealButton, "game-over-pulse");
  if (state.game_over && !previousState?.game_over) playSound("game-over");
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

window.wordSmashUI = { render, setLoading, setReady, setError };
