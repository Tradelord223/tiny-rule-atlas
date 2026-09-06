#!/usr/bin/env python3
"""Build Tiny Rule Atlas's canonical dataset, or verify it with --check."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from atlas import DatasetVerificationError, build_dataset  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify without writing any files")
    parser.add_argument("--root", type=Path, default=REPOSITORY_ROOT, help="repository root to build or check")
    args = parser.parse_args()
    try:
        result = build_dataset(args.root, check=args.check)
    except (DatasetVerificationError, OSError) as exc:
        parser.exit(1, f"Dataset {'verification' if args.check else 'build'} failed: {exc}\n")
    if args.check:
        print(f"Verified {result['count']:,} experiments, catalog, and provenance ({result['files']:,} files).")
    else:
        print(
            f"Built {result['count']:,} experiments, catalog, and provenance "
            f"({result['written']:,} files written; {result['files']:,} total)."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
