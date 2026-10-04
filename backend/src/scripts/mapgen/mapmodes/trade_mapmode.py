import argparse
import sys

from ...mapgen.mapgen import create_map
from ...mapgen.regiongen import generate_regions
from ...util.dirs import validate_map


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Generate trade pick/overlay map PNG + regions")
    parser.add_argument("--map", default="dev", help="Map id (e.g. main, dev)")
    args = parser.parse_args()

    validate_map(args.map)
    create_map(args.map, "trade", "trade_map")
    generate_regions(args.map, "trade", borders=False)


if __name__ == "__main__":
    main()
