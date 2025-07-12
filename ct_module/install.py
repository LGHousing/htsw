from pathlib import Path
import os
import sys
import shutil


SOURCE = Path(__name__).resolve().parent
assert SOURCE.exists()

DESTINATION = Path(r'C:\Users\jesse\AppData\Roaming\.minecraft\config\ChatTriggers\modules\HTSW').resolve()

IGNORE = {SOURCE / '.git', SOURCE / 'node_modules', SOURCE / 'package-lock.json'}


def unlink_folder_with_contents(folder: Path) -> None:
    if not folder.is_dir():
        return
    for item in folder.iterdir():
        if item.is_dir():
            unlink_folder_with_contents(item)
        else:
            item.unlink()
    folder.rmdir()


def copy_folder_contents(
    source: Path,
    destination: Path,
    *,
    ignore: set[Path] | None = None,
) -> None:
    if ignore is not None and source in ignore:
        return
    destination.mkdir(parents=True, exist_ok=True)
    assert source.exists() and destination.exists()
    assert source.is_dir() and destination.is_dir()
    for item in source.iterdir():
        if ignore is not None and item in ignore:
            continue
        source_item = source / item.name
        destination_item = destination / item.name
        if item.is_dir():
            copy_folder_contents(source_item, destination_item, ignore=ignore)
        else:
            try:
                shutil.copy2(source_item, destination_item)
            except Exception as e:
                raise ValueError(f'Failed to copy {item} to {destination_item}') from e


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] != '--nobuild':
        os.system('npm run build')
    unlink_folder_with_contents(DESTINATION)
    DESTINATION.mkdir(parents=True, exist_ok=True)
    # copy_folder_contents(SOURCE, DESTINATION, ignore=IGNORE)
    # print(f'Copied {SOURCE} to {DESTINATION}')

    shutil.copy2(SOURCE / 'dist' / 'index.js', DESTINATION / 'index.js')
    shutil.copy2(SOURCE / 'metadata.json', DESTINATION / 'metadata.json')
    print('Done!')


if __name__ == '__main__':
    main()
