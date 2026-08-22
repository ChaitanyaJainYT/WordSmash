"""WordSmash board rules and PyScript bridge."""

import asyncio
import json
import random
from collections import Counter

from js import fetch, window
from pyodide.ffi import create_proxy

WORD_LIST_FILE = "Collins Scrabble Words (2019).txt"
STARTING_HAND_SIZE = 8
MAX_HAND_SIZE = 8
MAX_HAMMER_SMASH = 2
MIN_WORD_LENGTH = 4
STARTING_BOARD_SIZE = 4
MAX_BOARD_SIZE = 15
MAX_OPENING_DEALS = 3

LETTER_DISTRIBUTION = {
    "a": 9, "b": 2, "c": 2, "d": 4, "e": 12, "f": 2, "g": 3,
    "h": 2, "i": 9, "j": 1, "k": 1, "l": 4, "m": 2, "n": 6,
    "o": 8, "p": 2, "q": 1, "r": 6, "s": 4, "t": 6, "u": 4,
    "v": 2, "w": 2, "x": 1, "y": 2, "z": 1,
}

MESSAGES = {
    "round_over": "This round is over. Deal a new board to play again.",
    "hand_unavailable": "That hand card is unavailable.",
    "build_before_smash": "Build a valid word before smashing letters.",
    "build_before_next_round": "Build a valid word before starting the next round.",
    "deal_to_play": "Deal a board to start playing.",
    "deal_to_shop": "Deal a board to start shopping.",
    "start_round": "Create a unique word of at least 4 letters.",
    "next_round": "Select hand cards to build the next word.",
}

SHOP_PRICE_STEP = 10
SHOP_ITEMS = {
    "extra_hammer": {"label": "Extra hammer", "description": "Increase hammer capacity by 1.", "price": 10},
    "extra_hand_space": {"label": "Extra hand space", "description": "Increase the hand limit by 4.", "price": 10},
    "replace_hand_tiles": {"label": "Replace hand tiles", "description": "Replace up to 4 selected hand tiles in the same positions.", "price": 10},
    "move_board_tile": {"label": "Move board tile", "description": "Move one board slot to another position.", "price": 10},
    "hint": {"label": "Hint", "description": "Show one word you can make from the current board and hand.", "price": 10},
}

SCORES = {
    "a": 1, "b": 3, "c": 3, "d": 2, "e": 1, "f": 4, "g": 2,
    "h": 4, "i": 1, "j": 8, "k": 5, "l": 1, "m": 3, "n": 1,
    "o": 1, "p": 3, "q": 10, "r": 1, "s": 1, "t": 1, "u": 1,
    "v": 4, "w": 4, "x": 8, "y": 4, "z": 10,
}

