import argparse
import json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "data" / "indexes" / "research.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update a research index entry date to today or a supplied ISO date."
    )
    parser.add_argument(
        "--path",
        required=True,
        help="Research entry path to match, for example ../Research/human-dignity.html",
    )
    parser.add_argument(
        "--date",
        help="ISO date to write, defaulting to today's local date in YYYY-MM-DD format.",
    )
    return parser.parse_args()


def resolve_date(value: str | None) -> str:
    if value:
        datetime.strptime(value, "%Y-%m-%d")
        return value
    return date.today().isoformat()


def main() -> None:
    args = parse_args()
    target_date = resolve_date(args.date)

    payload = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    updated = False

    for item in payload.get("items", []):
        if item.get("path") == args.path:
            item["date"] = target_date
            updated = True
            break

    if not updated:
        raise SystemExit(f"No research entry matched path: {args.path}")

    INDEX_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
