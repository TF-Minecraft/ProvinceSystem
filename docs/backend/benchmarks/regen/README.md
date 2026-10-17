# Map regeneration benchmarks

Compare `fullregen` output and timings between labelled snapshots.

## Layout

Generated artifacts live under `backend/benchmarks/regen/` in the TFMCWeb checkout:

```
regen/
  snapshots/          # gitignored — full PNG trees per label
    {label}/
  timings/            # gitignored — JSON from _RegenTimings
    {label}.json
  manifests/          # gitignored — path → sha256 per snapshot
    {label}.json
```

## Commands

```bash
cd backend/src
export PYTHONIOENCODING=utf-8

# Snapshot only — use when output/{map}/ is already fresh
python -m scripts.benchmarks.snapshot_regen --map main --label <label>

# Compare two snapshots
python -m scripts.benchmarks.compare_regen_snapshot --map main --a <label-a> --b <label-b> --pixels

# Parallel fullregen (set worker count; REGEN_SERIAL_MODES=1 forces serial)
export REGEN_PARALLEL_MODES=4
python -m scripts.benchmarks.run_benchmark_regen --map main --label <label>
```

## What gets compared

- `output/main/maps/*.png`
- `output/main/regions/{mode}/*.png`
- Timing steps from [`regeneration.py`](../../../../backend/src/scripts/util/regeneration.py)

All outputs stay local.
