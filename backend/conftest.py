"""Give test fixtures one database module across both supported import paths."""
from pathlib import Path
import sys

backend = Path(__file__).resolve().parent
sys.path.insert(0, str(backend))
sys.path.insert(0, str(backend / "src"))

import src.skins as skins
from src.skins import db

# Fixtures replace db paths with temporary directories. All imported connect
# functions must retain that same module's globals throughout test collection.
sys.modules["skins"] = skins
sys.modules["skins.db"] = db
