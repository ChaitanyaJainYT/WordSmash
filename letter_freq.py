import json
from collections import Counter
from pathlib import Path
from string import ascii_lowercase


WORD_LIST_FILE = Path(__file__).with_name("Collins Scrabble Words (2019).txt")
OUTPUT_FILE = Path(__file__).with_name("letter_frequency.json")


def count_letter_frequency(file_path: Path) -> dict:
	counts = Counter()

	with file_path.open(encoding="utf-8") as word_file:
		for character in word_file.read().lower():
			if character in ascii_lowercase:
				counts[character] += 1

	total_letters = sum(counts.values())
	letters = {
		letter: {
			"count": counts[letter],
			"percentage": round((counts[letter] / total_letters) * 100, 4)
			if total_letters
			else 0,
		}
		for letter in ascii_lowercase
	}

	return {
		"source_file": file_path.name,
		"total_letters": total_letters,
		"letters": letters,
	}


def main() -> None:
	frequency_data = count_letter_frequency(WORD_LIST_FILE)

	with OUTPUT_FILE.open("w", encoding="utf-8") as json_file:
		json.dump(frequency_data, json_file, indent=2)
		json_file.write("\n")

	print(f"Counted {frequency_data['total_letters']:,} letters.")
	for letter, data in frequency_data["letters"].items():
		print(f"{letter.upper()}: {data['count']:,} ({data['percentage']:.4f}%)")
	print(f"JSON written to {OUTPUT_FILE.name}")


if __name__ == "__main__":
	main()