WORDS = set()
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
        self.last_hint = None
        self.hand_limit = MAX_HAND_SIZE
        self.max_hammer_smash = MAX_HAMMER_SMASH
        self.shop_purchases = {item_id: 0 for item_id in SHOP_ITEMS}

    def deal_hand(self, count):
        available = max(0, self.hand_limit - len(self.hand))
        letters = list(LETTER_DISTRIBUTION)
        weights = [LETTER_DISTRIBUTION[letter] for letter in letters]
        self.hand.extend(random.choices(letters, weights=weights, k=min(count, available)))

    def start(self):
        self.board = [None] * STARTING_BOARD_SIZE
        self.history = []
        self.score = 0
        self.phase = "build"
        self.game_over = False
        self.game_over_message = ""
        self.last_hint = None
        for _ in range(MAX_OPENING_DEALS):
            self.hand = []
            self.deal_hand(STARTING_HAND_SIZE)
            if self.has_valid_move():
                return

        self.game_over = True
        self.game_over_message = f"Game over: no 4-letter word was possible after {MAX_OPENING_DEALS} deals. Deal a new board to try again."

    def empty_slots(self):
        return [index for index, letter in enumerate(self.board) if letter is None]

    def required_cards(self):
        occupied_slots = [index for index, letter in enumerate(self.board) if letter is not None]
        active_length = max(STARTING_BOARD_SIZE, (max(occupied_slots) + 1) if occupied_slots else 0)
        return sum(letter is None for letter in self.board[:active_length])

    def play(self, selected_indexes):
        if self.game_over:
            raise ValueError(MESSAGES["round_over"])
        if self.phase != "build":
            raise ValueError("Smash letters before building again.")
        if len(set(selected_indexes)) != len(selected_indexes):
            raise ValueError("Select each hand card only once.")
        if any(index < 0 or index >= len(self.hand) for index in selected_indexes):
            raise ValueError(MESSAGES["hand_unavailable"])

        required_cards = self.required_cards()
        empty_slots = self.empty_slots()
        if len(selected_indexes) < required_cards:
            raise ValueError(f"Select at least {required_cards} card{'s' if required_cards != 1 else ''} to fill every gap.")
        if len(selected_indexes) > len(empty_slots):
            raise ValueError(f"Select no more than {len(empty_slots)} card{'s' if len(empty_slots) != 1 else ''}; only {len(empty_slots)} board space{'s' if len(empty_slots) != 1 else ''} {'are' if len(empty_slots) != 1 else 'is'} open.")

        candidate_board = self.board[:]
        selected_letters = [self.hand[index] for index in selected_indexes]
        for slot, letter in zip(empty_slots, selected_letters):
            candidate_board[slot] = letter
        last_filled = max(index for index, letter in enumerate(candidate_board) if letter is not None)
        word = "".join(candidate_board[:last_filled + 1])
        if len(word) < MIN_WORD_LENGTH:
            raise ValueError("Words must be at least 4 letters long.")
        if any(letter is None for letter in candidate_board[:last_filled + 1]):
            raise ValueError("Fill every space inside the word.")
        if word not in self.words:
            raise ValueError(f"\"{word.upper()}\" is not in the dictionary. Try another word.")
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
            raise ValueError(MESSAGES["round_over"])
        if self.phase != "smash":
            raise ValueError(MESSAGES["build_before_smash"])
        selected_indexes = sorted(set(selected_indexes))
        remaining_smashes = self.max_hammer_smash - self.smashes_used_this_turn
        if not selected_indexes:
            raise ValueError("Select at least one board letter to smash.")
        if len(selected_indexes) > remaining_smashes:
            raise ValueError(f"You can select at most {remaining_smashes} more board letter{'s' if remaining_smashes != 1 else ''} to smash.")
        if any(index < 0 or index >= len(self.board) or self.board[index] is None for index in selected_indexes):
            raise ValueError("Select filled board letters to smash.")

        for index in selected_indexes:
            self.board[index] = None
        self.smashes_used_this_turn += len(selected_indexes)

    def next_round(self):
        if self.game_over:
            raise ValueError(MESSAGES["round_over"])
        if self.phase != "smash":
            raise ValueError(MESSAGES["build_before_next_round"])
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

    def find_hint(self):
        if self.phase != "build":
            return None
        candidates = (
            word
            for word in self.words
            if MIN_WORD_LENGTH <= len(word) <= len(self.board)
            and word not in self.history
            and self.can_build_word(word)
        )
        return max(candidates, key=lambda word: (len(word), word), default=None)

    def check_moves(self):
        if not self.empty_slots() and len(self.board) >= MAX_BOARD_SIZE:
            self.game_over = True
            self.game_over_message = "Game over: the board is full."
        elif not self.has_valid_move():
            self.game_over = True
            self.game_over_message = "Game over: no valid word can be built from your hand and board."
        else:
            self.game_over = False
            self.game_over_message = ""

    def shop_price(self, item_id):
        return SHOP_ITEMS[item_id]["price"] + self.shop_purchases[item_id] * SHOP_PRICE_STEP

    def shop_state(self):
        return {
            "items": [
                {
                    "id": item_id,
                    "label": details["label"],
                    "description": details["description"],
                    "price": self.shop_price(item_id),
                    "purchases": self.shop_purchases[item_id],
                    "affordable": self.score >= self.shop_price(item_id),
                }
                for item_id, details in SHOP_ITEMS.items()
            ],
            "hand_limit": self.hand_limit,
            "max_hammer_smash": self.max_hammer_smash,
        }

    def purchase_shop_item(self, item_id, hand_indexes=None, source_index=None, destination_index=None):
        if self.game_over:
            raise ValueError("The shop is closed after game over. Deal a new board to continue.")
        if item_id not in SHOP_ITEMS:
            raise ValueError("That power-up is unavailable.")

        price = self.shop_price(item_id)
        if self.score < price:
            raise ValueError(f"You need {price} more points to buy {SHOP_ITEMS[item_id]['label'].lower()}.")

        hint_word = None
        if item_id == "hint":
            hint_word = self.find_hint()
            if hint_word is None:
                raise ValueError("No word can be built from the current board and hand.")
            self.last_hint = hint_word

        if item_id == "replace_hand_tiles":
            selected = sorted(set(hand_indexes or []))
            if not 1 <= len(selected) <= 4:
                raise ValueError("Select 1 to 4 hand tiles to replace.")
            if any(index < 0 or index >= len(self.hand) for index in selected):
                raise ValueError("That hand tile is not available.")
        elif item_id == "move_board_tile":
            if source_index is None or destination_index is None:
                raise ValueError("Choose a board tile and a destination.")
            if not 0 <= source_index < len(self.board) or not 0 <= destination_index < len(self.board):
                raise ValueError("Choose positions on the current board.")

        self.score -= price
        self.shop_purchases[item_id] += 1
        if item_id == "extra_hammer":
            self.max_hammer_smash += 1
        elif item_id == "extra_hand_space":
            self.hand_limit += 4
        elif item_id == "replace_hand_tiles":
            letters = list(LETTER_DISTRIBUTION)
            weights = [LETTER_DISTRIBUTION[letter] for letter in letters]
            for index in selected:
                self.hand[index] = random.choices(letters, weights=weights, k=1)[0]
        elif item_id == "move_board_tile":
            moved_tile = self.board.pop(source_index)
            self.board.insert(destination_index, moved_tile)
        return hint_word

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
            "hand_limit": self.hand_limit,
            "starting_hand_size": STARTING_HAND_SIZE,
            "board_start_size": STARTING_BOARD_SIZE,
            "board_max_size": MAX_BOARD_SIZE,
            "max_hammer_smash": self.max_hammer_smash,
            "smashes_used": self.smashes_used_this_turn,
            "hint_word": self.last_hint,
            "shop": self.shop_state(),
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
        render(MESSAGES["start_round"], "success")


