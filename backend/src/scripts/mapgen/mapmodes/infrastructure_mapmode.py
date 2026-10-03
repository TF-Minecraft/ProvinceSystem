import argparse
import sys

from ...mapgen.infrastructuregen import create_infrastructure_map
from ...util.dirs import validate_map


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Generate infrastructure overlay map PNG")
    parser.add_argument("--map", default="dev", help="Map id (e.g. main, dev)")
    args = parser.parse_args()

    validate_map(args.map)
    create_infrastructure_map(args.map, filename="infrastructure_map")


if __name__ == "__main__":
    main()
