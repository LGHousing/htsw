# HTSW

Write Hypixel Housing GUIs as text instead of clicking through in-game menus. The included ChatTriggers module imports your file straight into Housing and diffs against what's already there, so re-runs only push what changed.

HTSW is a refined evolution of [HTSL](https://github.com/BusterBrown1218) — same idea, stricter type system, real diagnostics, and a working round-trip with the game.

## What it looks like

A function written in HTSW:

```htsl
/// Greet the player when they hold the cool item.
if and (hasItem "coolItem") {
    chat "You have the cool item!"
} else {
    chat "You're not very cool. Sorry!"
}
```

Wired up in `import.json`:

```json
{
    "functions": [
        {
            "name": "Greet",
            "actions": "greet.htsl",
            "icon": { "item": "minecraft:clock" }
        }
    ],
    "items": [
        { "name": "coolItem", "nbt": "./cool.snbt" }
    ]
}
```

Run `/import import.json` in a Housing world and the function lands in your Housing menus, with the referenced item materialized and ready to use.

## What's in the box

- **Parser, type checker, and diagnostics.** Wrong action names, bad field types, and missing references get caught before you ever open a menu.
- **ChatTriggers module.** `/import`, `/export`, `/simulator`, `/htsw gui`. Drives the actual Housing GUI — opens menus, edits actions, diffs against what's there, syncs only the differences. Item NBT is cached per-housing.
- **Simulator.** Run your code outside Housing for fast iteration on logic.
- **In-game dashboard.** `/htsw gui` opens an overlay for browsing files, inspecting knowledge, and kicking off imports without touching chat.
- **VSCode extension.** Autocomplete, hover, diagnostics. A Monaco build exists for the web.
- **CLI.** `htsw check path/` and `htsw run path/` for terminal checks and quick runs.

## Quick start

### Use it in Minecraft

1. Install [ChatTriggers](https://www.chattriggers.com/).
2. Clone this repo.
3. In `ct_module/`, create a `.env` file:
   ```
   CT_MODULE_DESTINATION=<path to your ChatTriggers modules folder>
   HTSW_REPOSITORY_PATH=<absolute path to this repo>
   ```
4. From `ct_module/`, run `python install.py`.
5. In Minecraft, in a Housing world: `/import path/to/import.json`.

### Edit with autocomplete

Install the VSCode extension from the releases page.

### Check from the terminal

```bash
cd cli
npm install
npm run build
node dist/htsw-cli.js check path/to/import.json
```

## Examples

Working examples live under [`examples/`](examples/). Start with [`examples/simple/`](examples/simple/) — it covers a function, an event, and an item with NBT.

## Credits

A continuation of [BusterBrown1218](https://github.com/BusterBrown1218)'s HTSL. Housing wouldn't be in the state it's in today without his work.

HTSW itself is built by @sndyx, @j_sse, and @callanftw.

## License

MIT — see [LICENSE.txt](LICENSE.txt).
