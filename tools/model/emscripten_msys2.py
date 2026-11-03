"""Runs MSYS2's Emscripten on Windows (used by tools/model/build.mjs).

The MSYS2 package's small .exe launchers (emcc.exe, em++.exe ...) do not start on Windows
("not a valid Win32 application"), and Emscripten calls them when it builds its libraries.
This wrapper points Emscripten at .bat launchers that call this script instead, then runs the
real tool. Nothing in the MSYS2 install is changed.

Usage: python emscripten_msys2.py <emcc|em++|emar|emranlib> [args...]
Needs HBR_EMSCRIPTEN_ROOT (the folder with emcc.py) and HBR_EM_LAUNCHERS (the .bat folder).
"""
import os
import runpy
import sys

ROOT = os.environ["HBR_EMSCRIPTEN_ROOT"]
LAUNCHERS = os.environ["HBR_EM_LAUNCHERS"]
TOOLS = ("emcc", "em++", "emar", "emranlib")

tool, args = sys.argv[1], sys.argv[2:]
sys.path.insert(0, ROOT)

from tools import utils  # noqa: E402  (Emscripten's own module, found via ROOT)

_find_exe = utils.find_exe


def find_exe(*parts):
    path = os.path.normpath(os.path.join(*parts))
    if os.path.dirname(path) == os.path.normpath(ROOT) and os.path.basename(path) in TOOLS:
        return os.path.join(LAUNCHERS, os.path.basename(path) + ".bat")
    return _find_exe(*parts)


utils.find_exe = find_exe
script = os.path.join(ROOT, tool + ".py")
sys.argv = [script] + args
runpy.run_path(script, run_name="__main__")
