from __future__ import annotations

import argparse
from contextlib import suppress
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = HERE / ".env"
PRESERVED_STATE = (
    "gui-settings.json",
    "gui-recents.json",
    "gui-onboarding.json",
    "gui-housing.json",
    "gui-open-target.json",
    "gui-debug.log",
)


def remove_tree(path: Path) -> None:
    def clear_readonly_and_retry(function: object, raw_path: str, _error: object) -> None:
        os.chmod(raw_path, stat.S_IWRITE)
        function(raw_path)  # type: ignore[operator]

    shutil.rmtree(path, onerror=clear_readonly_and_retry)


def read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"Invalid line {line_number} in {path}: expected NAME=value")
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid variable name on line {line_number} in {path}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def normalize_destination(raw: str) -> str:
    if sys.platform == "win32":
        return raw
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", raw)
    if match is None:
        return raw
    rest = match.group(2).replace("\\", "/")
    return f"/mnt/{match.group(1).lower()}/{rest}"


def resolve_destination(raw: str) -> Path:
    destination = Path(normalize_destination(raw)).expanduser().resolve()
    if destination.name.casefold() != "htsw":
        raise ValueError(
            f"Refusing deploy destination that is not named HTSW: {destination}"
        )
    if destination == Path(destination.anchor):
        raise ValueError(f"Refusing unsafe deploy destination: {destination}")
    return destination


def run_build() -> None:
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("npm is not on PATH")
    result = subprocess.run([npm, "run", "build"], cwd=HERE)
    if result.returncode != 0:
        raise RuntimeError(f"Build failed with exit code {result.returncode}")


def write_runtime_env(stage: Path, env: dict[str, str]) -> None:
    repository_path = os.getenv("HTSW_REPOSITORY_PATH", env.get("HTSW_REPOSITORY_PATH", ""))
    if repository_path:
        (stage / ".env").write_text(
            f"HTSW_REPOSITORY_PATH={repository_path}\n", encoding="utf-8"
        )


def deployment_scratch_parent(destination: Path) -> Path:
    if destination.parent.name.casefold() == "modules":
        return destination.parent.parent
    return destination.parent


def remove_stale_module_stages(destination: Path) -> None:
    for stage in destination.parent.glob(f".{destination.name}-install-*"):
        if stage.is_dir():
            remove_tree(stage)


def build_stage(destination: Path, env: dict[str, str]) -> Path:
    dist = HERE / "dist"
    metadata = HERE / "metadata.json"
    if not dist.is_dir():
        raise FileNotFoundError(f"Missing build output: {dist}")
    if not metadata.is_file():
        raise FileNotFoundError(f"Missing module metadata: {metadata}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    scratch_parent = deployment_scratch_parent(destination)
    scratch_parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".HTSW-install-", dir=scratch_parent))
    try:
        shutil.copytree(dist, stage, dirs_exist_ok=True)
        shutil.copy2(metadata, stage / "metadata.json")
        write_runtime_env(stage, env)
        if destination.is_dir():
            for name in PRESERVED_STATE:
                source = destination / name
                if source.is_file():
                    shutil.copy2(source, stage / name)
        return stage
    except Exception:
        with suppress(OSError):
            remove_tree(stage)
        raise


def replace_destination(stage: Path, destination: Path) -> None:
    backup = deployment_scratch_parent(destination) / f".{destination.name}-backup-{os.getpid()}"
    if backup.exists():
        raise FileExistsError(f"Refusing to overwrite existing backup: {backup}")

    moved_existing = False
    try:
        if destination.exists():
            destination.replace(backup)
            moved_existing = True
        stage.replace(destination)
    except Exception:
        if moved_existing and not destination.exists() and backup.exists():
            backup.replace(destination)
        raise
    if backup.exists():
        try:
            remove_tree(backup)
        except OSError as error:
            print(f"Warning: deployed successfully but could not remove {backup}: {error}")


def open_destination(destination: Path) -> None:
    if sys.platform == "win32":
        os.startfile(destination)  # type: ignore[attr-defined]
        return
    opener = shutil.which("explorer.exe") or shutil.which("xdg-open")
    if opener is None:
        raise RuntimeError("Could not find explorer.exe or xdg-open")
    subprocess.Popen(
        [opener, str(destination)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and deploy the local HTSW CT module")
    parser.add_argument("--destination", help="override CT_MODULE_DESTINATION")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument(
        "--no-build",
        "--nobuild",
        action="store_true",
        help="reuse the existing dist directory",
    )
    parser.add_argument("--open", action="store_true", help="open the deployed module folder")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env = read_env_file(args.env_file)
    raw_destination = (
        args.destination
        or os.getenv("CT_MODULE_DESTINATION")
        or env.get("CT_MODULE_DESTINATION")
    )
    if not raw_destination:
        raise ValueError(
            "CT_MODULE_DESTINATION is not set; add it to ct_module/.env or use --destination"
        )
    destination = resolve_destination(raw_destination)
    remove_stale_module_stages(destination)

    if not args.no_build:
        run_build()
    stage = build_stage(destination, env)
    try:
        replace_destination(stage, destination)
    finally:
        if stage.exists():
            with suppress(OSError):
                remove_tree(stage)
    print(f"Deployed HTSW to {destination}")

    if args.open:
        open_destination(destination)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"install.py: {error}", file=sys.stderr)
        raise SystemExit(1) from None
