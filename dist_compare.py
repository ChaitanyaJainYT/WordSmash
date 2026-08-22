# import json

# LETTER_DISTRIBUTION = {
#     "a": 9, "b": 2, "c": 2, "d": 4, "e": 12, "f": 2, "g": 3,
#     "h": 2, "i": 9, "j": 1, "k": 1, "l": 4, "m": 2, "n": 6,
#     "o": 8, "p": 2, "q": 1, "r": 6, "s": 4, "t": 6, "u": 4,
#     "v": 2, "w": 2, "x": 1, "y": 2, "z": 1,
# }

# new_letter_distrubution = {}
# # for letter, frequency in LETTER_DISTRIBUTION.items():
# #     LETTER_DISTRIBUTION[letter] = (frequency * 100) / 98 # Convert to percentage

# json_letter_frequencies = {}

# with open("letter_frequency.json", "r") as f:
#     json_letter = json.load(f)
#     for letter, frequency in json_letter["letters"].items():
#         if letter in LETTER_DISTRIBUTION:
#             json_letter_frequencies[letter] = frequency["percentage"]

# for letter in LETTER_DISTRIBUTION.keys():
#     avg = ((LETTER_DISTRIBUTION[letter] * 100) / 98 + json_letter_frequencies.get(letter, 0))/2
#     avg_rnd = round(avg)
#     print(f"{letter},\t {(LETTER_DISTRIBUTION[letter] * 100) / 98},\t {json_letter_frequencies.get(letter, 0)}, \t {avg},\t {avg_rnd},\t {avg_rnd - LETTER_DISTRIBUTION[letter]}")

#     new_letter_distrubution[letter] = avg_rnd

# print(new_letter_distrubution)

new_letter_distrubution_updated = {
    'a': 8, 'b': 2, 'c': 3, 'd': 4, 'e': 12, 'f': 2, 'g': 3,
    'h': 2, 'i': 9, 'j': 1, 'k': 1, 'l': 5, 'm': 2, 'n': 6,
    'o': 7, 'p': 2, 'q': 1, 'r':7, 's': 7, 't': 6, 'u': 4,
    'v': 1, 'w': 1, 'x': 1, 'y': 2, 'z': 1
}

total = sum(new_letter_distrubution_updated.values())
print(f"Total: {total}")