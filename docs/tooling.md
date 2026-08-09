# Tooling

HTSW has two tools for working on a project outside Minecraft:

- The [VS Code extension](./tooling/vscode-extension.md) is the easiest way to
  browse and edit a project. It can create importables and their files, edit
  items visually, preview sounds, and report problems while you type.
- The [CLI](./tooling/cli.md) checks a complete import and can run a limited
  local simulation from a terminal or script.

Both tools work with the same `import.json`, `.htsl`, and `.snbt` files. The
ChatTriggers module is still responsible for reading from and writing to a
live Housing server.
