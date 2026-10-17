# Actions

## List of Actions

<!--- TOC -->

- [Conditional](#conditional)
- [Change Player's Group](#change-players-group)
- [Kill Player](#kill-player)
- [Full Heal](#full-heal)
- [Display Title](#display-title)
- [Display Action Bar](#display-action-bar)
- [Reset Inventory](#reset-inventory)
- [Change Max Health](#change-max-health)
- [Parkour Checkpoint](#parkour-checkpoint)
- [Give Item](#give-item)
- [Remove Item](#remove-item)
- [Send a Chat Message](#send-a-chat-message)
- [Apply Potion Effect](#apply-potion-effect)
- [Clear All Potion Effects](#clear-all-potion-effects)
- [Give Experience Levels](#give-experience-levels)
- [Send to Lobby](#send-to-lobby)
- [Change Variable](#change-variable)
- [Exit](#exit)
- [Teleport Player](#teleport-player)
- [Cancel Event](#cancel-event)
- [Fail Parkour](#fail-parkour)
- [Play Sound](#play-sound)
- [Set Compass Target](#set-compass-target)
- [Set Gamemode](#set-gamemode)
- [Change Health](#change-health)
- [Change Hunger Level](#change-hunger-level)
- [Random Action](#random-action)
- [Trigger Function](#trigger-function)
- [Apply Inventory Layout](#apply-inventory-layout)
- [Enchant Held Item](#enchant-held-item)
- [Pause Execution](#pause-execution)
- [Set Player Team](#set-player-team)
- [Display Menu](#display-menu)
- [Close Menu](#close-menu)
- [Use/Remove Held Item](#useremove-held-item)
- [Drop Item](#drop-item)
- [Change Velocity](#change-velocity)
- [Launch to Target](#launch-to-target)
- [Set Player Weather](#set-player-weather)
- [Set Player Time](#set-player-time)
- [Toggle Nametag Display](#toggle-nametag-display)

<!--- END -->

### Conditional

Used to conditionally run a list of sub-actions.

#### Options

- **Conditions:** [Conditions](conditions.md) which are used to determine whether If Actions or
  Else Actions should be run. All of the Conditions need to yield true for the
  Conditional itself to succeed.
- **Match Any Condition:** A boolean flag. When enabled, only a single condition needs to match.
- **If Actions:** A list of sub-actions to be run if the conditional check succeeds.
- **Else Actions:** A list of sub-actions to be run if the conditional check fails.

#### HTSL

```htsl
~var x = 10
~var y = 10
if (var x > 5, var y > 5) {
    chat "x and y are greater than 5"
}
```

Match Any Condition is implicitly false. to set it explicitly, use `or` (true) 
 or `and` (false) before the Condition list:

```htsl
~var x = 0
~var y = 10
if or (var x > 5, var y > 5) {
    chat "x is greater than 5 or y is greater than 5"
}
```

To declare Else Actions, use the optional `else` keyword:

```htsl
~var x = 0
~var y = 10
~var z = 0
if (
    var x == 0,
    var y == 0,
    var z == 0,
) {
    chat "Position is at the origin"
} else {
    chat "Position is not at the origin"
}
```

---

### Change Player's group

Changes the player's group.

#### Options

- **Group:** The group's name.
- **Demotion Protection:** A boolean flag. When enabled, this action does not apply if the player already
  has a group with a higher priority.

#### HTSL

```htsl
changePlayerGroup "Winner"
```

---

To enable Demotion Protection:

```htsl
changePlayerGroup "Winner" true
```

---

### Kill Player

Kills the player.

> This action does not apply to players in Creative mode.

#### HTSL

```htsl
kill
```

---

### Full Heal

Restores all of the player's health.

#### HTSL

```htsl
fullHeal
```

---

### Display Title

Displays a [title](https://minecraft.wiki/w/Commands/title).

#### Options

- **Title:** Title text. Supports placeholders.
- **Subtitle:** Subtitle text. Supports placeholders.
- **Fadein:** The time in seconds to fade in the title.
- **Stay:** The time in seconds to stay on the title.
- **Fadeout:** The time in seconds to fade out the title.

#### HTSL

```htsl
title "Hello"
```

To set Subtitle:

```htsl
title "Hello" "World"
```

To set Fadein, Stay, and Fadeout:

```htsl
title "Hello" "World" 1 2 1
```

---

### Display Action Bar

Displays an [action bar](https://minecraft.wiki/w/Action_bar).

#### Options

- **Message:** Message text. Supports placeholders.

#### HTSL

```htsl
actionBar "Hello, World!"
```

---

### Reset Inventory

Resets the player's inventory.

If the player is in a region with PvP enabled, the Housing's PvP Layout is
 applied. Gives the player their Housing Menu. Gives the player their cookies if
 they are not the owner of the house.

#### HTSL

```htsl
resetInventory
```

---

### Change Max Health

Modifies the player's maximum health.

#### Options

- **Max Health:** A numeric value. Accepts placeholders.
- **Mode:** An [operation](#operations).
- **Heal On Change:** A boolean flag. When enabled, the player is healed to full health after their
  max health is changed.

#### HTSL

```htsl
// maxHealth <Mode> <Max Health> [Heal On Change]
maxHealth = 5 true
```

---

### Parkour Checkpoint

Teleports the player to their current parkour checkpoint, or the parkour start
 if the parkour is not currently active.

#### HTSL

```htsl
parkCheck
```

---

### Give Item

Gives the player an item.

#### Options

- **Item:** The item stack to give, containing up to 64 of the same item. Use an
  ITEM importable name, a [vanilla item name](../vanilla-item-names.md), or an
  `.snbt` path relative to this HTSL file. Add an
  [`@<count>` suffix](basic-syntax.md#stack-counts) to set the stack size, as in
  `oak_log@8`.
- **Allow Multiple:** A boolean flag. When disabled, if there is another item in the player's
  inventory with the exact same nbt, this action does nothing.
- **Inventory Slot:** A selection that determines where in the player's inventory to give the item.

  Inventory Slot can be typed with a (case insensitive) identifier or an index:

  | Inventory Slot       | Identifier           | Index |
  | -------------------- | -------------------- | ----- |
  | First Available Slot | First_Available_Slot | -1    |
  | Hand Slot            | Hand_Slot            | -2    |
  | Hotbar Slot          |                      | 0..8  |
  | Inventory Slot       |                      | 9..35 |
  | Boots                | Boots                | 36    |
  | Leggings             | Leggings             | 37    |
  | Chestplate           | Chestplate           | 38    |
  | Helmet               | Helmet               | 39    |
- **Replace Existing Item:** A boolean flag. When disabled, if there is already an item in the selected
  Inventory Slot, this action does nothing.

#### HTSL

```htsl
// giveItem <Item> [Allow Multiple] [Inventory Slot] [Replace Existing Item]
giveItem "Item Name" true First_Available_Slot false
```

---

### Remove Item

Removes an item from the player.

> Note that attempting to remove an item that does not exist in the player's
 inventory is known to cause performance issues. So, it is best practice to
 remove items only after we have run the [Has Item](conditions.md#has-item)
 condition.

#### Options

- **Item:** The item stack to remove, containing up to 64 of the same item. Use
  an ITEM importable name, a [vanilla item name](../vanilla-item-names.md), or an
  `.snbt` path relative to this HTSL file. Add an
  [`@<count>` suffix](basic-syntax.md#stack-counts) to set the stack size, as in
  `oak_log@8`.

#### HTSL

```htsl
removeItem "Item Name"
```

---

### Send a Chat Message

Sends a chat message to the player.

> This chat message can only be seen by the player who ran the action. For a
 global "announcement"-type message, some combination of this action and the
 [Trigger Function](#trigger-function) action with the Trigger For All Players
 flag enabled is usually necessary.

#### Options

- **Message:** A text input. Supports placeholders.

  > Max character limit of 256.

#### HTSL

```htsl
chat "Hello, World!"
```

---

### Apply Potion Effect

Applies a potion effect to the player.

#### Options

- **Effect:** A Minecraft potion effect.
- **Duration:** A numeric value.

  > This value must be within the range [1, 2592000].
- **Level:** A numeric value.

  > This value must be within the range [1, 10].
- **Override Existing Effects:** A boolean flag. When enabled, potion effects of the same type will be overriden
  by the applied effect.
- **Show Potion Icon:** A boolean flag. When enabled, players on Minecraft 1.9 or later will see the
  respective potion icon in the top right of their screen.

#### HTSL

```htsl
// applyPotion [Effect] [Duration] [Level] [Override Existing Effects] [Show Potion Icon]
applyPotion Speed 60 1 false true
```

---

### Clear All Potion Effects

Clears all potion effects applied to a player.

#### HTSL

```htsl
clearEffects
```

---

### Give Experience Levels

Gives the player experience.

> The lack of control over the experience progress as well as the lack of an
 operation option makes experience levels generally unsuitable for use as a
 "progression system" alone.

> Note that while this action can only increment your level, giving an amount
 that would cause the 32-bit integer limit to overflow will reset the player's
 experience levels to 0.

#### Options

- **Levels:** The amount of levels to give to the player. Supports placeholders.

  > This value must be within the range [1, 2147483647]

#### HTSL

```htsl
xpLevel 10
```

---

### Send to Lobby

Sends the player to a lobby.

> This action does not apply to the owner of the house.

#### Options

- **Location:** A selection that determines which lobby to send the player to.

  | Lobby           |
  | --------------- |
  | Main Lobby      |
  | Tournament Hall |
  | Blitz SG        |
  | The TNT Games   |
  | Mega Walls      |
  | Arcade Games    |
  | Cops and Crims  |
  | UHC Champions   |
  | Warlords        |
  | Smash Heroes    |
  | Housing         |
  | SkyWars         |
  | Speed UHC       |
  | Classic Games   |
  | Prototype       |
  | Bed Wars        |
  | Murder Mystery  |
  | Build Battle    |
  | Duels           |
  | Wool Games      |

  > When using this action to troll people, Cops and Crims, Warlords, and Smash
  Heroes are the best lobbies to send people to, because they force you to
  download a custom resource pack.

#### HTSL

```htsl
lobby Housing
```

---

### Change Variable

Changes a variable.

#### Options

- **Holder:** A variable holder.

  When selected, the Team variable holder requires a secondary selection:
- **Team:** A selection of a team, or None.
- **Variable:** A text input for the name of the variable being changed.
- **Operation:** A selection that determines how a value is modified.

  Operation can be typed with either a symbol or identifier:

  | Operation              | Symbol | Identifier             |
  | ---------------------- | ------ | ---------------------- |
  | Set                    | =      | Set                    |
  | Unset                  |        | Unset                  |
  | Increment              | +=     | Increment              |
  | Decrement              | -=     | Decrement              |
  | Multiply               | *=     | Multiply               |
  | Divide                 | /=     | Divide                 |
  | Bitwise AND            | &=     | Bitwise_AND            |
  | Bitwise OR             | \|=    | Bitwise_OR             |
  | Bitwise XOR            | ^=     | Bitwise_XOR            |
  | Left Shift             | <<=    | Left_Shift             |
  | Arithmetic Right Shift | >>=    | Arithmetic_Right_Shift |
  | Logical Right Shift    | >>>=   | Logical_Right_Shift    |

  > If Operation is Unset, the Value and Automatic Unset options are disabled.
- **Value:** A value. Supports placeholders.

  The length of the input must be within the range [1, 32] characters.

  Inputs that are not:

  - A Long literal
  - A Double literal
  - A placeholder

  Are automatically wrapped in quotes (").

  > Unless Operation is Set, Value must resolve to the same type as the current
  value when this action is run, otherwise an error will occur.

- **Automatic Unset:** A boolean flag. When enabled, values that are considered default will unset the variable automatically.

  > Default values include `0`, `0.0`, and `""`.

#### HTSL

Declare a Change Variable action starting with a keyword, `var`,
 `globalvar`, or `teamvar`, followed by the name of the variable. The aliases
 `stat`, `globalstat`, and `teamstat` are also supported, respectively.

Use the `var` keyword to declare a Change Variable action with the player
 holder.

```htsl
// var|stat <Variable> <Operation> <Value> [Automatic Unset]
stat x = 5 true
```

Change Variable Actions with the global and team holders can be declared
 similarly:

```htsl
// global variable x
// globalvar|globalstat <Variable> <Operation> <Value> [Automatic Unset]
globalstat x = 5 true

// team variable x for team Red
// teamvar|teamstat <Variable> <Team> <Operation> <Value> [Automatic Unset]
teamstat x Red = 5 true
```

---

### Exit

Stops the current action sequence.

> This action can only be used inside a [Conditional](#conditional) or
 [Random Action](#random-action).

#### HTSL

```htsl
exit
```

---

### Teleport Player

Teleports the player.

#### Options

- **Location:** A [Location](#locations). Determines the location the player is teleported to.

  > Invokers Location is identical to teleporting to `~ ~ ~`.
- **Prevent Teleport Inside Blocks:** A boolean flag. When enabled, teleports the player above the highest block on their xz coordinates if the player's teleport would result in them being inside a block.

#### HTSL

```htsl
tp Custom_Coordinates "0 0 0"
```

To enable Prevent Teleport Inside Blocks:

```htsl
tp Custom_Coordinates "0 0 0" true
```

---

### Cancel Event

Cancels the event that is currently running.

> This action can only be used in the Player Death, Fish Caught, Player Damage,
 Player Drop Item, Player Pick Up Item, Player Change Held Item, Player Toggle
 Sneak, and Player Toggle Flight events.

#### HTSL

```htsl
cancelEvent
```

---

### Fail Parkour

Ends the player's current parkour run with a provided reason.

#### Options

- **Reason:** A text input. Adds this reason text to the end of the following message: `&c&lParkour challenge failed! `

#### HTSL

```htsl
failParkour "Reason"
```

---

### Play Sound

Plays a sound with a custom pitch to the player.

#### Options

- **Sound:** The sound to be played. Can select from a list of sounds, or input a custom sound argument ID.
- **Volume:** The volume of a sound. Does not support placeholders.
- **Pitch:** The pitch of a sound. Does not support placeholders.
- **Location:** A [Location](#locations). The location to play the sound.

#### HTSL

```htsl
// sound [Sound] [Volume] [Pitch] [Location]
sound "note.pling" 0.7 1.0 House_Spawn_Location
```

---

### Set Compass Target

Sets the target location for any compass the player has.

#### Options

- **Location:** A [Location](#locations). The location to set the compass to.

#### HTSL

```htsl
compassTarget House_Spawn_Location
```

---

### Set Gamemode

Sets the gamemode of the player.

#### Options

- **Gamemode:** A selector. The gamemode to set the player to.

  1. None
  2. Adventure
  3. Survival
  4. Creative

#### HTSL

```htsl
gamemode Creative
```

---

### Change Health

Changes the health of the player.

#### Options

- **Health:** The value to change the player's health by. Supports longs or doubles. Supports placeholders.

  > Max value of 200.0, minimum value of 0.1.
- **Mode:** An [Operation](#operations). Determines how the health is changed.

#### HTSL

```htsl
changeHealth = 5
```

---

### Change Hunger Level

Changes the hunger level of the player.

#### Options

- **Level:** The value to change the player's hunger level by. Supports longs or doubles. Supports placeholders.

  > Max value of 20.0, minimum value of 0.0.
- **Mode:** An [Operation](#operations). Determines how the hunger level is changed.

#### HTSL

```htsl
hungerLevel = 5
```

---

### Random Action

Executes a single random action from the selected actions.

#### Options

- **Actions:** A list of sub-Actions from which a single random action is drawn.

#### HTSL

```htsl
random {
    var reward = 5
    var reward = 10
    var reward = 20
}
~chat "Reward: %var.player/reward%"
```

---

### Trigger Function

Triggers a function.

#### Options

- **Function:** A function to be triggered.
- **Trigger For All Players:** A boolean flag. When enabled, triggers the function for all players in the Housing, in a random order.

#### HTSL

```htsl
function "My Function"
```

To set Trigger For All Players:

```htsl
// Runs for all players in the Housing
function "My Function" true
```

---

### Apply Inventory Layout

Applys an inventory layout.

> The new inventory layout will replace all items in the player's inventory regardless if the new layout's items don't specifically conflict with each item's slot. However, unless the new inventory layout has armor, armor pieces will not be cleared.

#### Options

- **Layout:** The layout to be applied to the player.

#### HTSL

```htsl
applyLayout "PvP Layout"
```

---

### Enchant Held Item

Enchants the held item of the player.

#### Options

- **Enchantment:** The enchantment to be applied to the player's held item.
- **Level:** The level of enchantment to apply. Does not support placeholders.

  > Max value of 10, minimum value of 1.

#### HTSL

```htsl
enchant Sharpness 1
```

---

### Pause Execution

Waits a certain amount of ticks before executing following actions.

> TODO: Add more about the specific intricacies of pause actions with conditionals and etc.

#### Options

- **Ticks To Wait:** The amount of ticks to wait before continuing. 1 second is 20 ticks. Does not support placeholders.

#### HTSL

```htsl
pause 5
```

---

### Set Player Team

Sets the team of the player.

#### Options

- **Team:** The team to set the player to. Supports 'None'.

#### HTSL

```htsl
setTeam "Red Team"
```

---

### Display Menu

Displays a menu to the player.

#### Options

- **Menu:** The menu to display to the player.

#### HTSL

```htsl
displayMenu "My Menu"
```

---

### Close Menu

Closes the player's open menu.

> This action can only be used inside menu slot actions.

#### HTSL

```htsl
closeMenu
```

---

### Use/Remove Held Item

Uses or removes the player's held item.

> This action can only be used inside item actions.

#### HTSL

```htsl
consumeItem
```

---

### Drop Item

Drops an item at a specific location.

> If the item being dropped does not already have an empty ExtraAttributes tag, it will be given one when dropped, meaning it can break Has Item conditions or Remove Item actions.

#### Options

- **Item:** The item being dropped. An
  [`@<count>` suffix](basic-syntax.md#stack-counts) sets the stack size.
- **Location:** A [Location](#locations). The location that the item will be spawned at.
- **Drop Naturally:** A boolean flag. When enabled, the item will be dropped naturally in the world, having some slight randomness to its location.
- **Prevent Item Merging:** A boolean flag. When enabled, the item will not merge with other items on the ground.
- **Prioritize Player:** A boolean flag, disabled by default. When enabled, the player who triggered the action is prioritized for picking up the dropped item.
- **Fallback To Inventory:** A boolean flag, disabled by default. When enabled, the item is placed directly into the player's inventory instead of being dropped if it cannot be dropped.
- **Despawn Duration Ticks:** The number of ticks before the dropped item despawns. Defaults to 6000 (5 minutes). 1 second is 20 ticks.
- **Pickup Delay Ticks:** The number of ticks before the dropped item can be picked up. Defaults to 10.

#### HTSL

```htsl
// dropItem <item> <location> [dropNaturally] [disableMerging] [prioritizePlayer] [inventoryFallback] [despawnDurationTicks] [pickupDelayTicks]
dropItem "Item Name" Invokers_Location true true true true 6000 10
```

---

### Change Velocity

Sets the velocity of the player.

> Despite the name, there is no way to actually relatively change the velocity of the player using this action. The best alternative is to manually calculate the current velocity vector of the player, apply the change, and then set the player's velocity to the final vector.

#### Options

- **X Direction:** A value between -50 and 50. Supports longs and doubles. Supports placeholders.
- **Y Direction:** A value between -50 and 50. Supports longs and doubles. Supports placeholders.
- **Z Direction:** A value between -50 and 50. Supports longs and doubles. Supports placeholders.

#### HTSL

```htsl
changeVelocity 0 10 0
```

---

### Launch to Target

Launches the player towards a location.

#### Options

- **Target Location:** A [Location](#locations). The location to launch the player to.
- **Launch Strength:** A value representing the strength of the launch. Supports doubles and longs. Supports placeholders.

  > Max value of 20.0, minimum value of 0.0.

#### HTSL

```htsl
launchTarget Custom_Coordinates "~ ~10 ~" 3
```

### Set Player Weather

Changes the weather for the player. Will result in the weather being different than the world while set.

#### Options

- **Weather:** A selector. The weather to set the player's to.

  1. None
  2. Sunny
  3. Raining

#### HTSL

```htsl
playerWeather "Sunny"
```

---

### Set Player Time

Sets the time of the world for the provided player.

#### Options

- **Time:** The time to set the player to, if not set the player time will be reset to the world time. Also supports a custom time value (which supports placeholders).

  1. Reset to World Time
  2. Sunrise (0)
  3. Noon (6,000)
  4. Sunset (12,000)
  5. Midnight (18,000)

#### HTSL

```htsl
playerTime 1000
```

---

### Toggle Nametag Display

Toggles the display of the player's nametag.

#### Options

- **Display Nametag:** A boolean field. When enabled, shows the nametag of the player.

#### HTSL

```htsl
displayNametag false
```

---

## References

### Operations

Operations can be typed with either a symbol or identifier:

| Operation | Symbol | Identifier |
| ----------| ------ | ---------- |
| Set       | =      | Set        |
| Increment | +=     | Increment  |
| Decrement | -=     | Decrement  |
| Multiply  | *=     | Multiply   |
| Divide    | /=     | Divide     |

---

### Locations

Locations are typed with a (case insensitive) identifier:

| Location             | Identifier           |
| -------------------- | -------------------- |
| House Spawn Location | House_Spawn_Location |
| Invokers Location    | Invokers_Location    |
| Current Location     | Current_Location     |
| Custom Coordinates   | Custom_Coordinates   |

Custom Coordinates must be followed by a coordinate string.


##### Custom Coordinates

When selected, Custom Coordinates requires a secondary text prompt with your
 desired coordinates.

This text supports a three (position, `x y z`) or five (position + rotation,
 `x y z yaw pitch`) component location.

Components can be literal values (`1 2 3`), placeholders
 (`%var.player/a% %var.player/b% %var.player/c%`) or a mix of both.

###### Relative World Coordinates

When specifying the position coordinates, each coordinate can alternatively be
 expressed as a **relative world coordinate** (`~Δx ~Δy ~Δz`). A number
 following a tilde (~) describes an offset from the player's position along one
 of the world axes, and a lone tilde (`~ ~ ~`) assumes an offset of 0. Relative
 world coordinates can mix with absolute coordinates (`0 ~10 0`).

###### Local Coordinates

Another way to describe the position coordinates is with **local coordinates**
 (`^Δx_local ^Δy_local ^Δz_local`). Like relative coordinates, these describe
 positions relative to the player, but with different directions. A number
 following a caret (^) is an offset within a moving, player-centric frame:

 * `x_local` points to the player's left (sway).
 * `y_local` points upward (heave).
 * `z_local` points forward, in the direction the player faces (surge).

Local coordinates cannot be mixed with world coordinates (`^ 0 ^`, `^ 0 ~1`).

---

### Action Notes

An action can be annotated with a note by placing a `///` line above it.

```htsl
/// Clear the player's coins if they have more than 10
if (var coins > 10) {
    var coins = 0
}

/// You can see this note in-game!
chat "Hello, World"
```

Note that you will get an error for orphaned notes:

```htsl
var x = 5

/// Orphaned comment
```

---
