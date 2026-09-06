#!/usr/bin/env python3
"""Deterministic elementary cellular automata and the Tiny Rule Atlas dataset.

Public simulation API:

* ``initial_state(seed, width=128)`` returns a tuple of 0/1 cells, left to right.
* ``evolve(rule, initial, steps=128, boundary='wrap')`` returns a list of those
  tuples, including generation zero. The width is inferred from ``initial``.
* ``generate_case(...)`` returns a JSON-serializable experiment record.

The implementation evolves packed integers; callers need not manipulate bits.
Records pack the leftmost cell into the most significant bit of the first byte.
For exploratory widths not divisible by eight, unused low bits in the last byte
are zero. The canonical dataset always uses 128 cells and 128 updates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
from typing import Iterable, Iterator, Sequence
import zlib

WIDTH = 128
STEPS = 128
SEEDS = (
    "single", "pair", "block", "alternating", "period3", "sparse", "balanced", "dense"
)
BOUNDARIES = ("fixed", "wrap")
_RULES = range(256)
_UINT32 = (1 << 32) - 1


class DatasetVerificationError(ValueError):
    """A dataset file is absent, unexpected, or differs from its experiment."""


def _positive_integer(value: int, name: str, *, allow_zero: bool = False) -> None:
    minimum = 0 if allow_zero else 1
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")


def _validate_rule(rule: int) -> None:
    if type(rule) is not int or not 0 <= rule <= 255:
        raise ValueError("rule must be an integer from 0 through 255")


def _validate_boundary(boundary: str) -> None:
    if boundary not in BOUNDARIES:
        raise ValueError(f"boundary must be one of {', '.join(BOUNDARIES)}")


def initial_state(seed: str, width: int = WIDTH) -> tuple[int, ...]:
    """Construct a named seed using only platform-independent integer arithmetic.

    The single cell is at ``width // 2``. Pair and block seeds are centered at
    that same point, with the block extending four cells left and three right;
    both are clipped for very narrow exploratory lattices.
    """
    _positive_integer(width, "width")
    if seed not in SEEDS:
        raise ValueError(f"seed must be one of {', '.join(SEEDS)}")
    center = width // 2
    if seed == "single":
        return tuple(int(x == center) for x in range(width))
    if seed == "pair":
        return tuple(int(center - 1 <= x <= center) for x in range(width))
    if seed == "block":
        return tuple(int(center - 4 <= x < center + 4) for x in range(width))
    if seed == "alternating":
        return tuple(int(x % 2 == 0) for x in range(width))
    if seed == "period3":
        return tuple(int(x % 3 == 0) for x in range(width))
    threshold = {"sparse": 32, "balanced": 128, "dense": 224}[seed]
    state = 0x00C0FFEE
    cells = []
    for _ in range(width):
        state = (state ^ (state << 13)) & _UINT32
        state = (state ^ (state >> 17)) & _UINT32
        state = (state ^ (state << 5)) & _UINT32
        cells.append(int((state & 0xFF) < threshold))
    return tuple(cells)


def _cells_to_int(cells: Iterable[int]) -> int:
    state = 0
    for cell in cells:
        state = (state << 1) | cell
    return state


def _int_to_cells(state: int, width: int) -> tuple[int, ...]:
    return tuple((state >> bit) & 1 for bit in range(width - 1, -1, -1))


def _evolve_packed(
    rule: int, initial: int, width: int, steps: int, boundary: str
) -> list[int]:
    mask = (1 << width) - 1
    neighborhoods = tuple(index for index in range(8) if (rule >> index) & 1)
    rows = [initial]
    seen = {initial: 0}
    periodic = boundary == "wrap"
    for generation in range(1, steps + 1):
        center = rows[-1]
        left = center >> 1
        right = (center << 1) & mask
        if periodic:
            left |= (center & 1) << (width - 1)
            right |= center >> (width - 1)
        dead_left = mask ^ left
        dead_center = mask ^ center
        dead_right = mask ^ right
        next_row = 0
        for neighborhood in neighborhoods:
            next_row |= (
                (left if neighborhood & 4 else dead_left)
                & (center if neighborhood & 2 else dead_center)
                & (right if neighborhood & 1 else dead_right)
            )
        rows.append(next_row)
        if next_row in seen:
            # Once a finite deterministic state repeats, the rest is exact.
            start = seen[next_row]
            period = generation - start
            rows.extend(
                rows[start + offset % period]
                for offset in range(1, steps - generation + 1)
            )
            break
        seen[next_row] = generation
    return rows


def evolve(
    rule: int,
    initial: Sequence[int],
    steps: int = STEPS,
    boundary: str = "wrap",
) -> list[tuple[int, ...]]:
    """Return generation zero and ``steps`` updates of a nonempty 0/1 row.

    Fixed boundaries supply zero neighbors outside the row; the actual edge
    cells update normally. Wrap boundaries use the opposite edge's cell.
    """
    _validate_rule(rule)
    _positive_integer(steps, "steps", allow_zero=True)
    _validate_boundary(boundary)
    cells = tuple(initial)
    if not cells or any(type(cell) not in (int, bool) or cell not in (0, 1) for cell in cells):
        raise ValueError("initial must be a nonempty sequence of 0/1 cells")
    packed = _evolve_packed(rule, _cells_to_int(cells), len(cells), steps, boundary)
    return [_int_to_cells(row, len(cells)) for row in packed]


def _find_cycle(rows: Sequence[int]) -> dict[str, int] | None:
    seen: dict[int, int] = {}
    for generation, row in enumerate(rows):
        if row in seen:
            return {
                "start": seen[row],
                "period": generation - seen[row],
                "detected_at": generation,
            }
        seen[row] = generation
    return None


def generate_case(
    rule: int,
    seed: str,
    boundary: str,
    width: int = WIDTH,
    steps: int = STEPS,
) -> dict:
    """Generate one complete record according to ``docs/data-contract.md``."""
    _validate_rule(rule)
    _positive_integer(width, "width")
    _positive_integer(steps, "steps", allow_zero=True)
    _validate_boundary(boundary)
    initial = _cells_to_int(initial_state(seed, width))
    rows = _evolve_packed(rule, initial, width, steps, boundary)
    perturbed = initial ^ (1 << (width - 1 - width // 2))
    paired = _evolve_packed(rule, perturbed, width, steps, boundary)
    byte_width = (width + 7) // 8
    padding = byte_width * 8 - width
    row_bytes = [(row << padding).to_bytes(byte_width, "big") for row in rows]
    packed = b"".join(row_bytes)
    density = sum(row.bit_count() for row in rows) / (width * len(rows))
    entropy = (
        -density * math.log2(density) - (1 - density) * math.log2(1 - density)
        if 0 < density < 1 else 0.0
    )
    damage = [(row ^ other).bit_count() for row, other in zip(rows, paired)]
    activity = (
        sum((before ^ after).bit_count() for before, after in zip(rows, rows[1:]))
        / (width * steps) if steps else 0.0
    )
    metrics = {
        "density": density,
        "final_density": rows[-1].bit_count() / width,
        "activity": activity,
        "entropy_bits": entropy,
        "compression_ratio": len(zlib.compress(packed, level=9)) / len(packed),
        "mean_damage": sum(damage) / (width * len(rows)),
        "final_damage": damage[-1] / width,
    }
    return {
        "schema_version": 1,
        "id": f"r{rule:03d}-{seed}-{boundary}",
        "rule": rule,
        "seed": seed,
        "boundary": boundary,
        "width": width,
        "steps": steps,
        "rows_hex": [row.hex() for row in row_bytes],
        "trajectory_sha256": hashlib.sha256(packed).hexdigest(),
        "metrics": {name: round(value, 8) for name, value in metrics.items()},
        "cycle": _find_cycle(rows),
    }


def iter_experiments() -> Iterator[dict]:
    """Yield the canonical grid in rule, seed, then boundary order."""
    for rule in _RULES:
        for seed in SEEDS:
            for boundary in BOUNDARIES:
                yield generate_case(rule, seed, boundary, width=WIDTH, steps=STEPS)


def experiment_path(record: dict) -> str:
    return f"data/experiments/r{record['rule']:03d}/{record['id']}.json"


def canonical_json(value: object) -> bytes:
    """The dataset's canonical UTF-8 JSON encoding, including its newline."""
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def _catalog_entry(record: dict) -> dict:
    keys = ("id", "rule", "seed", "boundary", "metrics", "cycle", "trajectory_sha256")
    return {**{key: record[key] for key in keys}, "path": experiment_path(record)}


