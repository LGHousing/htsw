# VS Code Extension

HTSW++ adds project tools and editing help for HTSW files to Visual Studio Code.
It is useful even when you rarely edit `import.json` by hand.

## Installation

Install Visual Studio Code 1.97.2 or newer, then:

1. Download the latest `htsw-plus-plus-*.vsix` from the
   [HTSW releases](https://github.com/LGHousing/htsw/releases).
2. In VS Code, open the Extensions view, open its `...` menu, and choose
   **Install from VSIX...**.
3. Select the downloaded file and reload VS Code when prompted.

HTSW++ checks for updates automatically by default. You can also open the
Command Palette and run **HTSW: Check for Updates**.

## Open the HTSW tools

Open the folder containing your `import.json`, then select the HTSW icon in the
Activity Bar. The HTSW view has three tabs:

- **Importables** browses and changes the project.
- **Item / SNBT** creates and edits item files with a visual preview.
- **Sound Previewer** lets you hear and copy sound names.

> Many project actions are in the right-click menu. In particular, right-click
> a menu to add a slot or change its size.

## Common project tasks

### Create an importable

1. Open the **Importables** tab.
2. Select the `import.json` that should contain the new entry.
3. Select **Add importable** (`+`) at the top of the view.
4. Choose the type, enter its details, and select **Add**.

You can create functions, events, regions, items, menus, commands, and NPC
entries. Functions, events, and commands get a linked starter `.htsl` file.
Choosing **Item** opens the visual item editor instead.

The file picker also offers **New import.json...** when you want to put the
entry in a new included file.

### Create region enter and exit actions

When adding a region, use the **Starter HTSL** checkboxes to choose **On enter**,
**On exit**, or both. The extension creates the selected `.htsl` files and links
them through `onEnterActions` and `onExitActions`.

This creates an action-only region entry. Add the region's `bounds` in
`import.json` before importing it; the in-game importer uses those coordinates
to create or move the Housing region.

### Create NPC click actions

When adding an NPC, enter the NPC's name and exact X, Y, and Z coordinates. Use
the **Starter HTSL** checkboxes to create a left-click file, a right-click file,
or both.

HTSW cannot place an NPC for you. The NPC must already exist at those exact
coordinates in Housing or the importer will refuse the import.

### Add a menu slot

1. Right-click the menu in the **Importables** tree.
2. Choose **Add slot...** and enter the slot number. Slots start at `0`.
3. Choose **Item only** or **Item + actions**.

The extension adds the slot to `import.json`, creates its `.snbt` item file,
and opens the item editor. **Item + actions** also creates and links an empty
`.htsl` file for the slot.

Right-click the menu to use **Set size...**. Expand the menu and right-click an
existing slot to remove it.

### Organize the project

Use **New folder** at the top of the Importables view to create a folder with an
empty `import.json` and add it to the selected file's `include` list.

Right-click an importable to rename, move, delete, reveal, or copy its path.
You can select several importables before moving or deleting them. Moving
project files in VS Code's normal Explorer also updates their references in
`import.json`.

## Browse the project

The Importables tree follows every included `import.json`. Expand an importable
to see linked action and item files. Select a row to open its primary file;
select metadata such as an NPC position to reveal that field in `import.json`.

Use the search box to filter importables, and use the sort button to switch
between file order, name, and type. Error and warning badges come from the same
project-aware checks shown in the editor.

## Create and edit items

The **Item / SNBT** tab can set an item's type, count, display name, lore,
enchantments, and custom NBT. It shows both a Minecraft-style item preview and
the generated SNBT.

When adding an item to the project, choose its target `import.json` and whether
to create linked left-click or right-click action files.

To edit an existing item, do one of the following:

- Double-click its item row in the Importables tree.
- Right-click a `.snbt` file in VS Code's Explorer and choose
  **HTSW: Edit in Item Editor**.

Saving through the item editor preserves custom NBT that the form does not
directly expose.

## Preview sounds

The **Sound Previewer** can search Housing's 1.8 sound names, preview them at a
chosen pitch and volume, and copy the sound path for HTSL. Switch to **Modern**
to browse and preview modern sound events when you are building for newer
clients.

## Editing help

HTSW++ provides:

- Syntax highlighting for `.htsl` and `.snbt` files.
- Completions for HTSL actions, conditions, arguments, placeholders, project
  importables, item names, and sounds.
- Argument-name inlay hints for HTSL actions and conditions.
- Project-aware diagnostics for `import.json`, included action files, and
  `.snbt` files.
- Schema validation and completions for `import.json` and `*.import.json`.
- SNBT formatting and quick fixes for Minecraft formatting codes.

You can change HTSW++ settings by searching for `HTSW` in VS Code's Settings.
