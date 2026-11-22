#!/usr/bin/env python3
"""Write local.json's appearance "defaults" into an installed style.css.

    python3 -I tools/bake_defaults.py <installed-hacker-dir> [--quiet]

install.sh runs this after copying Hacker. term-llm runs Hacker's script only
once the app has started (a second or more after the first paint on a distant
server), so until then the page shows the stylesheet's own defaults: Tokyo
Night, or Catppuccin Latte on a light system, sharp corners and comfortable
text. Writing your usual look in as those defaults makes the first paint
yours, instead of switching to it when the script runs.

local.json (all keys optional):

    "defaults": {
      "appearance": "system" | "light" | "dark",
      "darkTheme": "<a dark theme's id>",
      "lightTheme": "<a light theme's id>",
      "textSize": "compact" | "comfortable",
      "corners": "sharp" | "rounded"
    }

A browser's own choices (the Appearance panel, the palette) still win once
the script runs; these are what a browser starts with. main.js reads them
back from the --vn-default-* properties this writes. Standard library only;
the palettes come from themes.js, whose lines are JSON (tools/gen-themes.mjs),
with their inks precomputed, so no colour maths runs here.
"""

import json
import re
import sys
from pathlib import Path

BEGIN = "/* BEGIN GENERATED OMARCHY PALETTES (tools/gen-themes.mjs) */"
END = "/* END GENERATED OMARCHY PALETTES */"
APPEARANCES = ("system", "light", "dark")
# The attribute rules for text size and corners, written so that a missing
# attribute (the page before main.js runs) means the default.
TEXT_SIZE = {
    "comfortable": ':root:not([data-vn-type="compact"])',
    "compact": ':root[data-vn-type="comfortable"]',
}
CORNERS = {
    "sharp": ':root[data-vn-corners="rounded"]',
    "rounded": ':root:not([data-vn-corners="sharp"])',
}


def read_themes(js):
    """(themes, default dark id, default light id) from themes.js."""
    defaults = dict(re.findall(r'export const (DEFAULT_DARK|DEFAULT_LIGHT) = "([a-z0-9-]+)";', js))
    themes = [json.loads(line) for line in re.findall(r"^ {2}(\{.*\}),$", js, re.M)]
    return themes, defaults["DEFAULT_DARK"], defaults["DEFAULT_LIGHT"]


def palette_lines(theme):
    """The theme's declarations, as tools/gen-themes.mjs writes them."""
    lines = [f"color-scheme: {theme['mode']};"]
    lines += [f"--om-{key.replace('_', '-')}: {value};" for key, value in theme["colors"].items()]
    lines += [f"--om-on-{role}: {ink};" for role, ink in theme["on"].items()]
    return lines


def block(selector, lines, indent):
    body = "\n".join(f"{indent}  {line}" for line in lines)
    return f"{indent}{selector} {{\n{body}\n{indent}}}"


def resolve(raw, themes, default_dark, default_light):
    """Valid defaults (shipped values where local.json has none) and warnings."""
    by_id = {t["id"]: t for t in themes}
    warnings = []
    chosen = {"appearance": "system", "darkTheme": default_dark, "lightTheme": default_light,
              "textSize": "comfortable", "corners": "sharp"}
    if raw is None:
        return None, warnings
    if not isinstance(raw, dict):
        return None, ['"defaults" should be an object; ignored']
    valid = {
        "appearance": lambda v: v in APPEARANCES,
        "darkTheme": lambda v: by_id.get(v, {}).get("mode") == "dark",
        "lightTheme": lambda v: by_id.get(v, {}).get("mode") == "light",
        "textSize": lambda v: v in TEXT_SIZE,
        "corners": lambda v: v in CORNERS,
    }
    for key, value in raw.items():
        if key not in valid:
            warnings.append(f'unknown default "{key}"; ignored')
        elif not isinstance(value, str) or not valid[key](value):
            warnings.append(f'"{key}": {json.dumps(value)} is not a valid choice; using {chosen[key]}')
        else:
            chosen[key] = value
    return chosen, warnings


