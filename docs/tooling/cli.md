# CLI

The HTSW CLI checks complete imports and runs limited local simulations.

## Installation

Install Node.js 20 or newer, then use the installer for your shell.

### PowerShell

```powershell
irm https://legendarygames.dev/htsw/cli/install.ps1 | iex
```

### macOS, Linux, or Git Bash

```sh
curl -fsSL https://legendarygames.dev/htsw/cli/install.sh | sh
```

Both installers place `htsw` in `~/.local/bin` by default. Set
`HTSW_BIN_DIR` to choose another directory. Update it later with
`htsw upgrade`.

## Commands

### `htsw check [path]`

Parses and validates `./import.json` by default. The optional path must point to
an `import.json` or `*.import.json` file.

Check the entry import rather than an individual `.htsl` file so HTSW knows
which importable owns the actions:

```sh
htsw check import.json
```

### `htsw run [path] [--ticks N]`

Parses the same files as `htsw check`, then runs the function `htsw:main`.

The output of the
[Send a Chat Message](../htsl/actions.md#send-a-chat-message)
action is written to standard output.

Use `--ticks N` to advance the runtime by a non-negative number of ticks after
`htsw:main` runs. Tick advancement drives Pause Execution actions and repeating
functions. The default is `0`.

> `htsw run` is a limited local simulator, not a Housing server. It simulates
> variable operations and comparisons, control flow, function calls,
> variable/stat/random placeholders, chat output, pauses, and repeating
> functions. Other actions do nothing and other conditions resolve to false.

### `htsw upgrade [--force]`

Downloads the latest CLI build, verifies its checksum, and replaces the
installed command. Use `--force` to reinstall an already-current version.
