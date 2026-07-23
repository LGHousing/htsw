"""Build, deploy, verify, and release HTSW artifacts.

Commands:
  python publish.py stage
  python publish.py deploy
  python publish.py verify
  python publish.py release --tag v0.9.9 --notes-file release-notes.txt

The deploy command sends dist-publish/{ct,vscode,cli} to the checked-in
ops/htsw-deploy server command. Release performs a clean-tree preflight,
stages every surface, deploys it, and creates or updates the GitHub release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Sequence


HERE = Path(__file__).resolve().parent
CT_DIR = HERE / "ct_module"
VSCODE_DIR = HERE / "editors" / "code"
CLI_DIR = HERE / "cli"
OUT_DIR = HERE / "dist-publish"

SURFACES = ("ct", "vscode", "cli")
ARTIFACT_FIELDS = {"ct": "zip", "vscode": "vsix", "cli": "cli"}
PUBLIC_BASE_URL = "https://legendarygames.dev/htsw"


def executable(name: str) -> str:
    resolved = shutil.which(name)
    if resolved is None:
        raise RuntimeError(f"Required command is not on PATH: {name}")
    return resolved


def display_command(cmd: Sequence[str]) -> str:
    if sys.platform == "win32":
        return subprocess.list2cmdline(list(cmd))
    return shlex.join(cmd)


def run(
    cmd: Sequence[str],
    cwd: Path = HERE,
    *,
    capture_output: bool = False,
    stdin: object | None = None,
) -> subprocess.CompletedProcess[str]:
    resolved = [executable(cmd[0]), *cmd[1:]]
    print(f"[publish] $ {display_command(cmd)}  (in {cwd})")
    result = subprocess.run(
        resolved,
        cwd=cwd,
        stdin=stdin,
        capture_output=capture_output,
        text=stdin is None,
    )
    if result.returncode != 0:
        if capture_output:
            if result.stdout:
                stdout = (
                    result.stdout.decode(errors="replace")
                    if isinstance(result.stdout, bytes)
                    else result.stdout
                )
                print(stdout, end="")
            if result.stderr:
                stderr = (
                    result.stderr.decode(errors="replace")
                    if isinstance(result.stderr, bytes)
                    else result.stderr
                )
                print(stderr, end="", file=sys.stderr)
        raise RuntimeError(f"Command failed ({result.returncode}): {display_command(cmd)}")
    return result


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, object]:
    parsed = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Expected a JSON object in {path}")
    return parsed


def read_version(path: Path) -> str:
    version = read_json(path).get("version")
    if not isinstance(version, str) or not version:
        raise RuntimeError(f"Missing version in {path}")
    return version


def selected_surfaces(args: argparse.Namespace) -> list[str]:
    return list(dict.fromkeys(getattr(args, "surface", None) or SURFACES))


def read_notes_file(path: str | None) -> str | None:
    if path is None:
        return None
    notes = Path(path).read_text(encoding="utf-8").strip()
    return notes or None


def github_release_notes(tag: str | None) -> str | None:
    if not tag or shutil.which("gh") is None:
        return None
    result = subprocess.run(
        [executable("gh"), "release", "view", tag, "--json", "body", "--jq", ".body"],
        cwd=HERE,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    notes = result.stdout.strip()
    return notes or None


def release_notes(args: argparse.Namespace) -> tuple[str | None, dict[str, str]]:
    shared = (
        read_notes_file(getattr(args, "notes_file", None))
        or getattr(args, "notes", None)
        or os.getenv("HTSW_RELEASE_NOTES", "").strip()
        or github_release_notes(getattr(args, "tag", None))
    )
    per_surface: dict[str, str] = {}
    for surface in SURFACES:
        value = os.getenv(f"HTSW_RELEASE_NOTES_{surface.upper()}", "").strip()
        if value:
            per_surface[surface] = value
    return shared or None, per_surface


def manifest_json(payload: dict[str, str], notes: str | None) -> str:
    if notes:
        payload["notes"] = notes
    return json.dumps(payload, indent=2) + "\n"


def reset_surface_output(surface: str) -> Path:
    output = OUT_DIR / surface
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    return output


def write_ct_zip(zip_path: Path, dist: Path, metadata: Path, root: str = "") -> None:
    prefix = f"{root}/" if root else ""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(dist.rglob("*")):
            if file.is_file():
                archive.write(file, prefix + file.relative_to(dist).as_posix())
        archive.write(metadata, prefix + "metadata.json")


def stage_ct(do_build: bool, notes: str | None) -> None:
    if do_build:
        run(["npm", "run", "build"], CT_DIR)

    dist = CT_DIR / "dist"
    metadata = CT_DIR / "metadata.json"
    if not dist.is_dir():
        raise RuntimeError(f"Missing CT build output: {dist}")

    version = read_version(metadata)
    package_version = read_version(CT_DIR / "package.json")
    if version != package_version:
        raise RuntimeError(
            f"CT version mismatch: metadata.json is {version}, package.json is {package_version}"
        )

    output = reset_surface_output("ct")
    zip_name = f"htsw-ct-{version}.zip"
    zip_path = output / zip_name
    write_ct_zip(zip_path, dist, metadata)
    shutil.copy2(zip_path, output / "htsw-ct-latest.zip")
    write_ct_zip(output / "HTSW.zip", dist, metadata, root="HTSW")

    digest = sha256_of(zip_path)
    (output / "latest.json").write_text(
        manifest_json({"version": version, "zip": zip_name, "sha256": digest}, notes),
        encoding="utf-8",
    )
    print(f"[publish] Staged CT {version} ({digest[:12]}…)")


def stage_vscode(do_build: bool, notes: str | None) -> None:
    if do_build:
        run(["npm", "run", "build"], VSCODE_DIR)

    version = read_version(VSCODE_DIR / "package.json")
    expected_name = f"htsw-plus-plus-{version}.vsix"
    expected_path = VSCODE_DIR / expected_name
    if expected_path.exists():
        expected_path.unlink()
    run(["npm", "run", "package:built"], VSCODE_DIR)
    if not expected_path.is_file():
        raise RuntimeError(f"VS Code packaging did not produce {expected_path}")

    output = reset_surface_output("vscode")
    destination = output / expected_name
    shutil.copy2(expected_path, destination)
    shutil.copy2(destination, output / "htsw-plus-plus-latest.vsix")

    digest = sha256_of(destination)
    (output / "latest.json").write_text(
        manifest_json(
            {"version": version, "vsix": expected_name, "sha256": digest}, notes
        ),
        encoding="utf-8",
    )
    print(f"[publish] Staged VS Code {version} ({digest[:12]}…)")


def stage_cli(do_build: bool, notes: str | None) -> None:
    if do_build:
        run(["npm", "run", "build"], CLI_DIR)

    bundle = CLI_DIR / "dist" / "htsw-cli.js"
    if not bundle.is_file():
        raise RuntimeError(f"Missing CLI build output: {bundle}")

    version = read_version(CLI_DIR / "package.json")
    output = reset_surface_output("cli")
    bundle_name = f"htsw-cli-{version}.mjs"
    destination = output / bundle_name
    shutil.copy2(bundle, destination)
    shutil.copy2(destination, output / "htsw-cli-latest.mjs")
    shutil.copy2(CLI_DIR / "install.sh", output / "install.sh")
    shutil.copy2(CLI_DIR / "install.ps1", output / "install.ps1")

    digest = sha256_of(destination)
    (output / "latest.json").write_text(
        manifest_json({"version": version, "cli": bundle_name, "sha256": digest}, notes),
        encoding="utf-8",
    )
    print(f"[publish] Staged CLI {version} ({digest[:12]}…)")


def stage(
    surfaces: Sequence[str],
    *,
    do_build: bool,
    shared_notes: str | None,
    per_surface_notes: dict[str, str],
) -> None:
    if do_build:
        run(["npm", "run", "build", "--workspace", "language"])

    builders = {"ct": stage_ct, "vscode": stage_vscode, "cli": stage_cli}
    for surface in surfaces:
        builders[surface](do_build, per_surface_notes.get(surface, shared_notes))


def staged_manifest(surface: str) -> dict[str, object]:
    manifest_path = OUT_DIR / surface / "latest.json"
    if not manifest_path.is_file():
        raise RuntimeError(f"{surface} has not been staged: missing {manifest_path}")
    manifest = read_json(manifest_path)
    artifact_field = ARTIFACT_FIELDS[surface]
    artifact_name = manifest.get(artifact_field)
    expected_sha = manifest.get("sha256")
    version = manifest.get("version")
    if not all(isinstance(value, str) and value for value in (artifact_name, expected_sha, version)):
        raise RuntimeError(f"Malformed staged manifest: {manifest_path}")
    artifact = OUT_DIR / surface / str(artifact_name)
    if not artifact.is_file():
        raise RuntimeError(f"Missing staged artifact: {artifact}")
    actual_sha = sha256_of(artifact)
    if actual_sha != expected_sha:
        raise RuntimeError(f"Staged checksum mismatch for {artifact}")
    return manifest


def ssh_options(temp_dir: Path) -> tuple[list[str], str]:
    host = os.getenv("HTSW_DEPLOY_HOST", "").strip() or "lg-website"
    user = os.getenv("HTSW_DEPLOY_USER", "").strip()
    target = f"{user}@{host}" if user else host
    options = ["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"]

    key = os.getenv("HTSW_DEPLOY_KEY", "")
    known_hosts = os.getenv("HTSW_DEPLOY_KNOWN_HOSTS", "")
    if key:
        if not known_hosts:
            raise RuntimeError("HTSW_DEPLOY_KNOWN_HOSTS is required with HTSW_DEPLOY_KEY")
        key_path = temp_dir / "deploy-key"
        hosts_path = temp_dir / "known-hosts"
        key_path.write_text(key.rstrip() + "\n", encoding="utf-8")
        hosts_path.write_text(known_hosts.rstrip() + "\n", encoding="utf-8")
        key_path.chmod(0o600)
        options.extend(
            [
                "-i",
                str(key_path),
                "-o",
                f"UserKnownHostsFile={hosts_path}",
                "-o",
                "StrictHostKeyChecking=yes",
            ]
        )
    return options, target


def remote_command(kind: str) -> str:
    configured = os.getenv("HTSW_DEPLOY_COMMAND", "").strip()
    if configured:
        return configured if kind == "deploy" else f"{configured} verify"
    if os.getenv("HTSW_DEPLOY_KEY"):
        return kind
    return "~/bin/htsw-deploy" if kind == "deploy" else "~/bin/htsw-deploy verify"


def run_remote(kind: str, *, stdin_path: Path | None = None) -> str:
    with tempfile.TemporaryDirectory(prefix="htsw-ssh-") as raw_temp:
        temp_dir = Path(raw_temp)
        options, target = ssh_options(temp_dir)
        command = ["ssh", *options, target, remote_command(kind)]
        if stdin_path is None:
            result = run(command, capture_output=True)
        else:
            with stdin_path.open("rb") as payload:
                result = run(command, capture_output=True, stdin=payload)
        stdout = result.stdout.decode() if isinstance(result.stdout, bytes) else result.stdout
        stderr = result.stderr.decode() if isinstance(result.stderr, bytes) else result.stderr
        if stdout:
            print(stdout, end="")
        if stderr:
            print(stderr, end="", file=sys.stderr)
        return stdout


def parse_receipt(output: str) -> dict[str, str]:
    lines = [line for line in output.splitlines() if line.startswith("installed ")]
    if not lines:
        raise RuntimeError("Deploy server did not return an installed-version receipt")
    return dict(re.findall(r"(ct|vscode|cli)=([^\s]+)", lines[-1]))


def assert_receipt(receipt: dict[str, str], surfaces: Sequence[str]) -> None:
    for surface in surfaces:
        expected = staged_manifest(surface)["version"]
        actual = receipt.get(surface)
        if actual != expected:
            raise RuntimeError(
                f"Deploy receipt mismatch for {surface}: staged {expected}, installed {actual or 'unknown'}"
            )


def deploy(surfaces: Sequence[str]) -> None:
    for surface in surfaces:
        staged_manifest(surface)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="htsw-deploy-") as raw_temp:
        tar_path = Path(raw_temp) / "payload.tar"
        with tarfile.open(tar_path, "w") as archive:
            for surface in surfaces:
                archive.add(OUT_DIR / surface, arcname=surface)
        receipt = parse_receipt(run_remote("deploy", stdin_path=tar_path))
    assert_receipt(receipt, surfaces)
    print(f"[publish] Deployed and verified: {', '.join(surfaces)}")


def fetch_manifest(surface: str) -> dict[str, object]:
    url = f"{PUBLIC_BASE_URL}/{surface}/latest.json"
    request = urllib.request.Request(url, headers={"User-Agent": "HTSW-Publisher"})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            if not isinstance(parsed, dict):
                raise RuntimeError(f"Expected an object from {url}")
            return parsed
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(1)
    raise RuntimeError(f"Could not fetch {url}: {last_error}")


def verify(surfaces: Sequence[str]) -> None:
    for surface in surfaces:
        expected = staged_manifest(surface)
        live = fetch_manifest(surface)
        for field in ("version", "sha256", ARTIFACT_FIELDS[surface]):
            if live.get(field) != expected.get(field):
                raise RuntimeError(
                    f"Live {surface} feed mismatch for {field}: "
                    f"expected {expected.get(field)!r}, got {live.get(field)!r}"
                )
        print(f"[publish] Verified public {surface} feed at {expected['version']}")


def assert_clean_worktree() -> None:
    result = run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        capture_output=True,
    )
    if result.stdout.strip():
        raise RuntimeError("Publishing requires a clean worktree; commit or stash changes first")


def validate_release_tag(tag: str) -> None:
    expected = f"v{read_version(CT_DIR / 'package.json')}"
    if tag != expected:
        raise RuntimeError(f"Release tag must match the CT version: expected {expected}, got {tag}")


def ensure_tag(tag: str) -> None:
    head = run(["git", "rev-parse", "HEAD"], capture_output=True).stdout.strip()
    existing = subprocess.run(
        [executable("git"), "rev-list", "-n", "1", tag],
        cwd=HERE,
        capture_output=True,
        text=True,
    )
    if existing.returncode == 0:
        if existing.stdout.strip() != head:
            raise RuntimeError(f"Tag {tag} does not point at HEAD")
        return
    run(["git", "tag", tag])
    run(["git", "push", "origin", f"refs/tags/{tag}"])


def prepare_github_assets(surfaces: Sequence[str]) -> list[Path]:
    assets: list[Path] = []
    for surface in surfaces:
        manifest = staged_manifest(surface)
        manifest_copy = OUT_DIR / f"htsw-{surface}-latest.json"
        shutil.copy2(OUT_DIR / surface / "latest.json", manifest_copy)
        assets.append(manifest_copy)
        assets.append(OUT_DIR / surface / str(manifest[ARTIFACT_FIELDS[surface]]))
    if "ct" in surfaces:
        assets.append(OUT_DIR / "ct" / "HTSW.zip")
    if "cli" in surfaces:
        assets.append(OUT_DIR / "cli" / "install.sh")
        assets.append(OUT_DIR / "cli" / "install.ps1")
    return assets


def publish_github_release(tag: str, notes: str, surfaces: Sequence[str]) -> None:
    ct_version = read_version(CT_DIR / "package.json")
    vscode_version = read_version(VSCODE_DIR / "package.json")
    title = f"HTSW v{ct_version} (VS Code v{vscode_version})"
    existing = subprocess.run(
        [executable("gh"), "release", "view", tag],
        cwd=HERE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if existing.returncode == 0:
        run(["gh", "release", "edit", tag, "--title", title, "--notes", notes])
    else:
        run(["gh", "release", "create", tag, "--title", title, "--notes", notes])
    assets = prepare_github_assets(surfaces)
    run(["gh", "release", "upload", tag, *map(str, assets), "--clobber"])


def add_surface_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--surface",
        action="append",
        choices=SURFACES,
        help="limit the command to a surface; repeat to select more than one",
    )


def add_notes_arguments(parser: argparse.ArgumentParser) -> None:
    notes = parser.add_mutually_exclusive_group()
    notes.add_argument("--notes", help="shared release notes")
    notes.add_argument("--notes-file", help="read shared release notes from a UTF-8 file")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    stage_parser = commands.add_parser("stage", help="build and stage local artifacts")
    add_surface_argument(stage_parser)
    add_notes_arguments(stage_parser)
    stage_parser.add_argument("--no-build", action="store_true", help="reuse existing builds")
    stage_parser.add_argument("--tag", help="GitHub tag used as a release-notes fallback")

    deploy_parser = commands.add_parser("deploy", help="deploy staged artifacts")
    add_surface_argument(deploy_parser)
    deploy_parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="deploy despite tracked or untracked worktree changes",
    )

    verify_parser = commands.add_parser("verify", help="compare public feeds with staged artifacts")
    add_surface_argument(verify_parser)

    release_parser = commands.add_parser(
        "release", help="stage, deploy, and publish a GitHub release"
    )
    release_parser.add_argument("--tag", required=True)
    add_notes_arguments(release_parser)
    release_parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="release despite tracked or untracked worktree changes",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    surfaces = selected_surfaces(args)

    if args.command == "stage":
        shared_notes, per_surface_notes = release_notes(args)
        stage(
            surfaces,
            do_build=not args.no_build,
            shared_notes=shared_notes,
            per_surface_notes=per_surface_notes,
        )
        print(f"[publish] Artifacts staged in {OUT_DIR}")
        return

    if args.command == "deploy":
        if not args.allow_dirty:
            assert_clean_worktree()
        deploy(surfaces)
        return

    if args.command == "verify":
        verify(surfaces)
        return

    if not args.allow_dirty:
        assert_clean_worktree()
    validate_release_tag(args.tag)
    shared_notes, per_surface_notes = release_notes(args)
    if not shared_notes:
        raise RuntimeError(
            "Release notes are required; use --notes, --notes-file, HTSW_RELEASE_NOTES, "
            "or create the GitHub release first"
        )
    stage(
        SURFACES,
        do_build=True,
        shared_notes=shared_notes,
        per_surface_notes=per_surface_notes,
    )
    if not args.allow_dirty:
        assert_clean_worktree()
    ensure_tag(args.tag)
    deploy(SURFACES)
    publish_github_release(args.tag, shared_notes, SURFACES)
    print(f"[publish] Released {args.tag}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"[publish] error: {error}", file=sys.stderr)
        raise SystemExit(1) from None
