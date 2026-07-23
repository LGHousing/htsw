# Tooling

HTSW comes with an official CLI for checking and running HTSW imports.

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

### `htsw check`

Parses and validates the `import.json` file in the CWD, or an `import.json`
 pointed to by the optional positional argument.

### `htsw run`

Runs the function `htsw:main` of the `import.json` file in the CWD, or an
 `import.json` pointed to by the optional positional argument.

The output of the
 [Send a Chat Message](./htsl/actions.md#send-a-chat-message)
 action is redirected to the standard output.

> Note that repeating functions are ignored in `htsw run`.

### `htsw upgrade`

Downloads the latest CLI build, verifies its checksum, and replaces the
installed command.
