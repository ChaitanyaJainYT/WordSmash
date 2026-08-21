const ui = {
  status: document.querySelector("#dictionary-status"),
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
};

let selectedHand = new Set();
let selectedBoard = new Set();
let currentState = null;
let previousState = null;
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
}

function setControls(enabled) {
  ui.dealButton.disabled = !enabled;
  ui.playButton.disabled = !enabled;
  ui.smashButton.disabled = !enabled;
  ui.nextRoundButton.disabled = !enabled;
}

function render(stateText) {
  previousState = currentState;
  currentState = JSON.parse(stateText);
  const state = currentState;
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
      ? `Select at least ${requiredCards} hand card${requiredCards === 1 ? "" : "s"}. Extra cards extend the word into trailing spaces.`
      : `Word scored. Select up to ${state.max_hammer_smash - state.smashes_used} board letters and hammer smash.`;
  ui.board.innerHTML = previewBoard.map((letter, index) => {
    const isPreview = state.board[index] === null && letter !== null;
    const points = letter ? (state.board_points[index] ?? state.letter_points[letter]) : "";
    return `<button class="board-slot ${letter ? "filled" : "empty"} ${isPreview ? "preview" : ""} ${selectedBoard.has(index) ? "selected" : ""}" data-board-index="${index}" type="button" ${state.phase !== "smash" || !state.board[index] ? "disabled" : ""}>${letter ? `<span class="board-letter">${letter.toUpperCase()}</span><span class="board-points">${points}</span>` : ""}</button>`;
  }).join("");
  ui.hand.innerHTML = state.hand.map((letter, index) => `<button class="hand-card ${selectedHand.has(index) ? "selected" : ""}" data-hand-index="${index}" type="button" ${state.game_over || state.phase !== "build" ? "disabled" : ""}><span class="card-letter">${letter.toUpperCase()}</span><span class="card-points">${state.hand_points[index]}</span></button>`).join("");
  ui.score.textContent = state.score;
  ui.moveCount.textContent = `${state.moves} ${state.moves === 1 ? "word" : "words"}`;
  ui.dealButton.classList.toggle("subdued", state.history.length > 0 && !state.game_over);
  ui.dealButton.classList.toggle("prominent", state.game_over);
  ui.playButton.textContent = `Build word (${selectedHand.size}${requiredCards ? `/${requiredCards}+` : ""})`;
  ui.smashButton.textContent = `Hammer smash (${state.smashes_used}/${state.max_hammer_smash} smashed)`;
  ui.smashButton.disabled = !state || state.phase !== "smash" || state.game_over || state.smashes_used >= state.max_hammer_smash;
  ui.nextRoundButton.disabled = !state || state.phase !== "smash" || state.game_over;
  ui.playButton.disabled = !state || state.phase !== "build" || selectedHand.size < requiredCards || selectedHand.size > emptyCount || state.game_over;
  ui.history.innerHTML = state.history.length
    ? state.history.map((word, index) => `<span class="history-word">${word.toUpperCase()} <b>+${state.history_points[index]}</b></span>`).join("")
    : `<span class="empty-state">Built words will appear here.</span>`;
  ui.feedback.textContent = state.message;
  ui.feedback.className = `feedback ${state.kind}`.trim();
  if (state.kind === "success") playSound(previousState?.phase === "smash" ? "smash" : "success");
  if (state.kind === "error") playSound("error");
}

function setLoading(message) {
  ui.status.textContent = message;
  ui.status.className = "status-dot";
  setControls(false);
}

function setReady(count) {
  ui.status.textContent = `${count.toLocaleString()} words ready`;
  ui.status.className = "status-dot ready";
  setControls(true);
  ui.feedback.textContent = "Deal a board to start playing.";
}

function setError(message) {
  ui.status.textContent = "Dictionary error";
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
  if (slot) toggleBoard(Number(slot.dataset.boardIndex));
});
ui.hand.addEventListener("click", event => {
  const card = event.target.closest("[data-hand-index]");
  if (card) toggleHand(Number(card.dataset.handIndex));
});
ui.dealButton.addEventListener("click", () => {
  selectedHand.clear();
  selectedBoard.clear();
  playSound("deal");
  window.pyStartRound();
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
