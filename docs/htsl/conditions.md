# Conditions

## List of Conditions

<!--- TOC -->

- [Has Group](#has-group)
- [Compare Variable](#compare-variable)
- [Has Permission](#has-permission)
- [In Region](#in-region)
- [Has Item](#has-item)
- [Doing Parkour](#doing-parkour)
- [Has Potion Effect](#has-potion-effect)
- [Is Sneaking](#is-sneaking)
- [Is Flying](#is-flying)
- [Health](#health)
- [Max Health](#max-health)
- [Hunger](#hunger)
- [Gamemode](#gamemode)
- [Placeholder](#placeholder)
- [Has Team](#has-team)
- [Damage Cause](#damage-cause)
- [Can PvP](#can-pvp)
- [Fishing Environment](#fishing-environment)
- [Portal Type](#portal-type)
- [Block Type](#block-type)
- [Is Item](#is-item)
- [Damage Amount](#damage-amount)

<!--- END -->

### Has Group

Requires the player to match a group.

#### Options

- **Required Group:** Any group in the Housing.
- **Include Higher Groups:** A boolean flag. When enabled, players in groups with a higher priority value
  than the required group will also be included.

#### HTSL

```htsl
~if (
hasGroup "Group Name"
~) {}
```

To also match groups with a higher priority value:

```htsl
~if (
hasGroup "Group Name" true
~) {}
```

---

### Compare Variable

Requires a variable to match the provided comparator.

#### Options

- **Holder:** A variable holder.

  When selected, the Team variable holder requires a secondary selection:
- **Team:** A selection of a team, or None.
- **Variable:** The name of the variable.
- **Comparator:** A [Comparator](#comparison-operators).
- **Compare Value:** A value. Supports placeholders.
- **Fallback Value:** A value that, if set, will be used for comparison against the compare value in
  place of the variable when no value exists.

#### HTSL

Use the `var` keyword for player variables:

```htsl
~if (
var x == 10
~) {}
```

`globalvar`:

```htsl
~if (
globalvar kills > 100
~) {}
```

`teamvar`:

```htsl
~if (
teamvar kills "Red Team" >= 50
~) {}
```

With Fallback Value:

```htsl
~if (
var score < 5 0
~) {}
```

---

### Has Permission

Requires the player to have a permission provided by their current group.

#### Options

- **Required Permission:** A selection of a permission.

  Permission is typed with a (case insensitive) identifier:

  | Permission             | Identifier             |
  | ---------------------- | ---------------------- |
  | Fly                    | Fly                    |
  | Wood Door              | Wood_Door              |
  | Iron Door              | Iron_Door              |
  | Wood Trap Door         | Wood_Trap_Door         |
  | Iron Trap Door         | Iron_Trap_Door         |
  | Fence Gate             | Fence_Gate             |
  | Button                 | Button                 |
  | Lever                  | Lever                  |
  | Use Launch Pads        | Use_Launch_Pads        |
  | /tp                    | "/tp"                  |
  | /tp Other Players      | "/tp Other Players"    |
  | Jukebox                | Jukebox                |
  | Kick                   | Kick                   |
  | Ban                    | Ban                    |
  | Mute                   | Mute                   |
  | Pet Spawning           | Pet_Spawning           |
  | Build                  | Build                  |
  | Offline Build          | Offline_Build          |
  | Fluid                  | Fluid                  |
  | Pro Tools              | Pro_Tools              |
  | Use Chests             | Use_Chests             |
  | Use Ender Chests       | Use_Ender_Chests       |
  | Item Editor            | Item_Editor            |
  | Switch Game Mode       | Switch_Game_Mode       |
  | Edit Variables         | Edit_Variables         |
  | Change Player Group    | Change_Player_Group    |
  | Change Gamerules       | Change_Gamerules       |
  | Housing Menu           | Housing_Menu           |
  | Team Chat Spy          | Team_Chat_Spy          |
  | Edit Actions           | Edit_Actions           |
  | Edit Regions           | Edit_Regions           |
  | Edit Scoreboard        | Edit_Scoreboard        |
  | Edit Event Actions     | Edit_Event_Actions     |
  | Edit Commands          | Edit_Commands          |
  | Edit Functions         | Edit_Functions         |
  | Edit Inventory Layouts | Edit_Inventory_Layouts |
  | Edit Teams             | Edit_Teams             |
  | Edit Custom Menus      | Edit_Custom_Menus      |
  | View Analytics         | View_Analytics         |
  | View Logger            | View_Logger            |
  | Item: Mailbox          | Item:_Mailbox          |
  | Item: Egg Hunt         | Item:_Egg_Hunt         |
  | Item: Teleport Pad     | Item:_Teleport_Pad     |
  | Item: Launch Pad       | Item:_Launch_Pad       |
  | Item: Action Pad       | Item:_Action_Pad       |
  | Item: Hologram         | Item:_Hologram         |
  | Item: NPCs             | Item:_NPCs             |
  | Item: Action Button    | Item:_Action_Button    |
  | Item: Leaderboard      | Item:_Leaderboard      |
  | Item: Trash Can        | Item:_Trash_Can        |
  | Item: Biome Stick      | Item:_Biome_Stick      |

#### HTSL

```htsl
~if (
hasPermission Fly
~) {}
```

---

### In Region

Requires the player's location to be within a region.

> A player can only be inside one region at once. The smaller region always
 takes precedence.

#### Options

- **Region:** A selection of a region.

#### HTSL

```htsl
~if (
inRegion "Spawn"
~) {}
```

---

### Has Item

Requires the player to have a certain item.

#### Options

- **Item:** The item stack.
- **What To Check:** A selection that determines how to decide whether an item matches the required
  item.

  1. Item Type (`Item_Type`): Any item with the same Minecraft item ID will match (e.g.
  `minecraft:stone`).
  2. Metadata (`Metadata`): The item must match the required item's metadata exactly.

  > Requiring the matching of metadata will require matching absolutely
  everything, including things like durability, making it unfeasible to have
  checks for breakable items.
- **Where To Check:** A selection that determines where the required item can be in the player's
  inventory.

  1. Hand (`Hand`): If the item is in the player's hand.
  2. Armor (`Armor`): If the item is in the player's armor slots.
  3. Hotbar (`Hotbar`): If the item is in the player's hotbar.
  4. Inventory (`Inventory`): If the item is in the player's inventory, excluding armor slots.
  5. Cursor (`Cursor`): If the player has currently picked up the item with their cursor
  while in their inventory.
  6. Crafting Grid (`Crafting_Grid`): If the item is in the player's 2x2 crafting grid.
  7. Anywhere (`Anywhere`): If the item is anywhere on the player.

  > Note that there is no way to check or modify the player's enderchest in any
  way. Only manually going into settings and clearing the player's data will
  result in the enderchest being cleared.
- **Required Amount:** A selection that determines the conditions for the stack size of the player's
  required item.

  1. Any Amount (`Any_Amount`): The player simply must have the required item, the stack count
  does not matter.
  2. Equal or Greater Amount (`Equal_or_Greater_Amount`): The item in the player's inventory's stack count
  must be greater than or equal to the stack count of the required item.

  > TODO: make sure the problem-solving documentation covers the implications of
  being unable to check for multiple stacks/weirdly split stacks of an item, and
  the workarounds (removing the item in binary batches to iteratively count and
  then giving it back afterwards)

#### HTSL

```htsl
~if (
hasItem "Item Name"
~) {}
```

To specify What to Check, Where to Check, and the Required Amount:

```htsl
~if (
hasItem "Item Name" Item_Type Hand Equal_or_Greater_Amount
~) {}
```

---

### Doing Parkour

Requires the player to have an active parkour run.

#### HTSL

```htsl
~if (
doingParkour
~) {}
```

---

### Has Potion Effect

Requires the player to have a potion effect.

#### Options

- **Effect:** A selection of a Minecraft potion effect.

  Effect is typed with a (case insensitive) identifier:

  | Effect          | Identifier      |
  | --------------- | --------------- |
  | Speed           | Speed           |
  | Slowness        | Slowness        |
  | Haste           | Haste           |
  | Mining Fatigue  | Mining_Fatigue  |
  | Strength        | Strength        |
  | Instant Health  | Instant_Health  |
  | Instant Damage  | Instant_Damage  |
  | Jump Boost      | Jump_Boost      |
  | Nausea          | Nausea          |
  | Regeneration    | Regeneration    |
  | Resistance      | Resistance      |
  | Fire Resistance | Fire_Resistance |
  | Water Breathing | Water_Breathing |
  | Invisibility    | Invisibility    |
  | Blindness       | Blindness       |
  | Night Vision    | Night_Vision    |
  | Hunger          | Hunger          |
  | Weakness        | Weakness        |
  | Poison          | Poison          |
  | Wither          | Wither          |
  | Health Boost    | Health_Boost    |
  | Absorption      | Absorption      |

#### HTSL

```htsl
~if (
hasPotion Speed
~) {}
```

---

### Is Sneaking

Requires the player to be currently sneaking.

#### HTSL

```htsl
~if (
isSneaking
~) {}
```

---

### Is Flying

Requires the player to be currently in flight mode.

#### HTSL

```htsl
~if (
isFlying
~) {}
```

---

### Health

Requires the player's current health to match a condition.

#### Options

- **Comparator:** A [Comparator](#comparison-operators).
- **Compare Value:** The value to compare the player's health to.

#### HTSL

```htsl
~if (
health < 10
~) {}
```

---

### Max Health

Requires the player's max health to match a condition.

#### Options

- **Comparator:** A [Comparator](#comparison-operators).
- **Compare Value:** The value to compare the player's max health to.

#### HTSL

```htsl
~if (
maxHealth == 20
~) {}
```

---

### Hunger

Requires the player's hunger level to match a condition.

#### Options

- **Comparator:** A [Comparator](#comparison-operators).
- **Compare Value:** The value to compare the player's hunger level to.

#### HTSL

```htsl
~if (
hunger > 10
~) {}
```

---

### Gamemode

Requires the player to be in a specific gamemode.

#### Options

- **Gamemode:** A selection of a gamemode.

  1. None
  2. Adventure
  3. Survival
  4. Creative

#### HTSL

```htsl
~if (
gamemode Creative
~) {}
```

---

### Placeholder

Requires a number placeholder to match a condition.

#### Options

- **Placeholder:** The placeholder to be compared against.
- **Comparator:** A [Comparator](#comparison-operators).
- **Compare Value:** A value.

#### HTSL

```htsl
~if (
placeholder %player.health% >= 20
~) {}
```

A fallback value can be provided for when the placeholder resolves to nothing:

```htsl
~if (
placeholder %var.player/kills% > 100 0
~) {}
```

---

### Has Team

Requires the player to be on a certain team.

#### Options

- **Required Team:** A selection of a team.

#### HTSL

```htsl
~if (
hasTeam "Red Team"
~) {}
```

---

### Damage Cause

Requires a damage cause to match.

#### Options

- **Cause:** A selection of a damage cause.

  Cause is typed with a (case insensitive) identifier:

  | Cause         | Identifier    |
  | ------------- | ------------- |
  | Entity Attack | Entity_Attack |
  | Projectile    | Projectile    |
  | Suffocation   | Suffocation   |
  | Fall          | Fall          |
  | Lava          | Lava          |
  | Fire          | Fire          |
  | Fire Tick     | Fire_Tick     |
  | Drowning      | Drowning      |
  | Starvation    | Starvation    |
  | Poison        | Poison        |
  | Thorns        | Thorns        |

#### HTSL

```htsl
~if (
damageCause Fall
~) {}
```

---

### Can PvP

Requires PvP to be enabled for the player.

#### HTSL

```htsl
~if (
canPvp
~) {}
```

---

### Fishing Environment

Requires the fishing environment to match.

#### Options

- **Environment:** A selection of a fishing environment.

  Environment is typed with a (case insensitive) identifier:

  | Environment | Identifier |
  | ----------- | ---------- |
  | Water       | Water      |
  | Lava        | Lava       |

#### HTSL

```htsl
~if (
fishingEnv Lava
~) {}
```

---

### Portal Type

Requires the portal type to match.

#### Options

- **Portal Type:** A selection of a portal type.

  Portal Type is typed with a (case insensitive) identifier:

  | Portal Type   | Identifier    |
  | ------------- | ------------- |
  | Nether Portal | Nether_Portal |
  | End Portal    | End_Portal    |

#### HTSL

```htsl
~if (
portal Nether_Portal
~) {}
```

---

### Block Type

Requires a block type to match.

#### Options

- **Item:** The block item.

#### HTSL

```htsl
~if (
blockType "Stone"
~) {}
```

---

### Is Item

Requires an item to match.

#### Options

- **Item:** The item stack.

#### HTSL

```htsl
~if (
isItem "Diamond Sword"
~) {}
```

---

### Damage Amount

Requires a damage amount to match a condition.

#### Options

- **Comparator:** A [Comparator](#comparison-operators).
- **Compare Value:** The value to compare the damage amount to.

#### HTSL

```htsl
~if (
damageAmount > 5
~) {}
```

---

## References

### Comparison Operators

Comparisons can be typed with either a symbol or identifier:

| Comparison            | Symbol | Identifier             |
| --------------------- | ------ | ---------------------- |
| Equal                 | ==     | Equal                  |
| Less Than             | <      | Less Than              |
| Less Than or Equal    | <=     | Less Than or Equal     |
| Greater Than          | >      | Greater Than           |
| Greater Than or Equal | >=     | Greater Than or Equal  |

---

### Inversion

Every condition can be inverted by prefixing it with `!`:

```htsl
~if (
!isSneaking
~) {}
```

```htsl
~if (
!gamemode Creative
~) {}
```

---

### Condition Notes

A condition can be annotated with a note by placing a `///` line above it inside
 the `if` block:

```htsl
if (
    /// must be a resident or higher
    hasGroup "Resident" true,
    /// no creative CHEATERS!!!
    !gamemode Creative
) {}
```

---
