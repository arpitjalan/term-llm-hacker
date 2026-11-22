"""install.sh's step that writes local.json's appearance defaults into style.css."""
import contextlib
import importlib.util
import io
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("hacker_bake_defaults", ROOT / "tools/bake_defaults.py")
bake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bake)

CSS = (ROOT / "style.css").read_text(encoding="utf-8")
THEMES_JS = (ROOT / "themes.js").read_text(encoding="utf-8")
THEMES, DEFAULT_DARK, DEFAULT_LIGHT = bake.read_themes(THEMES_JS)


def generated(css):
    return css[css.index(bake.BEGIN):css.index(bake.END) + len(bake.END)]


def root_block(css):
    return re.search(r"^:root \{\n(.*?)\n\}", generated(css), re.S | re.M).group(1)


class BakeTests(unittest.TestCase):
    def test_no_defaults_leaves_the_shipped_stylesheet_byte_for_byte(self):
        # This is also the parity check with tools/gen-themes.mjs, which wrote
        # the shipped block: the same themes give the same text.
        for local in ({}, {"defaults": None}, {"nodeAccents": {"a": "blue"}}, [], None):
            css, summary, warnings = bake.bake(CSS, THEMES_JS, local)
            self.assertEqual(css, CSS)
            self.assertIsNone(summary)
            self.assertEqual(warnings, [])

    def test_dark_appearance_paints_only_the_dark_theme(self):
        css, summary, warnings = bake.bake(CSS, THEMES_JS, {"defaults": {"appearance": "dark", "darkTheme": "kanagawa"}})
        self.assertEqual(warnings, [])
        self.assertIn("Kanagawa (dark)", summary)
        block = root_block(css)
        kanagawa = next(t for t in THEMES if t["id"] == "kanagawa")
        self.assertIn("--vn-default-appearance: dark;", block)
        self.assertIn("--vn-default-dark: kanagawa;", block)
        self.assertIn(f"--vn-default-light: {DEFAULT_LIGHT};", block)
        self.assertIn("color-scheme: dark;", block)
        for key, value in kanagawa["colors"].items():
            self.assertIn(f"--om-{key.replace('_', '-')}: {value};", block)
        for role, ink in kanagawa["on"].items():
            self.assertIn(f"--om-on-{role}: {ink};", block)
        self.assertNotIn("prefers-color-scheme", generated(css))

    def test_light_appearance_paints_the_light_theme_on_any_system(self):
        css, _, _ = bake.bake(CSS, THEMES_JS, {"defaults": {"appearance": "light", "lightTheme": "rose-pine"}})
        block = root_block(css)
        self.assertIn("color-scheme: light;", block)
        rose = next(t for t in THEMES if t["id"] == "rose-pine")
        self.assertIn(f"--om-background: {rose['colors']['background']};", block)
        self.assertNotIn("prefers-color-scheme", generated(css))

    def test_system_appearance_keeps_both_modes(self):
        css, _, _ = bake.bake(CSS, THEMES_JS, {"defaults": {"darkTheme": "nord", "lightTheme": "flexoki-light"}})
        nord = next(t for t in THEMES if t["id"] == "nord")
        flexoki = next(t for t in THEMES if t["id"] == "flexoki-light")
        self.assertIn(f"--om-background: {nord['colors']['background']};", root_block(css))
        light = re.search(r":root:not\(\[data-vn-theme\]\) \{\n(.*?)\n  \}", generated(css), re.S).group(1)
        self.assertIn("color-scheme: light;", light)
        self.assertIn(f"--om-background: {flexoki['colors']['background']};", light)
        self.assertIn("--vn-default-appearance: system;", root_block(css))

    def test_text_size_and_corners_turn_every_rule(self):
        comfortable, compact = bake.TEXT_SIZE["comfortable"], bake.TEXT_SIZE["compact"]
        sharp, rounded = bake.CORNERS["sharp"], bake.CORNERS["rounded"]
        self.assertGreater(CSS.count(comfortable), 10)
        self.assertEqual(CSS.count(compact), 0)
        css, summary, _ = bake.bake(CSS, THEMES_JS, {"defaults": {"textSize": "compact", "corners": "rounded"}})
        self.assertEqual(css.count(comfortable), 0)
        self.assertEqual(css.count(compact), CSS.count(comfortable))
        self.assertEqual(css.count(sharp), 0)
        self.assertEqual(css.count(rounded), CSS.count(sharp))
        self.assertIn("--vn-default-text-size: compact;", root_block(css))
        self.assertIn("--vn-default-corners: rounded;", root_block(css))
        self.assertIn("compact text, rounded corners", summary)
        # Baking again, or back to nothing, starts from whatever is installed.
        self.assertEqual(bake.bake(css, THEMES_JS, {"defaults": {"textSize": "compact", "corners": "rounded"}})[0], css)
        self.assertEqual(bake.bake(css, THEMES_JS, {})[0], CSS)

    def test_bad_values_are_reported_and_left_at_the_shipped_default(self):
        css, _, warnings = bake.bake(CSS, THEMES_JS, {"defaults": {
            "appearance": "dim", "darkTheme": "catppuccin-latte", "lightTheme": 3, "textSize": "huge", "colour": "red"}})
        self.assertEqual(len(warnings), 5)
        self.assertTrue(any('"darkTheme"' in w and DEFAULT_DARK in w for w in warnings))
        self.assertTrue(any('unknown default "colour"' in w for w in warnings))
        block = root_block(css)
        self.assertIn("--vn-default-appearance: system;", block)
        self.assertIn(f"--vn-default-dark: {DEFAULT_DARK};", block)
        self.assertEqual(bake.bake(CSS, THEMES_JS, {"defaults": "dark"})[2], ['"defaults" should be an object; ignored'])

    def test_a_stylesheet_without_the_markers_is_an_error(self):
        with self.assertRaises(ValueError):
            bake.bake("body {}", THEMES_JS, {"defaults": {"appearance": "dark"}})


class MainTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="hacker-bake-"))
        self.addCleanup(shutil.rmtree, self.dir)
        for name in ("style.css", "themes.js"):
            shutil.copyfile(ROOT / name, self.dir / name)

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = bake.main(["bake_defaults.py", str(self.dir), *args])
        return code, out.getvalue(), err.getvalue()

    def test_writes_the_installed_copy_and_says_what_it_did(self):
        (self.dir / "local.json").write_text(json.dumps({"defaults": {"appearance": "dark", "darkTheme": "gruvbox"}}))
        code, out, err = self.run_main()
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Gruvbox (dark)", out)
        self.assertIn("--vn-default-dark: gruvbox;", (self.dir / "style.css").read_text())
        self.assertEqual(self.run_main("--quiet")[1], "")

    def test_no_local_json_or_a_broken_one_installs_the_shipped_look(self):
        self.assertEqual(self.run_main(), (0, "", ""))
        self.assertEqual((self.dir / "style.css").read_text(), CSS)
        (self.dir / "local.json").write_text("{ nope")
        code, out, err = self.run_main()
        self.assertEqual((code, out), (0, ""))
        self.assertIn("does not parse", err)
        self.assertEqual((self.dir / "style.css").read_text(), CSS)


if __name__ == "__main__":
    unittest.main()
