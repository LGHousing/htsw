from pathlib import Path
import os
import re
import sys
import shutil
import dotenv


HERE = Path(__file__).resolve().parent
DOT_ENV = HERE / '.env'
if not DOT_ENV.exists():
    raise FileNotFoundError('Missing .env file in ct_module. Please create it first.')

dotenv.load_dotenv(DOT_ENV)


SOURCE = Path(__file__).resolve().parent
assert SOURCE.exists()


def _normalize_destination(raw: str) -> str:
    # On Linux/WSL, translate Windows paths like `C:\foo\bar` to `/mnt/c/foo/bar`
    # so the same .env works from both PowerShell and a WSL shell.
    if sys.platform == 'win32':
        return raw
    m = re.match(r'^([A-Za-z]):[\\/](.*)$', raw)
    if not m:
        return raw
    return f'/mnt/{m.group(1).lower()}/{m.group(2).replace(chr(92), "/")}'


RAW_DESTINATION = os.getenv('CT_MODULE_DESTINATION')
if RAW_DESTINATION is None:
    raise ValueError('CT_MODULE_DESTINATION is not set in .env')
DESTINATION = Path(_normalize_destination(RAW_DESTINATION)).resolve()


def main() -> None:
    os.chdir(SOURCE)
    if '--nobuild' not in sys.argv:
        status = os.system('npm run build')
        if status != 0:
            raise RuntimeError(f'Build failed with error code: {status}')

    DESTINATION.mkdir(parents=True, exist_ok=True)
    dist_dir = SOURCE / 'dist'
    dist_files = {
        source_file.name
        for source_file in dist_dir.iterdir()
        if source_file.is_file()
    }
    generated_js = re.compile(r'^index\d*\.js$')
    for dest_file in DESTINATION.iterdir():
        if not dest_file.is_file():
            continue
        if generated_js.match(dest_file.name) and dest_file.name not in dist_files:
            dest_file.unlink()
    for source_file in dist_dir.iterdir():
        if source_file.is_file():
            shutil.copy2(source_file, DESTINATION / source_file.name)
    # Mirror dist/assets/ into the deploy. The Vite icon-shake plugin only writes
    # PNGs that are referenced in the bundle, so this copy is already minimal.
    # Wipe the destination assets dir first so removed icons don't linger.
    dist_assets = dist_dir / 'assets'
    dest_assets = DESTINATION / 'assets'
    if dest_assets.exists():
        shutil.rmtree(dest_assets)
    if dist_assets.exists():
        shutil.copytree(dist_assets, dest_assets)
    shutil.copy2(SOURCE / 'metadata.json', DESTINATION / 'metadata.json')

    env_text = (SOURCE / '.env').read_text(encoding='utf-8')
    (DESTINATION / '.env').write_text(env_text, encoding='utf-8')

    print('Done!!!')

    if '--open' in sys.argv:
        os.startfile(DESTINATION)


if __name__ == '__main__':
    main()
