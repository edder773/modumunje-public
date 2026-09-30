"""Read back the private offline STAGED import against untouched source ZIPs."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import sqlite3
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("skct_personal_importer", ROOT / "scripts/prepare-skct-personal-release.py")
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


def check(sql_path, source_path, asset_path):
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript("CREATE TABLE app_schema_state(id integer PRIMARY KEY,migration_version text,applied_at text);")
    db.executescript((ROOT / "apps/backend/drizzle/0561_skct_personal_staged.sql").read_text())
    db.executescript(sql_path.read_text())
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    expected = {}
    archives = {}
    for batch, (filename, archive_sha) in IMPORTER.ARCHIVES.items():
        data = (source_path / filename).read_bytes()
        assert hashlib.sha256(data).hexdigest() == archive_sha
        archives[batch] = zipfile.ZipFile(source_path / filename)
    for unit in IMPORTER.UNITS:
        for batch in (("U01_REPLACEMENT",) if unit == "U01" else ("B01", "B02", "B03")):
            name = "new_language_60.json" if unit == "U01" else f"{unit}/unit.json"
            source_bytes = archives[batch].read(name)
            for raw in json.loads(source_bytes)["questions"]:
                expected[raw["id"]] = (batch, name, hashlib.sha256(source_bytes).hexdigest(), raw)
    public = db.execute("SELECT * FROM skct_personal_public_items ORDER BY unit_id,source_item_id").fetchall()
    secret = {row["source_item_id"]: row for row in db.execute("SELECT * FROM skct_personal_secret_items")}
    assert len(public) == len(secret) == len(expected) == 300
    counts = {unit: 0 for unit in IMPORTER.UNITS}
    assets = 0
    for row in public:
        item_id = row["source_item_id"]
        batch, name, source_sha, raw = expected[item_id]
        original_batch = item_id.split("_")[2] if row["unit_id"] == "U01" else batch
        assert row["source_batch"] == original_batch
        assert row["source_archive_sha256"] == IMPORTER.ARCHIVES[batch][1]
        assert row["source_file"] == name and row["source_file_sha256"] == source_sha
        p = json.loads(row["public_json"])
        s = secret[item_id]
        assert json.loads(s["source_raw_json"]) == raw
        assert s["answer_index"] == IMPORTER.answer_index(raw["answer"])
        assert p["displayChoices"] == [IMPORTER.choice_text(choice) for choice in raw["choices"]]
        assert p["choiceHasSourceLabel"] == [isinstance(choice, dict) for choice in raw["choices"]]
        assert IMPORTER.public_safe(p) and "rawChoices" not in p
        assert hashlib.sha256(row["public_json"].encode()).hexdigest() == row["public_sha256"]
        assert len(p["assetUrls"]) == len(p["assetDescriptions"])
        for url, description in zip(p["assetUrls"], p["assetDescriptions"]):
            assert url.startswith("/skct-personal/") and len(description) >= 30
            parts = pathlib.PurePosixPath(url).parts
            assert len(parts) == 5
            static = asset_path / parts[2] / parts[3] / parts[4]
            assert static.read_bytes() == archives[batch].read(f"{row['unit_id']}/assets/{parts[4]}")
            assets += 1
        counts[row["unit_id"]] += 1
    assert counts == {unit: 60 for unit in IMPORTER.UNITS} and assets == 20
    release = db.execute("SELECT status,item_count,content_sha256 FROM skct_personal_releases").fetchone()
    assert release["status"] == "STAGED" and release["item_count"] == 300
    assert re.fullmatch(r"[0-9a-f]{64}", release["content_sha256"])
    print(json.dumps({"status": "PASS", "questions": len(public), "units": counts, "assets": assets,
                      "contentSha256": release["content_sha256"]}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sql", type=pathlib.Path, required=True)
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--public-assets", type=pathlib.Path, required=True)
    args = parser.parse_args()
    check(args.sql, args.source, args.public_assets)