def _catalog(entries: list[dict]) -> dict:
    return {
        "schema_version": 1,
        "width": WIDTH,
        "steps": STEPS,
        "count": len(entries),
        "seeds": list(SEEDS),
        "boundaries": list(BOUNDARIES),
        "experiments": entries,
    }


def _data_files(root: Path) -> set[str]:
    data = root / "data"
    if not data.exists():
        return set()
    return {
        path.relative_to(root).as_posix()
        for path in data.rglob("*")
        if path.is_file() or path.is_symlink()
    }


def _expected_paths() -> set[str]:
    return {"data/catalog.json", "data/provenance.json"} | {
        f"data/experiments/r{rule:03d}/r{rule:03d}-{seed}-{boundary}.json"
        for rule in _RULES for seed in SEEDS for boundary in BOUNDARIES
    }


def _check_coverage(root: Path, *, allow_missing: bool = False) -> set[str]:
    if (root / "data").is_symlink():
        raise DatasetVerificationError("dataset directory must not be a symbolic link: data")
    expected = _expected_paths()
    actual = _data_files(root)
    missing = expected - actual
    extra = actual - expected
    symlinks = {name for name in actual if (root / name).is_symlink()}
    problems = []
    if missing and not allow_missing:
        problems.append(f"{len(missing)} missing file(s), first: {min(missing)}")
    if extra:
        problems.append(f"{len(extra)} unexpected file(s), first: {min(extra)}")
    if symlinks:
        problems.append(f"dataset files must not be symbolic links: {min(symlinks)}")
    if problems:
        raise DatasetVerificationError("; ".join(problems))
    return expected


