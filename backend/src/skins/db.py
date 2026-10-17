"""On-disk asset directories. Site records are stored by src.database."""
from pathlib import Path

_SKINS_PKG = Path(__file__).resolve().parent
DATA_DIR = _SKINS_PKG.parent / "data"
SKINS_DIR = DATA_DIR / "skins"
WARDROBE_DIR = DATA_DIR / "wardrobe"
DRINKS_DIR = DATA_DIR / "drinks"


def ensure_directories() -> None:
    """Prepare asset storage without opening a database."""
    for path in (DATA_DIR, SKINS_DIR, WARDROBE_DIR, DRINKS_DIR,
                 DRINKS_DIR / "textures", DRINKS_DIR / "submissions", DRINKS_DIR / "assets"):
        path.mkdir(parents=True, exist_ok=True)
