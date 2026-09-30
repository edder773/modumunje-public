"""Small public-payload and SVG safety contract for the offline SKCT importer."""
import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/prepare-skct-personal-release.py"
SPEC = importlib.util.spec_from_file_location("skct_personal_importer", SCRIPT)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class ImporterSecurityTest(unittest.TestCase):
    def test_secret_key_is_not_public_even_when_nested(self):
        self.assertFalse(IMPORTER.public_safe({"judgmentItems": [{"text": "visible", "correctAnswer": 2}]}))
        self.assertFalse(IMPORTER.public_safe({"rawChoices": [{"text": "visible", "해설": "hidden"}]}))
        self.assertTrue(IMPORTER.public_safe({"displayChoices": ["visible"]}))

    def test_judgment_allowlist_discards_unexpected_keys(self):
        self.assertEqual(IMPORTER.judgments([{"label": "ㄱ", "text": "visible", "answer": "hidden"}]),
                         [{"label": "ㄱ", "text": "visible"}])

    def test_svg_rejects_external_references_and_event_handlers(self):
        prefix = '<svg xmlns="http://www.w3.org/2000/svg">'
        for body in ('<path fill="url(//example.invalid/x)"/>',
                     '<path onload="alert(1)"/>',
                     '<image href="https://example.invalid/x"/>'):
            with self.subTest(body=body), self.assertRaises(ValueError):
                IMPORTER.safe_svg((prefix + body + '</svg>').encode(), "U03_NEW_017_network.svg")

    def test_validation_remains_active_under_python_optimization(self):
        with self.assertRaises(ValueError):
            IMPORTER.require(False, "gate")


if __name__ == "__main__":
    unittest.main()