def runtime_provenance() -> dict:
    """Describe the generating runtime separately from deterministic records."""
    return {
        "schema_version": 1,
        "generator": "tiny-rule-atlas",
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "zlib_version": zlib.ZLIB_VERSION,
        "zlib_runtime_version": zlib.ZLIB_RUNTIME_VERSION,
    }


def _read_provenance(root: Path) -> dict:
    relative = "data/provenance.json"
    try:
        actual = (root / relative).read_bytes()
        record = json.loads(actual)
        required_strings = (
            "generator", "python_version", "python_implementation", "zlib_version", "zlib_runtime_version"
        )
        if (
            not isinstance(record, dict)
            or set(record) != {"schema_version", *required_strings}
            or type(record["schema_version"]) is not int
            or record["schema_version"] != 1
            or record["generator"] != "tiny-rule-atlas"
            or any(not isinstance(record[key], str) or not record[key] for key in required_strings)
            or actual != canonical_json(record)
        ):
            raise ValueError("wrong provenance schema or serialization")
        return record
    except (ValueError, TypeError, KeyError) as exc:
        raise DatasetVerificationError(f"invalid runtime provenance: {relative}") from exc


def _compression_only_difference(actual: bytes, expected: dict, *, catalog: bool = False) -> bool:
    """Distinguish runtime-sensitive compression drift without accepting it."""
    try:
        decoded = json.loads(actual)
        if actual != canonical_json(decoded):
            return False
        actual_entries = decoded["experiments"] if catalog else [decoded]
        expected_entries = expected["experiments"] if catalog else [expected]
        if len(actual_entries) != len(expected_entries):
            return False
        changed = False
        for existing, regenerated in zip(actual_entries, expected_entries):
            old = existing["metrics"]["compression_ratio"]
            new = regenerated["metrics"]["compression_ratio"]
            changed |= old != new
            existing["metrics"]["compression_ratio"] = new
        return changed and canonical_json(decoded) == canonical_json(expected)
    except (ValueError, TypeError, KeyError):
        return False


