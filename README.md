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

Letter draws use a fixed 98-tile distribution based on standard Scrabble letter counts. Common letters appear more often, while high-value letters such as J, X, Q, and Z appear less often but remain possible.

## Gameplay

1. The board starts with 4 spaces and grows by one space only when the built word uses the board's full current length, up to 15 spaces.
2. You start with 8 letter cards. Your hand can hold up to 8 cards before upgrades.
3. Select cards from your hand. They are placed into the board's empty spaces from left to right.
4. Select exactly enough cards to fill every empty space. The completed board must be a valid dictionary word of at least 4 letters.
5. The complete word is scored using standard Scrabble tile values before smashing.
6. Select one or two occupied board letters and click **Hammer smash**. Each selected card counts as one smash, up to the hammer limit.
7. Smashed positions become empty. The surviving board letters remain in place.
8. Click **Next Round** to refill by `cards played this turn + (2 - letters smashed)`, without exceeding 16 cards, change back to build phase, and check for valid moves. Until then, the board remains in smash phase.

## Powerup shop

Spend scored points on power-ups at any time during an active round. Each item costs 10 points at first, increases by 10 after every purchase, and resets when a new board is dealt.

- **Extra hammer** increases the hammer capacity by 1 immediately and for future turns.
- **Extra hand space** increases the hand limit by 4 for the current run.
- **Replace hand tiles** lets you select 1 to 4 hand tiles and replace them with random letters in the same positions.
- **Move board tile** lets you select any position, including an empty one, in the shop's board copy, shift it left or right with the arrow buttons, and pay to apply the move; intervening positions slide.
- **Hint** shows one word that can be built from the current board and hand. It follows the board's letter positions and maximum length.

Shop purchases subtract from the existing score. The shop is unavailable after game over. Dealing a new board resets the score, upgrades, purchase counts, and item prices.

The round ends when no valid word can be made from the current hand and board pattern, or when the board reaches 15 spaces with no empty spaces remaining. Deal a new board to restart.

The MVP excludes blank tiles, board multipliers, persistence, and multiplayer.
