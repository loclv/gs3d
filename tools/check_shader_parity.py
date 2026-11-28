#!/usr/bin/env python3
"""Check that the CPU rasterizer still spells the same math as the GLSL
fragment shader in g3_web.c.

The two are maintained by hand: platform/g3_soft.c's shade() is the fragment
shader written in C, term for term, with the output transforms (tone map,
sRGB encode) in srgb_decode/srgb_encode/tone_map_value beside it. This
script cannot prove equivalence, but it catches the most common drift — a
constant present on one side only — by comparing the sets of floating-point
literals in both sources.

Usage: tools/check_shader_parity.py
Exit 0 when the constant sets agree, 1 on drift.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "platform" / "g3_web.c"
SOFT = ROOT / "platform" / "g3_soft.c"

# C functions whose bodies together spell the fragment shader on the CPU
# side. Keep in sync with the helpers FRAGMENT_SRC inlines.
C_FUNCTIONS = [
    "static void shade(",
    "static float srgb_decode(",
    "static float srgb_encode(",
    "static float tone_map_value(",
    "static float dielectric_f0(",
    "static float point_shadow_visibility(",
    "static float spot_shadow_visibility(",
    "static float shadow_depth_visibility(",
]

STRING_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
FLOAT_RE = re.compile(r"""
    (?<![\w.])               # not part of an identifier or a longer number
    (?:\d+\.\d*|\.\d+|\d+\.\d*[eE][+-]?\d+|\d+[eE][+-]?\d*[fF]?)
    [fF]?
    (?![\w.])
""", re.VERBOSE)


def fragment_shader_source(text: str) -> str:
    """Concatenate the string literals of FRAGMENT_SRC's initializer."""
    # Anchor on the full declaration: "FRAGMENT_SRC =" is also a suffix of
    # "UNLIT_FRAGMENT_SRC =", which would extract the wrong shader.
    start = text.index("static const char *FRAGMENT_SRC =")
    i = start
    parts = []
    while True:
        m = STRING_RE.search(text, i)
        if not m:
            raise SystemExit("check_shader_parity: unterminated FRAGMENT_SRC")
        parts.append(m.group(1))
        j = m.end()
        while j < len(text) and text[j] in " \t\n":
            j += 1
        if text[j] == ";":
            break
        i = m.end()
    return "".join(parts)


def function_body(text: str, signature: str) -> str:
    """Extract a function body by brace matching from its definition.

    Forward declarations share the signature, so occurrences whose parameter
    list is terminated by ';' rather than '{' are skipped.
    """
    search = 0
    while True:
        start = text.index(signature, search)
        open_brace = text.index("{", start)
        semi = text.find(";", start)
        if semi != -1 and semi < open_brace:
            search = semi + 1
            continue
        break
    depth = 0
    i = open_brace
    while i < len(text):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace:i + 1]
        elif c == '"':
            i += 1
            while i < len(text) and text[i] != '"':
                if text[i] == "\\":
                    i += 1
                i += 1
        i += 1
    raise SystemExit(f"check_shader_parity: unterminated {signature}")


def constants(source: str) -> set:
    """Set of float literals, normalized to a canonical decimal form."""
    out = set()
    for m in FLOAT_RE.finditer(source):
        tok = m.group(0).rstrip("fF")
        try:
            out.add(repr(float(tok)))
        except ValueError:
            continue
    return out


def main() -> int:
    web = WEB.read_text()
    soft = SOFT.read_text()
    glsl = fragment_shader_source(web)
    c_source = "\n".join(function_body(soft, sig) for sig in C_FUNCTIONS)

    glsl_consts = constants(glsl)
    c_consts = constants(c_source)

    only_glsl = sorted(glsl_consts - c_consts, key=float)
    only_c = sorted(c_consts - glsl_consts, key=float)

    # The check that matters runs GLSL -> C: every constant the shader spells
    # must exist in the CPU shading. C legitimately carries extras — epsilon
    # guards, srgb_decode (the GPU decodes via GL_SRGB8 instead), loop
    # counters — so C -> GLSL is informational only.
    if only_c:
        print(f"note: {len(only_c)} C-side constants have no GLSL twin "
              "(expected: guards, decode path, counters)")

    if not only_glsl:
        print(f"shader parity: all {len(glsl_consts)} GLSL constants present "
              f"in g3_soft.c shading functions ({len(c_consts)} C constants)")
        return 0

    print("shader parity: GLSL constants missing from g3_soft.c\n")
    for val in only_glsl:
        print(f"    {val}")
    print("\nThe CPU rasterizer and the GPU shader have drifted. Find each "
          "constant in FRAGMENT_SRC and mirror it in shade() or its helpers.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
