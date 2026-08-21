# WordSmash

WordSmash is a browser-based Scrabble-style word game. Python owns the game rules and dictionary loading through PyScript; HTML, CSS, JavaScript, and Python are separate files.

## Run it

No virtual environment or Python package installation is required.

From this folder, start the local file server:

```powershell
py -m http.server 8000
```

Open <http://localhost:8000/> in a modern browser. PyScript loads from its CDN, so the first run needs an internet connection. Serving the folder over localhost is required so the browser can fetch the dictionary file.

## Configure the dictionary

The filename is defined near the top of `game.py`:

```python
WORD_LIST_FILE = "Collins Scrabble Words (2019).txt"
```

Use another sibling `.txt` file with one word per line if desired.

Letter draws are weighted using `letter_frequency.json`, which is generated from the supplied dictionary. Change that JSON file to tune the letter probabilities.

For a temporary inverse-score trial, set `USE_SCORE_FREQUENCY = True` in `game.py`. This keeps the JSON loader intact but gives score-1 letters weight 10 and score-10 letters weight 1. Leave it `False` to use the current JSON frequency logic.

## Gameplay

1. The board starts with 4 spaces and grows by one space only when the built word uses the board's full current length, up to 15 spaces.
2. You start with 8 letter cards. Your hand can hold up to 12 cards.
3. Select cards from your hand. They are placed into the board's empty spaces from left to right.
4. Select exactly enough cards to fill every empty space. The completed board must be a valid dictionary word of at least 4 letters.
5. The complete word is scored using standard Scrabble tile values before smashing.
6. Select one or two occupied board letters and click **Hammer smash**. Each selected card counts as one smash, up to the hammer limit.
7. Smashed positions become empty. The surviving board letters remain in place.
8. Click **Next Round** to refill by `cards played this turn + (2 - letters smashed)`, without exceeding 12 cards, change back to build phase, and check for valid moves. Until then, the board remains in smash phase.

The round ends when no valid word can be made from the current hand and board pattern, or when the board reaches 15 spaces with no empty spaces remaining. Deal a new board to restart.

The MVP excludes blank tiles, board multipliers, modifiers, powerups, persistence, and multiplayer.
