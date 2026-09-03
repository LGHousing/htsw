# Basic Syntax

This is a collection of basic syntax elements with examples. You can find
 more examples in the [examples directory on GitHub](https://github.com/LGHousing/htsw/tree/main/examples).

## Comments

HTSL supports single-line (or **end-of-line**) and multi-line (**block**)
 comments.

```htsl
// This is an end-of-line comment

/* This is a block comment
   on multiple lines. */
```

## Actions

Every statement in HTSL represents an action.

Actions begin with a keyword and take a series of positional arguments:

```htsl
chat "Hello, World!"
tp Custom_Coordinates "0 0 0"
```

A newline terminates an action; All positional arguments must be on the same
 line.

You can find a detailed list of the syntax for all actions [here](actions.md).

## Conditions

Conditions in HTSL are declared with a keyword and positional arguments. They
 are always within a Conditional Action's Conditions list (`if (...)`), and are
 separated by commas.

They may be typed on a single line or multiple lines:

```htsl
if (var x == 5, var y == 5) {}
// or
if (
    var x == 5,
    var y == 5
) {}
```

You can find a detailed list of the syntax for all conditions
 [here](conditions.md).

## Item References

Any action or condition field that takes an item accepts one of three forms:

- an ITEM importable's `name`,
- a [vanilla item name](../vanilla-item-names.md), with or without the
  `minecraft:` prefix, and including damage variants such as `red_wool`,
- an `.snbt` path, resolved relative to the HTSL file the field is written in.

```htsl
giveItem "Magic Wand"
giveItem red_wool
giveItem items/magic_wand.snbt
```

### Stack Counts

Any of those may carry an `@<count>` suffix to give the stack a size, from 1 to
 64. The referenced item is unchanged; only the stack it is placed into differs,
 so one declaration covers every size you need:

```htsl
giveItem oak_log@8
giveItem "Magic Wand@2"
giveItem items/magic_wand.snbt@16
```

Because `@` delimits the count, an ITEM importable's `name` may not contain one.

The count has to be written out: Housing stores a fixed stack in the field, so
 it cannot be read from a variable. To hand out a variable amount, give the
 stack sizes that add up to it:

```htsl
if (var x >= 8) {
    giveItem oak_log@8
    var x -= 8
}
if (var x >= 4) {
    giveItem oak_log@4
    var x -= 4
}
if (var x >= 2) {
    giveItem oak_log@2
    var x -= 2
}
if (var x >= 1) {
    giveItem oak_log
    var x -= 1
}
```