def verify_dataset(root: str | Path = ".") -> dict[str, int]:
    """Regenerate every case and compare exact JSON, hashes, catalog, and coverage.

    No files are written. Every file under ``data`` must belong to the canonical
    grid, its catalog, or its runtime provenance. Compression-only drift is
    reported distinctly and still fails. Failures raise
    ``DatasetVerificationError``.
    """
    root = Path(root)
    expected = _check_coverage(root)
    provenance = _read_provenance(root)

    def compression_error(relative: str) -> DatasetVerificationError:
        return DatasetVerificationError(
            f"compression-only drift: {relative}; exact verification failed "
            f"(recorded zlib runtime {provenance['zlib_runtime_version']}, "
            f"current {zlib.ZLIB_RUNTIME_VERSION})"
        )

    entries = []
    for record in iter_experiments():
        relative = experiment_path(record)
        actual = (root / relative).read_bytes()
        try:
            decoded = json.loads(actual)
            packed = b"".join(bytes.fromhex(row) for row in decoded["rows_hex"])
            claimed = decoded["trajectory_sha256"]
        except (ValueError, TypeError, KeyError) as exc:
            raise DatasetVerificationError(f"invalid experiment JSON: {relative}") from exc
        if hashlib.sha256(packed).hexdigest() != claimed:
            raise DatasetVerificationError(f"trajectory hash mismatch: {relative}")
        if actual != canonical_json(record):
            if _compression_only_difference(actual, record):
                raise compression_error(relative)
            raise DatasetVerificationError(f"experiment differs from regeneration: {relative}")
        entries.append(_catalog_entry(record))
    actual_catalog = (root / "data/catalog.json").read_bytes()
    expected_catalog = _catalog(entries)
    if actual_catalog != canonical_json(expected_catalog):
        if _compression_only_difference(actual_catalog, expected_catalog, catalog=True):
            raise compression_error("data/catalog.json")
        raise DatasetVerificationError("catalog differs from regenerated experiment catalog")
    return {"count": len(entries), "files": len(expected)}


def build_dataset(root: str | Path = ".", *, check: bool = False) -> dict[str, int]:
    """Write the canonical grid, or perform the same no-write check as ``verify``.

    Existing canonical files are replaced only if their contents differ. Extra
    files cause an error and are never removed. This keeps unrelated data safe.
    """
    if check:
        return verify_dataset(root)
    root = Path(root)
    expected = _check_coverage(root, allow_missing=True)
    entries = []
    written = 0

    def write_if_changed(relative: str, payload: bytes) -> None:
        nonlocal written
        destination = root / relative
        if destination.exists() and destination.read_bytes() == payload:
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        written += 1

    for record in iter_experiments():
        write_if_changed(experiment_path(record), canonical_json(record))
        entries.append(_catalog_entry(record))
    write_if_changed("data/catalog.json", canonical_json(_catalog(entries)))
    if written or not (root / "data/provenance.json").exists():
        write_if_changed("data/provenance.json", canonical_json(runtime_provenance()))
    else:
        _read_provenance(root)
    return {"count": len(entries), "files": len(expected), "written": written}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    inspect_parser = commands.add_parser("inspect", help="summarize one generated experiment")
    inspect_parser.add_argument("--rule", required=True, type=int, choices=range(256), metavar="0..255")
    inspect_parser.add_argument("--seed", default="single", choices=SEEDS)
    inspect_parser.add_argument("--boundary", default="wrap", choices=BOUNDARIES)
    verify_parser = commands.add_parser("verify", help="regenerate and verify the complete stored dataset")
    verify_parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            record = generate_case(args.rule, args.seed, args.boundary)
            summary = {key: value for key, value in record.items() if key != "rows_hex"}
            summary["row_count"] = len(record["rows_hex"])
            print(canonical_json(summary).decode("utf-8"), end="")
        else:
            result = verify_dataset(args.root)
            print(f"Verified {result['count']:,} experiments, catalog, and provenance ({result['files']:,} files).")
    except (DatasetVerificationError, OSError) as exc:
        parser.exit(1, f"Verification failed: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
