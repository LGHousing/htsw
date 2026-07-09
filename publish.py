"""Build and publish HTSW autoupdate artifacts to legendarygames.dev.

Produces, under dist-publish/:
  ct/htsw-ct-<version>.zip      flat CT module payload for the autoupdater feed
  ct/HTSW.zip                   same payload nested under HTSW/ for manual install
  ct/latest.json                {version, zip, sha256, notes?}
  vscode/htsw-plus-plus-<v>.vsix
  vscode/latest.json            {version, vsix, sha256, notes?}
  cli/htsw-cli-<version>.js     bundled CLI (check / run / upgrade)
  cli/install.sh                curl|sh installer
  cli/latest.json               {version, cli, sha256, notes?}

Each surface also gets a stable "-latest" copy (htsw-ct-latest.zip,
htsw-plus-plus-latest.vsix, htsw-cli-latest.js) for durable download links.

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
  python publish.py --cli-only

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
CLI_DIR = HERE / "cli"
OUT_DIR = HERE / "dist-publish"

SSH_HOST = "lg-website"
REMOTE_STAGING = "~/htsw-publish-staging"
REMOTE_WEB_ROOT = "/var/www/htsw"
NGINX_USER = "nginx"

IS_WINDOWS = sys.platform == "win32"


def run(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    print(f"[publish] $ {' '.join(cmd)}  (in {cwd})")
    status = subprocess.run(cmd, cwd=cwd, shell=IS_WINDOWS, env=env).returncode
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


def write_ct_zip(zip_path: Path, dist: Path, metadata: Path, root: str = "") -> None:
    # Mirror what install.py deploys: everything under dist/ at the archive
    # root, plus metadata.json. No .env. When `root` is set, nest every entry
    # under that folder.
    prefix = f"{root}/" if root else ""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(dist.rglob("*")):
            if file.is_file():
                zf.write(file, prefix + file.relative_to(dist).as_posix())
        zf.write(metadata, prefix + "metadata.json")


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

    # The feed zip stays flat: already-installed autoupdaters extract it and
    # move its children straight into modules/HTSW.
    write_ct_zip(zip_path, dist, metadata)
    shutil.copy2(zip_path, out / "htsw-ct-latest.zip")

    # The human download nests everything under HTSW/, so extracting it by any
    # method yields a folder named HTSW — the name ChatTriggers and the
    # autoupdater both require. Kept separate from the feed zip because the
    # deployed updaters can't handle the nested layout yet.
    write_ct_zip(out / "HTSW.zip", dist, metadata, root="HTSW")

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
    shutil.copy2(dest, out / "htsw-plus-plus-latest.vsix")

    digest = sha256_of(dest)
    (out / "latest.json").write_text(
        manifest_json(surface="vscode", payload={"version": version, "vsix": vsix.name, "sha256": digest}),
        encoding="utf-8",
    )
    print(f"[publish] VSCode {version}: {vsix.name} ({dest.stat().st_size} bytes, sha256 {digest[:12]}…)")
    return out, version


def build_cli(do_build: bool) -> tuple[Path, str]:
    if do_build:
        run(["npm", "run", "build"], CLI_DIR)

    bundle = CLI_DIR / "dist" / "htsw-cli.js"
    if not bundle.is_file():
        raise RuntimeError(f"Missing CLI build output: {bundle}")

    version = read_version(CLI_DIR / "package.json")
    out = OUT_DIR / "cli"
    out.mkdir(parents=True, exist_ok=True)
    js_name = f"htsw-cli-{version}.js"
    dest = out / js_name
    shutil.copy2(bundle, dest)
    shutil.copy2(dest, out / "htsw-cli-latest.js")
    shutil.copy2(CLI_DIR / "install.sh", out / "install.sh")

    digest = sha256_of(dest)
    (out / "latest.json").write_text(
        manifest_json({"version": version, "cli": js_name, "sha256": digest}, surface="cli"),
        encoding="utf-8",
    )
    print(f"[publish] CLI {version}: {js_name} ({dest.stat().st_size} bytes, sha256 {digest[:12]}…)")
    return out, version


def upload(targets: list[str]) -> None:
    # targets is a subset of {"ct", "vscode", "cli"}.
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
    parser.add_argument("--cli-only", action="store_true", help="build+upload only the CLI (needs HTSW_DOCS_PATH)")
    args = parser.parse_args()

    # The CLI is opt-in (it needs HTSW_DOCS_PATH), so the default run still
    # builds ct + vscode only. Any "--*-only" flag narrows to that surface.
    any_only = args.ct_only or args.vscode_only or args.cli_only
    do_ct = args.ct_only or not any_only
    do_vscode = args.vscode_only or not any_only
    do_cli = args.cli_only
    do_build = not args.no_build

    targets: list[str] = []
    if do_ct:
        build_ct(do_build)
        targets.append("ct")
    if do_vscode:
        build_vscode(do_build)
        targets.append("vscode")
    if do_cli:
        build_cli(do_build)
        targets.append("cli")

    if args.no_upload:
        print(f"[publish] Skipped upload. Artifacts staged in {OUT_DIR}")
        return

    upload(targets)
    print("[publish] Done.")


if __name__ == "__main__":
    main()
