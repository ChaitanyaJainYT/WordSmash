"""WordSmash board rules and PyScript bridge."""

import asyncio
import json
import random
from collections import Counter

from js import fetch, window
from pyodide.ffi import create_proxy

WORD_LIST_FILE = "Collins Scrabble Words (2019).txt"
LETTER_FREQUENCY_FILE = "letter_frequency.json"
# Keep False to use letter_frequency.json; set True to trial inverse Scrabble-score weighting.
USE_SCORE_FREQUENCY = False
STARTING_HAND_SIZE = 8
MAX_HAND_SIZE = 16
MAX_HAMMER_SMASH = 2
MIN_WORD_LENGTH = 4
STARTING_BOARD_SIZE = 4
MAX_BOARD_SIZE = 15
MAX_OPENING_DEALS = 3

SCORES = {
    "a": 1, "b": 3, "c": 3, "d": 2, "e": 1, "f": 4, "g": 2,
    "h": 4, "i": 1, "j": 8, "k": 5, "l": 1, "m": 3, "n": 1,
    "o": 1, "p": 3, "q": 10, "r": 1, "s": 1, "t": 1, "u": 1,
    "v": 4, "w": 4, "x": 8, "y": 4, "z": 10,
}

WORDS = set()
LETTER_WEIGHTS = {}
game = None


def clean(value):
    return "".join(str(value).strip().lower().split())


def score_word(word):
    return sum(SCORES.get(letter, 0) for letter in word)


def parse_indexes(value):
    return [int(index) for index in json.loads(str(value))]


class WordSmashGame:
    def __init__(self, words):
        self.words = words
        self.hand = []
        self.board = [None] * STARTING_BOARD_SIZE
        self.history = []
        self.score = 0
        self.phase = "build"
        self.game_over = False
        self.game_over_message = ""
        self.cards_played_this_turn = 0
        self.smashes_used_this_turn = 0

    def deal_hand(self, count):
        available = max(0, MAX_HAND_SIZE - len(self.hand))
        letters = list(LETTER_WEIGHTS)
        weights = [11 - SCORES[letter] for letter in letters] if USE_SCORE_FREQUENCY else [LETTER_WEIGHTS[letter] for letter in letters]
        self.hand.extend(random.choices(letters, weights=weights, k=min(count, available)))

    def start(self):
        self.board = [None] * STARTING_BOARD_SIZE
        self.history = []
        self.score = 0
        self.phase = "build"
        self.game_over = False
        self.game_over_message = ""
        for _ in range(MAX_OPENING_DEALS):
            self.hand = []
            self.deal_hand(STARTING_HAND_SIZE)
            if self.has_valid_move():
                return

        self.game_over = True
        self.game_over_message = f"Game over: no 4-letter word can be built after {MAX_OPENING_DEALS} deals. Deal a new board to try again."

    def empty_slots(self):
        return [index for index, letter in enumerate(self.board) if letter is None]

    def required_cards(self):
        occupied_slots = [index for index, letter in enumerate(self.board) if letter is not None]
        active_length = max(STARTING_BOARD_SIZE, (max(occupied_slots) + 1) if occupied_slots else 0)
        return sum(letter is None for letter in self.board[:active_length])

    def play(self, selected_indexes):
        if self.game_over:
            raise ValueError("This round is over. Deal a new board to play again.")
        if self.phase != "build":
            raise ValueError("Smash up to two letters before building again.")
        if len(set(selected_indexes)) != len(selected_indexes):
            raise ValueError("Select each hand card only once.")
        if any(index < 0 or index >= len(self.hand) for index in selected_indexes):
            raise ValueError("That hand card is not available.")

        required_cards = self.required_cards()
        empty_slots = self.empty_slots()
        if len(selected_indexes) < required_cards:
            raise ValueError(f"Select at least {required_cards} hand card{'s' if required_cards != 1 else ''} to fill every internal gap.")
        if len(selected_indexes) > len(empty_slots):
            raise ValueError(f"Select no more than {len(empty_slots)} available board space{'s' if len(empty_slots) != 1 else ''}.")

        candidate_board = self.board[:]
        selected_letters = [self.hand[index] for index in selected_indexes]
        for slot, letter in zip(empty_slots, selected_letters):
            candidate_board[slot] = letter
        last_filled = max(index for index, letter in enumerate(candidate_board) if letter is not None)
        word = "".join(candidate_board[:last_filled + 1])
        if len(word) < MIN_WORD_LENGTH:
            raise ValueError("Board words must be at least 4 letters long.")
        if any(letter is None for letter in candidate_board[:last_filled + 1]):
            raise ValueError("Fill every empty space inside the word.")
        if word not in self.words:
            raise ValueError(f"\"{word.upper()}\" is not in the dictionary. Try different letters.")
        if word in self.history:
            raise ValueError("You already built that word this round.")

        points = score_word(word)
        self.board = candidate_board
        self.hand = [letter for index, letter in enumerate(self.hand) if index not in selected_indexes]
        self.history.append(word)
        self.score += points
        self.cards_played_this_turn = len(selected_indexes)
        self.smashes_used_this_turn = 0
        if len(word) == len(self.board) and len(self.board) < MAX_BOARD_SIZE:
            self.board.append(None)
        self.phase = "smash"
        return points

    def smash(self, selected_indexes):
        if self.game_over:
            raise ValueError("This round is over. Deal a new board to play again.")
        if self.phase != "smash":
            raise ValueError("Build a valid word before smashing.")
        selected_indexes = sorted(set(selected_indexes))
        remaining_smashes = MAX_HAMMER_SMASH - self.smashes_used_this_turn
        if not selected_indexes:
            raise ValueError("Select at least one board letter to smash.")
        if len(selected_indexes) > remaining_smashes:
            raise ValueError(f"You can select at most {remaining_smashes} more board letter{'s' if remaining_smashes != 1 else ''} to smash.")
        if any(index < 0 or index >= len(self.board) or self.board[index] is None for index in selected_indexes):
            raise ValueError("Select occupied board letters to smash.")

        for index in selected_indexes:
            self.board[index] = None
        self.smashes_used_this_turn += len(selected_indexes)

    def next_round(self):
        if self.game_over:
            raise ValueError("This round is over. Deal a new board to play again.")
        if self.phase != "smash":
            raise ValueError("Build a valid word before starting the next round.")
        refill_count = self.cards_played_this_turn + (MAX_HAMMER_SMASH - self.smashes_used_this_turn)
        self.deal_hand(refill_count)
        self.phase = "build"
        self.check_moves()

    def can_build_word(self, word):
        if len(word) > len(self.board) or len(word) < MIN_WORD_LENGTH:
            return False
        missing = Counter()
        for index, board_letter in enumerate(self.board):
            if index >= len(word):
                if board_letter is not None:
                    return False
                continue
            if board_letter is None:
                missing[word[index]] += 1
            elif word[index] != board_letter:
                return False
        return not (missing - Counter(self.hand))

    def has_valid_move(self):
        return any(
            MIN_WORD_LENGTH <= len(word) <= len(self.board)
            and word not in self.history
            and self.can_build_word(word)
            for word in self.words
        )

    def check_moves(self):
        if not self.empty_slots() and len(self.board) >= MAX_BOARD_SIZE:
            self.game_over = True
            self.game_over_message = "Game over: the board is full."
        elif not self.has_valid_move():
            self.game_over = True
            self.game_over_message = "Game over: no valid word can be made from your hand and the letters on the board."
        else:
            self.game_over = False
            self.game_over_message = ""

    def state(self, message="", kind=""):
        return json.dumps({
            "hand": self.hand,
            "hand_points": [SCORES[letter] for letter in self.hand],
            "board": self.board,
            "board_points": [SCORES[letter] if letter else None for letter in self.board],
            "letter_points": SCORES,
            "history": self.history,
            "history_points": [score_word(word) for word in self.history],
            "score": self.score,
            "moves": len(self.history),
            "phase": self.phase,
            "game_over": self.game_over,
            "game_over_message": self.game_over_message,
            "hand_limit": MAX_HAND_SIZE,
            "starting_hand_size": STARTING_HAND_SIZE,
            "board_start_size": STARTING_BOARD_SIZE,
            "board_max_size": MAX_BOARD_SIZE,
            "max_hammer_smash": MAX_HAMMER_SMASH,
            "smashes_used": self.smashes_used_this_turn,
            "message": message,
            "kind": kind,
        })