def play_selected(value="", *_args):
    if not game:
        return render(MESSAGES["deal_to_play"], "error")
    try:
        points = game.play(parse_indexes(value))
        render(f"{game.history[-1].upper()} scored {points}. Select letters on the board to smash.", "success")
    except ValueError as error:
        render(str(error), "error")


def smash_selected(value="", *_args):
    if not game:
        return render(MESSAGES["deal_to_play"], "error")
    try:
        selected_indexes = parse_indexes(value)
        game.smash(selected_indexes)
        remaining = game.max_hammer_smash - game.smashes_used_this_turn
        render(f"Letter smashed. {remaining} hammer smash{'es' if remaining != 1 else ''} remaining. Click Next Round when ready.", "success")
    except ValueError as error:
        render(str(error), "error")


def next_round(*_args):
    if not game:
        return render(MESSAGES["deal_to_play"], "error")
    try:
        game.next_round()
        if game.game_over:
            render(game.game_over_message, "error")
        else:
            render(MESSAGES["next_round"], "success")
    except ValueError as error:
        render(str(error), "error")


def purchase_shop_item(value="", *_args):
    if not game:
        return render(MESSAGES["deal_to_shop"], "error")
    try:
        purchase = json.loads(str(value))
        hint_word = game.purchase_shop_item(
            purchase.get("item_id", ""),
            purchase.get("hand_indexes"),
            purchase.get("source_index"),
            purchase.get("destination_index"),
        )
        message = f"Hint: try {hint_word.upper()}." if hint_word else "Power-up purchased."
        render(message, "success")
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        render(str(error), "error")


def set_loading(message):
    window.wordSmashUI.setLoading(message)


async def load_words():
    set_loading("Loading dictionary...")
    try:
        word_response = await fetch(WORD_LIST_FILE)
        if not word_response.ok:
            raise RuntimeError(f"Could not load {WORD_LIST_FILE}")
        text = await word_response.text()
        WORDS.update(line.strip().lower() for line in text.splitlines() if line.strip().isalpha())
        if not WORDS:
            raise RuntimeError("The dictionary has no usable words.")

        window.pyStartRound = create_proxy(start_round)
        window.pyPlaySelected = create_proxy(play_selected)
        window.pySmashSelected = create_proxy(smash_selected)
        window.pyNextRound = create_proxy(next_round)
        window.pyPurchaseShopItem = create_proxy(purchase_shop_item)
        window.wordSmashUI.setReady(len(WORDS))
        start_round()
    except Exception as error:
        window.wordSmashUI.setError(str(error))


asyncio.ensure_future(load_words())
