"""Runs MSYS2's Emscripten on Windows (used by tools/model/build.mjs).

The MSYS2 package's small .exe launchers (emcc.exe, em++.exe ...) do not start on Windows
("not a valid Win32 application"), and Emscripten calls them when it builds its libraries.
This wrapper points Emscripten at .bat launchers that call this script instead, then runs the
real tool. Nothing in the MSYS2 install is changed.

Windows Smart App Control can also block MSYS2's Binaryen programs (wasm-opt.exe, which
Emscripten runs at the end of a build). If HBR_BINARYEN_JS is set (the bin folder of the npm
package `binaryen`, the same tools compiled to WebAssembly), those calls run in Node instead.

Usage: python emscripten_msys2.py <emcc|em++|emar|emranlib> [args...]
Needs HBR_EMSCRIPTEN_ROOT (the folder with emcc.py) and HBR_EM_LAUNCHERS (the .bat folder).
Optional: HBR_BINARYEN_JS and HBR_NODE (the node program to run it with).
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

BINARYEN_JS = os.environ.get("HBR_BINARYEN_JS")
if BINARYEN_JS:
    from tools import building  # noqa: E402

    NODE = os.environ.get("HBR_NODE", "node")

    def to_node(cmd):
        # [".../bin/wasm-opt.exe", args...] -> [node, ".../binaryen/bin/wasm-opt", args...]
        if isinstance(cmd, (list, tuple)) and cmd:
            name = os.path.splitext(os.path.basename(str(cmd[0])))[0]
            js = os.path.join(BINARYEN_JS, name)
            if name.startswith("wasm") and os.path.exists(js):
                return [NODE, js] + list(cmd[1:])
        return cmd

    _run_process, _check_call = building.run_process, building.check_call
    building.run_process = lambda cmd, *a, **k: _run_process(to_node(cmd), *a, **k)
    building.check_call = lambda cmd, *a, **k: _check_call(to_node(cmd), *a, **k)

script = os.path.join(ROOT, tool + ".py")
sys.argv = [script] + args
runpy.run_path(script, run_name="__main__")
