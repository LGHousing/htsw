# Splitting a Project with `include`

One import.json holding every function, region, item, and menu of a big house gets unmanageable. The `include` key lets the entry import.json pull in other import.json files, so a project can be organized as nested sub-projects — one folder per area of the house, each with its own import.json and its own .htsl files.

## The `include` key

```jsonc
// projects/MyHouse/import.json — the entry file
{
    "houseUuid": "01234567-89ab-cdef-0123-456789abcdef",
    "include": [
        "combat/import.json",
        "shops/import.json",
        "parkour/import.json"
    ],
    "events": [
        { "event": "Player Join", "actions": "join.htsl" }
    ]
}
```

```jsonc
// projects/MyHouse/combat/import.json
{
    "include": [
        "arenas/import.json"
    ],
    "functions": [
        { "name": "Give Kit", "actions": "give-kit.htsl" }
    ],
    "regions": [
        { "name": "Spawn Protection", "onEnterActions": "spawn-protect.htsl" }
    ]
}
```

The resulting folder tree:

```
MyHouse/
├── import.json          ← entry: house binding + includes
├── join.htsl
├── combat/
│   ├── import.json
│   ├── give-kit.htsl
│   ├── spawn-protect.htsl
│   └── arenas/
│       └── import.json
├── shops/
│   └── import.json
└── parkour/
    └── import.json
```

Loading the entry import.json loads everything: the parser follows includes recursively and merges every file's importables into one project. Import, export, diffing, and `htsw check` all operate on the merged result — you always point them at the **entry** file.

## Rules

- **Paths resolve relative to the including file's directory.** `combat/import.json` includes `arenas/import.json`, which resolves to `combat/arenas/import.json`. Every path *inside* an import.json (`actions`, snbt files, …) also resolves relative to its own file — so a sub-folder is self-contained and can be moved or copied between projects without rewriting paths.
- **Include paths must end in `import.json` or `.import.json`** (case-insensitive). Flat side-by-side files work too: `"include": ["combat.import.json"]`.
- **Includes nest to any depth.** Circular includes are an error (the diagnostic prints the cycle). Including the same file twice in one file is a warning; reaching the same file twice through different paths loads it once.
- **Only the entry file's `houseUuid` counts.** A `houseUuid` in an included file is ignored with a warning — but it applies when that file is parsed as the entry, so a sub-project can carry its own binding for standalone use.
- **A broken include is an error on the include entry**, pointing at the path that didn't resolve.

## In the GUI

The Importables pane mirrors the include structure: expanding the entry import.json shows its own importables at the top level, and each included file as a collapsible group, nested the same way the files nest on disk. Searching looks inside collapsed groups and expands the ones that match.

Queueing, importing, and exporting always go through the entry file — groups are a view of where things are declared, not separate projects.
