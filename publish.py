"""Build and publish HTSW autoupdate artifacts to legendarygames.dev.

Produces, under dist-publish/:
  ct/htsw-ct-<version>.zip      full CT module payload (dist/* + metadata.json)
  ct/latest.json                {version, zip, sha256, notes?}
  vscode/htsw-plus-plus-<v>.vsix
  vscode/latest.json            {version, vsix, sha256, notes?}

Then uploads them to the nginx-served root on the box (via the `lg-website`
SSH alias), staging through the opc home dir because /var/www/htsw is owned by
nginx and needs sudo to write. nginx serves /var/www/htsw at
https://legendarygames.dev/htsw/ via the `location ^~ /htsw/` block in
/etc/nginx/conf.d/legendarygames.dev.conf.

Usage:
  python publish.py                 # build both, then upload
  python publish.py --no-build      # reuse existing builds
  python publish.py --no-upload     # build + stage locally only
  python publish.py --ct-only
  python publish.py --vscode-only

Set HTSW_RELEASE_NOTES, or HTSW_RELEASE_TAG when `gh` is authenticated, to
include GitHub release notes in latest.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CT_DIR = HERE / "ct_module"
VSCODE_DIR = HERE / "editors" / "code"
OUT_DIR = HERE / "dist-publish"

SSH_HOST = "lg-website"
REMOTE_STAGING = "~/htsw-publish-staging"
REMOTE_WEB_ROOT = "/var/www/htsw"
NGINX_USER = "nginx"

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


def read_release_notes(surface: str | None = None) -> str | None:
    # Per-surface notes win (the CT feed and the VS Code feed reach different
    # audiences), then the shared notes, then the GitHub release body.
    if surface is not None:
        surfaced = os.getenv(f"HTSW_RELEASE_NOTES_{surface.upper()}", "").strip()
        if surfaced:
            return surfaced
    notes = os.getenv("HTSW_RELEASE_NOTES", "").strip()
    if notes:
        return notes

    release_tag = os.getenv("HTSW_RELEASE_TAG", "").strip()
    if not release_tag:
        return None

    result = subprocess.run(
        ["gh", "release", "view", release_tag, "--json", "body", "--jq", ".body"],
        cwd=HERE,
        capture_output=True,
        text=True,
        shell=IS_WINDOWS,
    )
    if result.returncode == 0:
        notes = result.stdout.strip()
        if notes:
            return notes
    return None


def manifest_json(payload: dict[str, str], surface: str | None = None) -> str:
    notes = read_release_notes(surface)
    if notes is not None:
        payload["notes"] = notes
    return json.dumps(payload, indent=2) + "\n"


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
        manifest_json({"version": version, "zip": zip_name, "sha256": digest}, surface="ct"),
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
        manifest_json(surface="vscode", payload={"version": version, "vsix": vsix.name, "sha256": digest}),
        encoding="utf-8",
    )
    print(f"[publish] VSCode {version}: {vsix.name} ({dest.stat().st_size} bytes, sha256 {digest[:12]}…)")
    return out, version


def upload(targets: list[str]) -> None:
    # targets is a subset of {"ct", "vscode"}.
    mk = " ".join(f"{REMOTE_STAGING}/{t}" for t in targets)
    run(["ssh", SSH_HOST, f"mkdir -p {mk}"], HERE)

    for t in targets:
        local = OUT_DIR / t
        # scp each file in the category to its staging subdir.
        files = [str(p) for p in local.iterdir() if p.is_file()]
        run(["scp", *files, f"{SSH_HOST}:{REMOTE_STAGING}/{t}/"], HERE)

    copies = " && ".join(
        f"sudo mkdir -p {REMOTE_WEB_ROOT}/{t} && sudo cp -f {REMOTE_STAGING}/{t}/* {REMOTE_WEB_ROOT}/{t}/"
        for t in targets
    )
    remote = (
        f"{copies} && "
        f"sudo chown -R {NGINX_USER}:{NGINX_USER} {REMOTE_WEB_ROOT} && "
        f"(sudo chcon -R -t httpd_sys_content_t {REMOTE_WEB_ROOT} 2>/dev/null || true) && "
        f"rm -rf {REMOTE_STAGING}"
    )
    run(["ssh", SSH_HOST, remote], HERE)
    print(f"[publish] Uploaded {', '.join(targets)} to {SSH_HOST}:{REMOTE_WEB_ROOT}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-build", action="store_true", help="reuse existing builds")
    parser.add_argument("--no-upload", action="store_true", help="stage locally, do not upload")
    parser.add_argument("--ct-only", action="store_true")
    parser.add_argument("--vscode-only", action="store_true")
    args = parser.parse_args()

    do_ct = not args.vscode_only
    do_vscode = not args.ct_only
    do_build = not args.no_build

    targets: list[str] = []
    if do_ct:
        build_ct(do_build)
        targets.append("ct")
    if do_vscode:
        build_vscode(do_build)
        targets.append("vscode")

    if args.no_upload:
        print(f"[publish] Skipped upload. Artifacts staged in {OUT_DIR}")
        return

    upload(targets)
    print("[publish] Done.")


if __name__ == "__main__":
    main()
