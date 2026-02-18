# Items Support in import.json

This PR adds support for declaring items in `import.json` files.

## Usage Example

Create an `import.json` file with items:

```json
{
  "items": [
    {
      "key": "my_item",
      "nbt": "my_item.snbt",
      "rightClickActions": "actions.htsl"
    },
    {
      "key": "another_item",
      "nbt": "another_item.snbt",
      "leftClickActions": "left_click.htsl",
      "rightClickActions": "right_click.htsl"
    }
  ]
}
```

Create your SNBT file (e.g., `my_item.snbt`):
```
{id:"minecraft:diamond_sword",Count:1b,tag:{display:{Name:'{"text":"Custom Sword"}'}}}
```

Create your action files (e.g., `actions.htsl`):
```
chat "You clicked the item!"
```

## Fields

- `key` (required): String identifier to reference the item in HTSL files
- `nbt` (required): Path to the SNBT file containing the item data
- `leftClickActions` (optional): Path to HTSL file for left-click actions
- `rightClickActions` (optional): Path to HTSL file for right-click actions

## Implementation Details

The parser validates:
- File paths must end with `.snbt` extension for NBT files
- File paths must end with `.htsl` extension for action files
- All referenced files must exist
- The `key` and `nbt` fields are required
- The action fields are optional

Error messages are clear and include the specific file path when validation fails.
