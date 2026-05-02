from pathlib import Path
import json
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
    dist_dir = SOURCE / 'dist'
    for source_file in dist_dir.iterdir():
        if source_file.is_file():
            shutil.copy2(source_file, DESTINATION / source_file.name)
    shutil.copy2(SOURCE / 'metadata.json', DESTINATION / 'metadata.json')
    shutil.copy2(SOURCE / '.env', DESTINATION / '.env')

    mcp_config_path = DESTINATION / 'mcp.json'
    mcp_enabled_raw = (os.getenv('HTSW_MCP_ENABLED') or '').strip().lower()
    mcp_enabled = mcp_enabled_raw in ('1', 'true', 'yes', 'on')
    if mcp_enabled:
        try:
            mcp_port = int(os.getenv('HTSW_MCP_PORT') or '37123')
        except ValueError:
            mcp_port = 37123
        mcp_config_path.write_text(
            json.dumps({'enabled': True, 'port': mcp_port}, indent=2),
            encoding='utf-8',
        )
        print(f'MCP bridge enabled on port {mcp_port}')
    elif mcp_config_path.exists():
        mcp_config_path.unlink()
        print('MCP bridge disabled (removed mcp.json)')

    print('Done!!!')

    if '--open' in sys.argv:
        os.startfile(DESTINATION)


if __name__ == '__main__':
    main()
