"""Independent behavior checks for the packed engine and dataset verifier."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zlib

import atlas


def scalar_evolve(rule, initial, steps, boundary):
    """Deliberately scalar reference; no production bit helpers are shared."""
    rows = [tuple(initial)]
    width = len(initial)
    for _ in range(steps):
        old = rows[-1]
        new = []
        for x in range(width):
            left = old[x - 1] if x > 0 else old[-1] if boundary == "wrap" else 0
            right = old[x + 1] if x + 1 < width else old[0] if boundary == "wrap" else 0
            neighborhood = 4 * left + 2 * old[x] + right
            new.append((rule >> neighborhood) & 1)
        rows.append(tuple(new))
    return rows


class EngineTests(unittest.TestCase):
    def test_packed_engine_matches_scalar_for_all_rules_and_boundaries(self):
        # All rule tables, an asymmetric row, both edges, and cycle completion.
        for width in (1, 2, 7, 16):
            initial = tuple(int(x % 5 in (0, 3)) for x in range(width))
            for rule in range(256):
                for boundary in atlas.BOUNDARIES:
                    with self.subTest(width=width, rule=rule, boundary=boundary):
                        self.assertEqual(
                            atlas.evolve(rule, initial, steps=19, boundary=boundary),
                            scalar_evolve(rule, initial, 19, boundary),
                        )

    def test_each_neighborhood_bit_uses_wolfram_order(self):
        for neighborhood in range(8):
            initial = ((neighborhood >> 2) & 1, (neighborhood >> 1) & 1, neighborhood & 1)
            for rule in range(256):
                with self.subTest(rule=rule, neighborhood=neighborhood):
                    self.assertEqual(
                        atlas.evolve(rule, initial, steps=1, boundary="fixed")[1][1],
                        (rule >> neighborhood) & 1,
                    )

    def test_fixed_and_wrap_boundary_edges(self):
        initial = (1, 0, 0, 0, 0, 0, 0, 0)
        self.assertEqual(atlas.evolve(90, initial, 1, "fixed")[1], (0, 1, 0, 0, 0, 0, 0, 0))
        self.assertEqual(atlas.evolve(90, initial, 1, "wrap")[1], (0, 1, 0, 0, 0, 0, 0, 1))
        # Fixed supplies zero outside; it does not pin the real edge cells.
        self.assertEqual(atlas.evolve(255, (0,) * 8, 1, "fixed")[1], (1,) * 8)

    def test_known_rules(self):
        initial = (0, 0, 0, 0, 1, 0, 0, 0, 0)
        for boundary in atlas.BOUNDARIES:
            self.assertEqual(atlas.evolve(0, initial, 3, boundary)[1:], [(0,) * 9] * 3)
            self.assertEqual(atlas.evolve(255, initial, 3, boundary)[1:], [(1,) * 9] * 3)
            self.assertEqual(atlas.evolve(204, initial, 3, boundary), [initial] * 4)
        rule90 = ["000010000", "000101000", "001000100", "010101010"]
        rule30 = ["000010000", "000111000", "001100100", "011011110"]
        for rule, expected in ((90, rule90), (30, rule30)):
            actual = atlas.evolve(rule, initial, 3, "fixed")
            self.assertEqual(["".join(map(str, row)) for row in actual], expected)

    def test_named_seed_positions(self):
        expected = {"single": [64], "pair": [63, 64], "block": list(range(60, 68))}
        for seed, positions in expected.items():
            self.assertEqual([x for x, live in enumerate(atlas.initial_state(seed)) if live], positions)
        self.assertEqual(atlas.initial_state("alternating", 8), (1, 0, 1, 0, 1, 0, 1, 0))
        self.assertEqual(atlas.initial_state("period3", 8), (1, 0, 0, 1, 0, 0, 1, 0))

    def test_random_seeds_are_reproducible_and_nested(self):
        # First eight xorshift32 states, independently recorded as hex constants.
        states = (0xF89B3E70, 0x75FB4A9A, 0x89A89D0E, 0xDB2B114A,
                  0x9943B4AB, 0x1502CB40, 0xC13743D5, 0x00F31913)
        for seed, threshold in (("sparse", 32), ("balanced", 128), ("dense", 224)):
            expected = tuple(int((state & 255) < threshold) for state in states)
            self.assertEqual(atlas.initial_state(seed, 8), expected)
            self.assertEqual(atlas.initial_state(seed), atlas.initial_state(seed))
            self.assertEqual(atlas.initial_state(seed, 256)[:128], atlas.initial_state(seed))
        sparse, balanced, dense = (atlas.initial_state(seed) for seed in ("sparse", "balanced", "dense"))
        self.assertTrue(all(a <= b <= c for a, b, c in zip(sparse, balanced, dense)))
        self.assertLess(sum(sparse), sum(balanced))
        self.assertLess(sum(balanced), sum(dense))

    def test_rows_are_most_significant_bit_first(self):
        record = atlas.generate_case(204, "single", "fixed")
        self.assertEqual(record["rows_hex"][0], "00000000000000008000000000000000")
        self.assertTrue(all(len(row) == 32 and row == row.lower() for row in record["rows_hex"]))
        self.assertEqual(len(record["rows_hex"]), 129)
        alternating = atlas.generate_case(204, "alternating", "wrap", width=8, steps=0)
        self.assertEqual(alternating["rows_hex"], ["aa"])
        padded = atlas.generate_case(204, "single", "wrap", width=5, steps=0)
        self.assertEqual(padded["rows_hex"], ["20"])

    def test_exact_cycle_detection(self):
        self.assertEqual(atlas.generate_case(204, "single", "wrap")["cycle"],
                         {"start": 0, "period": 1, "detected_at": 1})
        self.assertEqual(atlas.generate_case(0, "single", "fixed")["cycle"],
                         {"start": 1, "period": 1, "detected_at": 2})
        self.assertEqual(atlas.generate_case(51, "single", "wrap")["cycle"],
                         {"start": 0, "period": 2, "detected_at": 2})
        self.assertIsNone(atlas.generate_case(30, "single", "fixed", steps=3)["cycle"])
        self.assertIsNone(atlas.generate_case(204, "single", "wrap", steps=0)["cycle"])

    def test_sensitivity_includes_initial_perturbation(self):
        identity = atlas.generate_case(204, "single", "wrap")
        self.assertEqual(identity["metrics"]["mean_damage"], 1 / 128)
        self.assertEqual(identity["metrics"]["final_damage"], 1 / 128)
        zero = atlas.generate_case(0, "single", "fixed")
        self.assertEqual(zero["metrics"]["mean_damage"], round(1 / (128 * 129), 8))
        self.assertEqual(zero["metrics"]["final_damage"], 0)
        # Verify general damage against two separate scalar simulations.
        initial = atlas.initial_state("balanced", 16)
        perturbed = list(initial)
        perturbed[8] ^= 1
        first = scalar_evolve(30, initial, 21, "fixed")
        second = scalar_evolve(30, perturbed, 21, "fixed")
        damage = [sum(x != y for x, y in zip(a, b)) for a, b in zip(first, second)]
        record = atlas.generate_case(30, "balanced", "fixed", width=16, steps=21)
        self.assertEqual(record["metrics"]["mean_damage"], round(sum(damage) / (16 * 22), 8))
        self.assertEqual(record["metrics"]["final_damage"], damage[-1] / 16)

    def test_hash_and_metrics_match_independent_scalar_rows(self):
        rows = scalar_evolve(30, atlas.initial_state("single", 16), 24, "wrap")
        packed = b"".join(int("".join(map(str, row)), 2).to_bytes(2, "big") for row in rows)
        record = atlas.generate_case(30, "single", "wrap", width=16, steps=24)
        self.assertEqual(record["trajectory_sha256"], hashlib.sha256(packed).hexdigest())
        self.assertEqual(record["metrics"]["density"], round(sum(map(sum, rows)) / 400, 8))
        changes = sum(x != y for a, b in zip(rows, rows[1:]) for x, y in zip(a, b))
        self.assertEqual(record["metrics"]["activity"], round(changes / 384, 8))
        self.assertEqual(record["metrics"]["compression_ratio"], round(len(zlib.compress(packed, 9)) / len(packed), 8))
        empty = atlas.generate_case(0, "single", "fixed", width=8, steps=0)
        self.assertEqual(empty["metrics"]["activity"], 0)

    def test_invalid_inputs_fail_clearly(self):
        for rule in (-1, 256, 1.5, True):
            with self.assertRaises(ValueError):
                atlas.evolve(rule, (1,))
        for initial in ((), (0, 2), ("1",), (0.0,)):
            with self.assertRaises(ValueError):
                atlas.evolve(30, initial)
        for width in (0, -1, 1.5, True):
            with self.assertRaises(ValueError):
                atlas.initial_state("single", width)
        with self.assertRaises(ValueError):
            atlas.initial_state("unknown")
        with self.assertRaises(ValueError):
            atlas.evolve(30, (1,), -1)
        with self.assertRaises(ValueError):
            atlas.evolve(30, (1,), boundary="mirror")


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # The verifier follows the real generator and coverage paths; shrink
        # only the grid for targeted corruption tests, not the logic under test.
        for target, value in (("_RULES", (0, 30)), ("SEEDS", ("single",)),
                              ("WIDTH", 16), ("STEPS", 12)):
            patcher = patch.object(atlas, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        atlas.build_dataset(self.root)
        self.case = self.root / "data/experiments/r030/r030-single-wrap.json"

    def test_build_and_check_are_deterministic_and_check_does_not_write(self):
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (self.root / "data").rglob("*.json")}
        self.assertEqual(atlas.build_dataset(self.root)["written"], 0)
        self.assertEqual(atlas.build_dataset(self.root, check=True), {"count": 4, "files": 6})
        after = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}
        self.assertEqual(before, after)
        catalog = json.loads((self.root / "data/catalog.json").read_text())
        self.assertEqual([entry["id"] for entry in catalog["experiments"]],
                         ["r000-single-fixed", "r000-single-wrap", "r030-single-fixed", "r030-single-wrap"])

    def test_trajectory_tampering_is_detected(self):
        record = json.loads(self.case.read_text())
        record["rows_hex"][0] = "0000"
        self.case.write_bytes(atlas.canonical_json(record))
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "hash mismatch"):
            atlas.verify_dataset(self.root)

    def test_rehashed_tampering_is_detected_by_regeneration(self):
        record = json.loads(self.case.read_text())
        record["rows_hex"][0] = "0000"
        record["trajectory_sha256"] = hashlib.sha256(bytes.fromhex("".join(record["rows_hex"]))).hexdigest()
        self.case.write_bytes(atlas.canonical_json(record))
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "differs from regeneration"):
            atlas.verify_dataset(self.root)

    def test_metric_tampering_is_detected(self):
        record = json.loads(self.case.read_text())
        record["metrics"]["density"] = 42
        self.case.write_bytes(atlas.canonical_json(record))
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "differs from regeneration"):
            atlas.verify_dataset(self.root)

    def test_compression_only_drift_is_distinct_but_still_fails(self):
        saved = self.case.read_bytes()
        record = json.loads(saved)
        record["metrics"]["compression_ratio"] += 0.01
        self.case.write_bytes(atlas.canonical_json(record))
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "compression-only drift"):
            atlas.verify_dataset(self.root)
        self.case.write_bytes(saved)
        catalog_file = self.root / "data/catalog.json"
        catalog = json.loads(catalog_file.read_text())
        catalog["experiments"][0]["metrics"]["compression_ratio"] += 0.01
        catalog_file.write_bytes(atlas.canonical_json(catalog))
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "compression-only drift.*catalog"):
            atlas.verify_dataset(self.root)

    def test_provenance_updates_only_when_corpus_changes_or_it_is_missing(self):
        provenance_file = self.root / "data/provenance.json"
        provenance = atlas.runtime_provenance()
        provenance["python_version"] = "0.0.0"
        provenance_file.write_bytes(atlas.canonical_json(provenance))
        self.assertEqual(atlas.build_dataset(self.root)["written"], 0)
        self.assertEqual(json.loads(provenance_file.read_text()), provenance)
        self.case.write_text("{}")
        self.assertEqual(atlas.build_dataset(self.root)["written"], 2)
        self.assertEqual(json.loads(provenance_file.read_text()), atlas.runtime_provenance())
        provenance_file.unlink()
        self.assertEqual(atlas.build_dataset(self.root)["written"], 1)
        self.assertEqual(json.loads(provenance_file.read_text()), atlas.runtime_provenance())

    def test_invalid_provenance_is_detected(self):
        provenance_file = self.root / "data/provenance.json"
        provenance_file.write_text("{}")
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "invalid runtime provenance"):
            atlas.verify_dataset(self.root)

    def test_catalog_tampering_is_detected(self):
        catalog_file = self.root / "data/catalog.json"
        catalog = json.loads(catalog_file.read_text())
        catalog["experiments"].reverse()
        catalog_file.write_bytes(atlas.canonical_json(catalog))
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "catalog differs"):
            atlas.verify_dataset(self.root)

    def test_missing_extra_and_noncanonical_files_are_detected(self):
        saved = self.case.read_bytes()
        self.case.unlink()
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "missing file"):
            atlas.verify_dataset(self.root)
        self.case.write_bytes(saved)
        extra = self.root / "data/unexpected.txt"
        extra.write_text("preserve me")
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "unexpected file"):
            atlas.verify_dataset(self.root)
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "unexpected file"):
            atlas.build_dataset(self.root)
        self.assertEqual(extra.read_text(), "preserve me")
        extra.unlink()
        self.case.write_bytes(saved.rstrip())
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "differs from regeneration"):
            atlas.verify_dataset(self.root)

    def test_invalid_json_and_symbolic_links_are_detected(self):
        saved = self.case.read_bytes()
        self.case.write_text("[]")
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "invalid experiment JSON"):
            atlas.verify_dataset(self.root)
        other = self.root / "outside.json"
        other.write_bytes(saved)
        self.case.unlink()
        self.case.symlink_to(other)
        with self.assertRaisesRegex(atlas.DatasetVerificationError, "symbolic links"):
            atlas.verify_dataset(self.root)


if __name__ == "__main__":
    unittest.main()
