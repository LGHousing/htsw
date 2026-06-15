"""Build HTSW release artifacts.

Produces, under dist-publish/:
  ct/htsw-ct-<version>.zip      full CT module payload (dist/* + metadata.json)
  ct/latest.json                {version, zip, sha256}
  vscode/htsw-plus-plus-<v>.vsix
  vscode/latest.json            {version, vsix, sha256}

Usage:
  python publish.py                 # build both and stage artifacts locally
  python publish.py --no-build      # reuse existing builds
  python publish.py --ct-only
  python publish.py --vscode-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CT_DIR = HERE / "ct_module"
VSCODE_DIR = HERE / "editors" / "code"
OUT_DIR = HERE / "dist-publish"

IS_WINDOWS = sys.platform == "win32"


def run(cmd: list[str], cwd: Path) -> None:
    print(f"[publish] $ {' '.join(cmd)}  (in {cwd})")
    status = subprocess.run(cmd, cwd=cwd, shell=IS_WINDOWS).returncode
    if status != 0:
        raise RuntimeError(f"Command failed ({status}): {' '.join(cmd)}")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_version(json_path: Path) -> str:
    return json.loads(json_path.read_text(encoding="utf-8"))["version"]


def build_ct(do_build: bool) -> tuple[Path, str]:
    if do_build:
        run(["npm", "run", "build"], CT_DIR)

    dist = CT_DIR / "dist"
    metadata = CT_DIR / "metadata.json"
    if not dist.is_dir():
        raise RuntimeError(f"Missing CT build output: {dist}")

    version = read_version(metadata)
    out = OUT_DIR / "ct"
    out.mkdir(parents=True, exist_ok=True)
    zip_name = f"htsw-ct-{version}.zip"
    zip_path = out / zip_name

    # Mirror what install.py deploys: everything under dist/ at the archive
    # root, plus metadata.json. No .env / mcp.json (per-install config).
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(dist.rglob("*")):
            if file.is_file():
                zf.write(file, file.relative_to(dist).as_posix())
        zf.write(metadata, "metadata.json")

    digest = sha256_of(zip_path)
    (out / "latest.json").write_text(
        json.dumps({"version": version, "zip": zip_name, "sha256": digest}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[publish] CT {version}: {zip_name} ({zip_path.stat().st_size} bytes, sha256 {digest[:12]}…)")
    return out, version


def build_vscode(do_build: bool) -> tuple[Path, str]:
    if do_build:
        run(["npm", "run", "build"], VSCODE_DIR)
    # Always (re)package so the vsix matches the current build + version.
    run(["npm", "run", "package"], VSCODE_DIR)

    version = read_version(VSCODE_DIR / "package.json")
    produced = sorted(VSCODE_DIR.glob("*.vsix"), key=lambda p: p.stat().st_mtime)
    if not produced:
        raise RuntimeError("vsce produced no .vsix")
    vsix = produced[-1]

    out = OUT_DIR / "vscode"
    out.mkdir(parents=True, exist_ok=True)
    dest = out / vsix.name
    shutil.copy2(vsix, dest)

    digest = sha256_of(dest)
    (out / "latest.json").write_text(
        json.dumps({"version": version, "vsix": vsix.name, "sha256": digest}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[publish] VSCode {version}: {vsix.name} ({dest.stat().st_size} bytes, sha256 {digest[:12]}…)")
    return out, version


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-build", action="store_true", help="reuse existing builds")
    parser.add_argument("--ct-only", action="store_true")
    parser.add_argument("--vscode-only", action="store_true")
    args = parser.parse_args()

    do_ct = not args.vscode_only
    do_vscode = not args.ct_only
    do_build = not args.no_build

    if do_ct:
        build_ct(do_build)
    if do_vscode:
        build_vscode(do_build)

    print(f"[publish] Artifacts staged in {OUT_DIR}")


if __name__ == "__main__":
    main()