def render(message="", kind=""):
    if game:
        window.wordSmashUI.render(game.state(message, kind))


def start_round(*_args):
    global game
    game = WordSmashGame(WORDS)
    game.start()
    if game.game_over:
        render(game.game_over_message, "error")
    else:
        render("Select hand cards to fill the board from left to right.", "success")


def play_selected(value="", *_args):
    if not game:
        return render("Deal a board to start playing.", "error")
    try:
        points = game.play(parse_indexes(value))
        render(f"{game.history[-1].upper()} scored {points}. Select up to two letters to smash.", "success")
    except ValueError as error:
        render(str(error), "error")


def smash_selected(value="", *_args):
    if not game:
        return render("Deal a board to start playing.", "error")
    try:
        selected_indexes = parse_indexes(value)
        game.smash(selected_indexes)
        remaining = MAX_HAMMER_SMASH - game.smashes_used_this_turn
        render(f"Letter smashed. {remaining} hammer smash{'es' if remaining != 1 else ''} remaining. Click Next Round when ready.", "success")
    except ValueError as error:
        render(str(error), "error")


def next_round(*_args):
    if not game:
        return render("Deal a board to start playing.", "error")
    try:
        game.next_round()
        if game.game_over:
            render(game.game_over_message, "error")
        else:
            render("Select hand cards to build the next word.", "success")
    except ValueError as error:
        render(str(error), "error")


def set_loading(message):
    window.wordSmashUI.setLoading(message)


async def load_words():
    set_loading("Loading dictionary...")
    try:
        word_response = await fetch(WORD_LIST_FILE)
        if not word_response.ok:
            raise RuntimeError(f"Could not load {WORD_LIST_FILE}")
        frequency_response = await fetch(LETTER_FREQUENCY_FILE)
        if not frequency_response.ok:
            raise RuntimeError(f"Could not load {LETTER_FREQUENCY_FILE}")

        text = await word_response.text()
        WORDS.update(line.strip().lower() for line in text.splitlines() if line.strip().isalpha())
        if not WORDS:
            raise RuntimeError("The dictionary contains no usable words.")

        frequency_data = json.loads(await frequency_response.text())
        LETTER_WEIGHTS.update({
            letter: details["percentage"]
            for letter, details in frequency_data["letters"].items()
            if letter.isalpha() and details["percentage"] > 0
        })
        if len(LETTER_WEIGHTS) != 26:
            raise RuntimeError("The letter frequency file must contain all 26 letters.")

        window.pyStartRound = create_proxy(start_round)
        window.pyPlaySelected = create_proxy(play_selected)
        window.pySmashSelected = create_proxy(smash_selected)
        window.pyNextRound = create_proxy(next_round)
        window.wordSmashUI.setReady(len(WORDS))
        start_round()
    except Exception as error:
        window.wordSmashUI.setError(str(error))


asyncio.ensure_future(load_words())
