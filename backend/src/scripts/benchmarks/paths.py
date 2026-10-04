import os

from ..util.dirs import BASE_DIR, OUTPUT_DIR

BACKEND_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
BENCHMARK_ROOT = os.path.join(BACKEND_DIR, "benchmarks", "regen")
MANIFESTS_DIR = os.path.join(BENCHMARK_ROOT, "manifests")
TIMINGS_DIR = os.path.join(BENCHMARK_ROOT, "timings")
SNAPSHOTS_DIR = os.path.join(BENCHMARK_ROOT, "snapshots")


def output_subdirs(map_name: str) -> list[str]:
    return [
        os.path.join(OUTPUT_DIR, map_name, "maps"),
        os.path.join(OUTPUT_DIR, map_name, "regions"),
    ]


def manifest_path(label: str) -> str:
    return os.path.join(MANIFESTS_DIR, f"{label}.json")


def snapshot_dir(label: str) -> str:
    return os.path.join(SNAPSHOTS_DIR, label)
