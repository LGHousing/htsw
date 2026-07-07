# Installing HTSW

HTSW has two parts you can install independently: the **VS Code extension** (syntax, completions, diagnostics for `.htsl` / `import.json`) and the **in-game module** (the overlay that imports/exports real Housing menus).

## VS Code extension (HTSW++)

1. Download [`editors/code/htsw-plus-plus.vsix`](editors/code/htsw-plus-plus.vsix) from this repo.
2. In VS Code: **Extensions → `⋯` menu → Install from VSIX…** and pick the file.

## In-game module (Minecraft 1.8.9 + ChatTriggers)

Requirements:

- Minecraft **1.8.9** with Forge
- [ChatTriggers](https://www.chattriggers.com/) 2.2.1 for 1.8.9

### Quick install (pre-built)

1. Download [`HTSW.zip`](https://legendarygames.dev/htsw/ct/HTSW.zip).
2. Extract it — you get a folder named **`HTSW`**.
3. Move that `HTSW` folder into `…/.minecraft/config/ChatTriggers/modules/`.
4. In-game, run `/ct reload`.

The folder must stay named `HTSW`, or ChatTriggers won't load it. After this, `/htsw update` keeps it current automatically.

### Build from source

Also needs Node.js 20+, Python 3, and a JDK (for `javac`).

```sh
git clone https://github.com/LGHousing/htsw
cd htsw
npm install                          # workspace install — every package at once
npm run build --workspace language   # ct_module and the CLI build against language/dist
```

Create `ct_module/.env` pointing at your ChatTriggers modules folder:

```
CT_MODULE_DESTINATION=C:\path\to\.minecraft\config\ChatTriggers\modules\HTSW
HTSW_REPOSITORY_PATH=C:\path\to\htsw

# Optional — the MCP bridge that lets Claude Code drive /htsw. Off by default.
HTSW_MCP_ENABLED=false
HTSW_MCP_PORT=37123
```

Then build and deploy the in-game module:

```sh
cd ct_module && python install.py
```

In-game, run `/ct reload`.

## First steps

- Open your **Housing menu** in-game — the HTSW overlay appears around it.
- **Importables tab**: click **Create sample project** for a small commented example project, or **Browse** to open your own `import.json`.
- Click the **house button** on an `import.json` row to bind the file to the house you're standing in — the overlay then keeps file and house lined up automatically.
- **Houses tab**: scan what's already built in your house and export it into your files.
- **Single-click** a row to preview its source in the View pane (italic = temporary); **double-click** (or right-click → **Open in View**) to pin the tab. The checkbox and caret handle queueing and expanding on their own.

## CLI (optional)

```sh
npm run build --workspace cli
node cli/dist/htsw-cli.js check path/to/import.json
```