def palette_block(themes, dark_id, light_id, defaults=None):
    """The generated block: the shipped one when defaults is None."""
    by_id = {t["id"]: t for t in themes}
    dark, light = by_id[dark_id], by_id[light_id]
    appearance = defaults["appearance"] if defaults else "system"
    if defaults is None:
        comment = [
            f"/* Before main.js applies the saved theme: {dark['name']}, or {light['name']} on a",
            " * light system, so nobody sees the wrong scheme flash. main.js then sets the",
            " * same properties inline for whichever theme is chosen. install.sh rewrites",
            ' * this block when local.json sets "defaults" (tools/bake_defaults.py). */',
        ]
        own = []
    else:
        shown = {"system": f"{dark['name']}, or {light['name']} on a light system",
                 "dark": dark["name"], "light": light["name"]}[appearance]
        comment = [
            "/* local.json's defaults, written by install.sh (tools/bake_defaults.py).",
            f" * Before main.js applies the saved theme: {shown}.",
            " * main.js takes the --vn-default-* properties as its own defaults. */",
        ]
        own = [
            f"--vn-default-appearance: {appearance};",
            f"--vn-default-dark: {dark['id']};",
            f"--vn-default-light: {light['id']};",
            f"--vn-default-text-size: {defaults['textSize']};",
            f"--vn-default-corners: {defaults['corners']};",
        ]
    first = light if appearance == "light" else dark
    parts = [BEGIN, *comment, block(":root", own + palette_lines(first), "")]
    if appearance == "system":
        parts += ["", "@media (prefers-color-scheme: light) {",
                  block(":root:not([data-vn-theme])", palette_lines(light), "  "), "}"]
    return "\n".join(parts + [END])


def bake(css, themes_js, local):
    """(new css, summary or None, warnings) for a local.json object."""
    themes, default_dark, default_light = read_themes(themes_js)
    raw = local.get("defaults") if isinstance(local, dict) else None
    defaults, warnings = resolve(raw, themes, default_dark, default_light)
    start, stop = css.find(BEGIN), css.find(END)
    if start < 0 or stop < start:
        raise ValueError("style.css lacks the generated palette markers")
    if defaults is None:
        new_block = palette_block(themes, default_dark, default_light)
        size, corners = "comfortable", "sharp"
    else:
        new_block = palette_block(themes, defaults["darkTheme"], defaults["lightTheme"], defaults)
        size, corners = defaults["textSize"], defaults["corners"]
    css = css[:start] + new_block + css[stop + len(END):]
    # Point every text-size and corner rule at the chosen default.
    for table, want in ((TEXT_SIZE, size), (CORNERS, corners)):
        for name, selector in table.items():
            if name != want:
                css = css.replace(selector, table[want])
    if defaults is None:
        return css, None, warnings
    names = {t["id"]: t["name"] for t in themes}
    summary = ", ".join([
        defaults["appearance"].capitalize(),
        f"{names[defaults['darkTheme']]} (dark)",
        f"{names[defaults['lightTheme']]} (light)",
        f"{defaults['textSize']} text",
        f"{defaults['corners']} corners",
    ])
    return css, summary, warnings


def main(argv):
    args = [a for a in argv[1:] if a != "--quiet"]
    if len(args) != 1:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    root = Path(args[0])
    try:
        local = json.loads((root / "local.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        local = {}
    except ValueError as error:
        print(f"local.json does not parse ({error}); its defaults were skipped.", file=sys.stderr)
        local = {}
    style = root / "style.css"
    css, summary, warnings = bake(style.read_text(encoding="utf-8"),
                                  (root / "themes.js").read_text(encoding="utf-8"), local)
    for warning in warnings:
        print(f"local.json defaults: {warning}", file=sys.stderr)
    style.write_text(css, encoding="utf-8")
    if summary and "--quiet" not in argv:
        print(f"Defaults from local.json: {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
