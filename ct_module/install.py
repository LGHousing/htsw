from pathlib import Path
import os
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

RAW_DESTINATION = os.getenv('CT_MODULE_DESTINATION')
if RAW_DESTINATION is None:
    raise ValueError('CT_MODULE_DESTINATION is not set in .env')
DESTINATION = Path(RAW_DESTINATION).resolve()


def main() -> None:
    os.chdir(SOURCE)
    if '--nobuild' not in sys.argv:
        status = os.system('npm run build')
        if status != 0:
            raise RuntimeError(f'Build failed with error code: {status}')

    DESTINATION.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / 'dist' / 'index.js', DESTINATION / 'index.js')
    shutil.copy2(SOURCE / 'dist' / 'vendor.js', DESTINATION / 'vendor.js')
    shutil.copy2(SOURCE / 'metadata.json', DESTINATION / 'metadata.json')
    shutil.copy2(SOURCE / '.env', DESTINATION / '.env')

    print('Done!!!')

    if '--open' in sys.argv:
        os.startfile(DESTINATION)


if __name__ == '__main__':
    main()
