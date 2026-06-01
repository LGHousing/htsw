"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// dist/diagnostic.js
var Diagnostic = class _Diagnostic {
  message;
  level;
  spans;
  edits;
  subDiagnostics;
  constructor(message, level) {
    this.message = message;
    this.level = level;
    this.spans = [];
    this.edits = [];
    this.subDiagnostics = [];
  }
  static bugFromError(error) {
    const diag = new _Diagnostic(`Unexpected error: ${error.message}`, "bug");
    if (error.stack) {
      for (const line of error.stack.split("\n")) {
        diag.addSubDiagnostic(_Diagnostic.note(line));
      }
    }
    if (error.cause instanceof Error) {
      diag.addSubDiagnostic(_Diagnostic.bugFromError(error.cause));
    }
    return diag;
  }
  static bug(message) {
    return new _Diagnostic(message, "bug");
  }
  static error(message) {
    return new _Diagnostic(message, "error");
  }
  static warning(message) {
    return new _Diagnostic(message, "warning");
  }
  static note(message) {
    return new _Diagnostic(message, "note");
  }
  static help(message) {
    return new _Diagnostic(message, "help");
  }
  addPrimarySpan(span, label) {
    this.spans.push({ kind: "primary", span, label });
    return this;
  }
  addSecondarySpan(span, label) {
    this.spans.push({ kind: "secondary", span, label });
    return this;
  }
  addEdit(span, text) {
    this.edits.push({ span, text });
    return this;
  }
  addSubDiagnostic(diag) {
    this.subDiagnostics.push(diag);
    return this;
  }
};

// dist/assets/items.json
var items_default = [
  {
    id: 1,
    displayName: "Stone",
    name: "stone",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Stone"
      },
      {
        metadata: 1,
        displayName: "Granite"
      },
      {
        metadata: 2,
        displayName: "Polished Granite"
      },
      {
        metadata: 3,
        displayName: "Diorite"
      },
      {
        metadata: 4,
        displayName: "Polished Diorite"
      },
      {
        metadata: 5,
        displayName: "Andesite"
      },
      {
        metadata: 6,
        displayName: "Polished Andesite"
      }
    ]
  },
  {
    id: 2,
    displayName: "Grass Block",
    name: "grass",
    stackSize: 64
  },
  {
    id: 3,
    displayName: "Dirt",
    name: "dirt",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Dirt"
      },
      {
        metadata: 1,
        displayName: "Coarse Dirt"
      },
      {
        metadata: 2,
        displayName: "Podzol"
      }
    ]
  },
  {
    id: 4,
    displayName: "Cobblestone",
    name: "cobblestone",
    stackSize: 64
  },
  {
    id: 5,
    displayName: "Wooden Planks",
    name: "planks",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Oak Wood Planks"
      },
      {
        metadata: 1,
        displayName: "Spruce Wood Planks"
      },
      {
        metadata: 2,
        displayName: "Birch Wood Planks"
      },
      {
        metadata: 3,
        displayName: "Jungle Wood Planks"
      },
      {
        metadata: 4,
        displayName: "Acacia Wood Planks"
      },
      {
        metadata: 5,
        displayName: "Dark Oak Wood Planks"
      }
    ]
  },
  {
    id: 6,
    displayName: "Sapling",
    name: "sapling",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Oak Sapling"
      },
      {
        metadata: 1,
        displayName: "Spruce Sapling"
      },
      {
        metadata: 2,
        displayName: "Birch Sapling"
      },
      {
        metadata: 3,
        displayName: "Jungle Sapling"
      },
      {
        metadata: 4,
        displayName: "Acacia Sapling"
      },
      {
        metadata: 5,
        displayName: "Dark Oak Sapling"
      }
    ]
  },
  {
    id: 7,
    displayName: "Bedrock",
    name: "bedrock",
    stackSize: 64
  },
  {
    id: 12,
    displayName: "Sand",
    name: "sand",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Sand"
      },
      {
        metadata: 1,
        displayName: "Red Sand"
      }
    ]
  },
  {
    id: 13,
    displayName: "Gravel",
    name: "gravel",
    stackSize: 64
  },
  {
    id: 14,
    displayName: "Gold Ore",
    name: "gold_ore",
    stackSize: 64
  },
  {
    id: 15,
    displayName: "Iron Ore",
    name: "iron_ore",
    stackSize: 64
  },
  {
    id: 16,
    displayName: "Coal Ore",
    name: "coal_ore",
    stackSize: 64
  },
  {
    id: 17,
    displayName: "Wood",
    name: "log",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Oak Wood"
      },
      {
        metadata: 1,
        displayName: "Spruce Wood"
      },
      {
        metadata: 2,
        displayName: "Birch Wood"
      },
      {
        metadata: 3,
        displayName: "Jungle Wood"
      },
      {
        metadata: 4,
        displayName: "Acacia Wood"
      },
      {
        metadata: 5,
        displayName: "Dark Oak Wood"
      }
    ]
  },
  {
    id: 18,
    displayName: "Leaves",
    name: "leaves",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Oak Leaves"
      },
      {
        metadata: 1,
        displayName: "Spruce Leaves"
      },
      {
        metadata: 2,
        displayName: "Birch Leaves"
      },
      {
        metadata: 3,
        displayName: "Jungle Leaves"
      }
    ]
  },
  {
    id: 19,
    displayName: "Sponge",
    name: "sponge",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Sponge"
      },
      {
        metadata: 1,
        displayName: "Wet Sponge"
      }
    ]
  },
  {
    id: 20,
    displayName: "Glass",
    name: "glass",
    stackSize: 64
  },
  {
    id: 21,
    displayName: "Lapis Lazuli Ore",
    name: "lapis_ore",
    stackSize: 64
  },
  {
    id: 22,
    displayName: "Lapis Lazuli Block",
    name: "lapis_block",
    stackSize: 64
  },
  {
    id: 23,
    displayName: "Dispenser",
    name: "dispenser",
    stackSize: 64
  },
  {
    id: 24,
    displayName: "Sandstone",
    name: "sandstone",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Sandstone"
      },
      {
        metadata: 1,
        displayName: "Chiseled Sandstone"
      },
      {
        metadata: 2,
        displayName: "Smooth Sandstone"
      }
    ]
  },
  {
    id: 25,
    displayName: "Note Block",
    name: "noteblock",
    stackSize: 64
  },
  {
    id: 27,
    displayName: "Powered Rail",
    name: "golden_rail",
    stackSize: 64
  },
  {
    id: 28,
    displayName: "Detector Rail",
    name: "detector_rail",
    stackSize: 64
  },
  {
    id: 29,
    displayName: "Sticky Piston",
    name: "sticky_piston",
    stackSize: 64
  },
  {
    id: 30,
    displayName: "Cobweb",
    name: "web",
    stackSize: 64
  },
  {
    id: 31,
    displayName: "Grass",
    name: "tallgrass",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Shrub"
      },
      {
        metadata: 1,
        displayName: "Tall Grass"
      },
      {
        metadata: 2,
        displayName: "Fern"
      }
    ]
  },
  {
    id: 32,
    displayName: "Dead Bush",
    name: "deadbush",
    stackSize: 64
  },
  {
    id: 33,
    displayName: "Piston",
    name: "piston",
    stackSize: 64
  },
  {
    id: 35,
    displayName: "Wool",
    name: "wool",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "White Wool"
      },
      {
        metadata: 1,
        displayName: "Orange Wool"
      },
      {
        metadata: 2,
        displayName: "Magenta Wool"
      },
      {
        metadata: 3,
        displayName: "Light blue Wool"
      },
      {
        metadata: 4,
        displayName: "Yellow Wool"
      },
      {
        metadata: 5,
        displayName: "Lime Wool"
      },
      {
        metadata: 6,
        displayName: "Pink Wool"
      },
      {
        metadata: 7,
        displayName: "Gray Wool"
      },
      {
        metadata: 8,
        displayName: "Light gray Wool"
      },
      {
        metadata: 9,
        displayName: "Cyan Wool"
      },
      {
        metadata: 10,
        displayName: "Purple Wool"
      },
      {
        metadata: 11,
        displayName: "Blue Wool"
      },
      {
        metadata: 12,
        displayName: "Brown Wool"
      },
      {
        metadata: 13,
        displayName: "Green Wool"
      },
      {
        metadata: 14,
        displayName: "Red Wool"
      },
      {
        metadata: 15,
        displayName: "Black Wool"
      }
    ]
  },
  {
    id: 37,
    displayName: "Dandelion",
    name: "yellow_flower",
    stackSize: 64
  },
  {
    id: 38,
    displayName: "Poppy",
    name: "red_flower",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Poppy"
      },
      {
        metadata: 1,
        displayName: "Blue Orchid"
      },
      {
        metadata: 2,
        displayName: "Allium"
      },
      {
        metadata: 3,
        displayName: "Azure Bluet"
      },
      {
        metadata: 4,
        displayName: "Red Tulip"
      },
      {
        metadata: 5,
        displayName: "Orange Tulip"
      },
      {
        metadata: 6,
        displayName: "White Tulip"
      },
      {
        metadata: 7,
        displayName: "Pink Tulip"
      },
      {
        metadata: 8,
        displayName: "Oxeye Daisy"
      }
    ]
  },
  {
    id: 39,
    displayName: "Brown Mushroom",
    name: "brown_mushroom",
    stackSize: 64
  },
  {
    id: 40,
    displayName: "Red Mushroom",
    name: "red_mushroom",
    stackSize: 64
  },
  {
    id: 41,
    displayName: "Block of Gold",
    name: "gold_block",
    stackSize: 64
  },
  {
    id: 42,
    displayName: "Block of Iron",
    name: "iron_block",
    stackSize: 64
  },
  {
    id: 44,
    displayName: "Stone Slab",
    name: "stone_slab",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Stone Slab"
      },
      {
        metadata: 1,
        displayName: "Sandstone Slab"
      },
      {
        metadata: 2,
        displayName: "Wooden Slab"
      },
      {
        metadata: 3,
        displayName: "Cobblestone Slab"
      },
      {
        metadata: 4,
        displayName: "Bricks Slab"
      },
      {
        metadata: 5,
        displayName: "Stone Bricks Slab"
      },
      {
        metadata: 6,
        displayName: "Nether Brick Slab"
      },
      {
        metadata: 7,
        displayName: "Quartz Slab"
      }
    ]
  },
  {
    id: 45,
    displayName: "Brick",
    name: "brick_block",
    stackSize: 64
  },
  {
    id: 46,
    displayName: "TNT",
    name: "tnt",
    stackSize: 64
  },
  {
    id: 47,
    displayName: "Bookshelf",
    name: "bookshelf",
    stackSize: 64
  },
  {
    id: 48,
    displayName: "Moss Stone",
    name: "mossy_cobblestone",
    stackSize: 64
  },
  {
    id: 49,
    displayName: "Obsidian",
    name: "obsidian",
    stackSize: 64
  },
  {
    id: 50,
    displayName: "Torch",
    name: "torch",
    stackSize: 64
  },
  {
    id: 52,
    displayName: "Monster Spawner",
    name: "mob_spawner",
    stackSize: 64
  },
  {
    id: 53,
    displayName: "Oak Wood Stairs",
    name: "oak_stairs",
    stackSize: 64
  },
  {
    id: 54,
    displayName: "Chest",
    name: "chest",
    stackSize: 64
  },
  {
    id: 56,
    displayName: "Diamond Ore",
    name: "diamond_ore",
    stackSize: 64
  },
  {
    id: 57,
    displayName: "Block of Diamond",
    name: "diamond_block",
    stackSize: 64
  },
  {
    id: 58,
    displayName: "Crafting Table",
    name: "crafting_table",
    stackSize: 64
  },
  {
    id: 60,
    displayName: "Farmland",
    name: "farmland",
    stackSize: 64
  },
  {
    id: 61,
    displayName: "Furnace",
    name: "furnace",
    stackSize: 64
  },
  {
    id: 65,
    displayName: "Ladder",
    name: "ladder",
    stackSize: 64
  },
  {
    id: 66,
    displayName: "Rail",
    name: "rail",
    stackSize: 64
  },
  {
    id: 67,
    displayName: "Cobblestone Stairs",
    name: "stone_stairs",
    stackSize: 64
  },
  {
    id: 69,
    displayName: "Lever",
    name: "lever",
    stackSize: 64
  },
  {
    id: 70,
    displayName: "Stone Pressure Plate",
    name: "stone_pressure_plate",
    stackSize: 64
  },
  {
    id: 72,
    displayName: "Wooden Pressure Plate",
    name: "wooden_pressure_plate",
    stackSize: 64
  },
  {
    id: 73,
    displayName: "Redstone Ore",
    name: "redstone_ore",
    stackSize: 64
  },
  {
    id: 76,
    displayName: "Redstone Torch",
    name: "redstone_torch",
    stackSize: 64
  },
  {
    id: 77,
    displayName: "Stone Button",
    name: "stone_button",
    stackSize: 64
  },
  {
    id: 78,
    displayName: "Snow",
    name: "snow_layer",
    stackSize: 64
  },
  {
    id: 79,
    displayName: "Ice",
    name: "ice",
    stackSize: 64
  },
  {
    id: 80,
    displayName: "Snow",
    name: "snow",
    stackSize: 64
  },
  {
    id: 81,
    displayName: "Cactus",
    name: "cactus",
    stackSize: 64
  },
  {
    id: 82,
    displayName: "Clay",
    name: "clay",
    stackSize: 64
  },
  {
    id: 84,
    displayName: "Jukebox",
    name: "jukebox",
    stackSize: 64
  },
  {
    id: 85,
    displayName: "Oak Fence",
    name: "fence",
    stackSize: 64
  },
  {
    id: 86,
    displayName: "Pumpkin",
    name: "pumpkin",
    stackSize: 64
  },
  {
    id: 87,
    displayName: "Netherrack",
    name: "netherrack",
    stackSize: 64
  },
  {
    id: 88,
    displayName: "Soul Sand",
    name: "soul_sand",
    stackSize: 64
  },
  {
    id: 89,
    displayName: "Glowstone",
    name: "glowstone",
    stackSize: 64
  },
  {
    id: 91,
    displayName: "Jack o'Lantern",
    name: "lit_pumpkin",
    stackSize: 64
  },
  {
    id: 95,
    displayName: "Stained Glass",
    name: "stained_glass",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "White Stained Glass"
      },
      {
        metadata: 1,
        displayName: "Orange Stained Glass"
      },
      {
        metadata: 2,
        displayName: "Magenta Stained Glass"
      },
      {
        metadata: 3,
        displayName: "Light Blue Stained Glass"
      },
      {
        metadata: 4,
        displayName: "Yellow Stained Glass"
      },
      {
        metadata: 5,
        displayName: "Lime Stained Glass"
      },
      {
        metadata: 6,
        displayName: "Pink Stained Glass"
      },
      {
        metadata: 7,
        displayName: "Gray Stained Glass"
      },
      {
        metadata: 8,
        displayName: "Light Gray Stained Glass"
      },
      {
        metadata: 9,
        displayName: "Cyan Stained Glass"
      },
      {
        metadata: 10,
        displayName: "Purple Stained Glass"
      },
      {
        metadata: 11,
        displayName: "Blue Stained Glass"
      },
      {
        metadata: 12,
        displayName: "Brown Stained Glass"
      },
      {
        metadata: 13,
        displayName: "Green Stained Glass"
      },
      {
        metadata: 14,
        displayName: "Red Stained Glass"
      },
      {
        metadata: 15,
        displayName: "Black Stained Glass"
      }
    ]
  },
  {
    id: 96,
    displayName: "Wooden Trapdoor",
    name: "trapdoor",
    stackSize: 64
  },
  {
    id: 97,
    displayName: "Monster Egg",
    name: "monster_egg",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Stone Monster Egg"
      },
      {
        metadata: 1,
        displayName: "Cobblestone Monster Egg"
      },
      {
        metadata: 2,
        displayName: "Stone Brick Monster Egg"
      },
      {
        metadata: 3,
        displayName: "Mossy Stone Brick Monster Egg"
      },
      {
        metadata: 4,
        displayName: "Cracked Stone Brick Monster Egg"
      },
      {
        metadata: 5,
        displayName: "Chiseled Stone Brick Monster Egg"
      }
    ]
  },
  {
    id: 98,
    displayName: "Stone Bricks",
    name: "stonebrick",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Stone Bricks"
      },
      {
        metadata: 1,
        displayName: "Mossy Stone Bricks"
      },
      {
        metadata: 2,
        displayName: "Cracked Stone Bricks"
      },
      {
        metadata: 3,
        displayName: "Chiseled Stone Bricks"
      }
    ]
  },
  {
    id: 99,
    displayName: "Brown Mushroom Block",
    name: "brown_mushroom_block",
    stackSize: 64
  },
  {
    id: 100,
    displayName: "Red Mushroom Block",
    name: "red_mushroom_block",
    stackSize: 64
  },
  {
    id: 101,
    displayName: "Iron Bars",
    name: "iron_bars",
    stackSize: 64
  },
  {
    id: 102,
    displayName: "Glass Pane",
    name: "glass_pane",
    stackSize: 64
  },
  {
    id: 103,
    displayName: "Melon",
    name: "melon_block",
    stackSize: 64
  },
  {
    id: 106,
    displayName: "Vines",
    name: "vine",
    stackSize: 64
  },
  {
    id: 107,
    displayName: "Oak Fence Gate",
    name: "fence_gate",
    stackSize: 64
  },
  {
    id: 108,
    displayName: "Brick Stairs",
    name: "brick_stairs",
    stackSize: 64
  },
  {
    id: 109,
    displayName: "Stone Brick Stairs",
    name: "stone_brick_stairs",
    stackSize: 64
  },
  {
    id: 110,
    displayName: "Mycelium",
    name: "mycelium",
    stackSize: 64
  },
  {
    id: 111,
    displayName: "Lily Pad",
    name: "waterlily",
    stackSize: 64
  },
  {
    id: 112,
    displayName: "Nether Brick",
    name: "nether_brick",
    stackSize: 64
  },
  {
    id: 113,
    displayName: "Nether Brick Fence",
    name: "nether_brick_fence",
    stackSize: 64
  },
  {
    id: 114,
    displayName: "Nether Brick Stairs",
    name: "nether_brick_stairs",
    stackSize: 64
  },
  {
    id: 116,
    displayName: "Enchantment Table",
    name: "enchanting_table",
    stackSize: 64
  },
  {
    id: 120,
    displayName: "End Portal Frame",
    name: "end_portal_frame",
    stackSize: 64
  },
  {
    id: 121,
    displayName: "End Stone",
    name: "end_stone",
    stackSize: 64
  },
  {
    id: 122,
    displayName: "Dragon Egg",
    name: "dragon_egg",
    stackSize: 64
  },
  {
    id: 123,
    displayName: "Redstone Lamp",
    name: "redstone_lamp",
    stackSize: 64
  },
  {
    id: 126,
    displayName: "Wood Slab",
    name: "wooden_slab",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Oak Wood Slab"
      },
      {
        metadata: 1,
        displayName: "Spruce Wood Slab"
      },
      {
        metadata: 2,
        displayName: "Birch Wood Slab"
      },
      {
        metadata: 3,
        displayName: "Jungle Wood Slab"
      },
      {
        metadata: 4,
        displayName: "Acacia Wood Slab"
      },
      {
        metadata: 5,
        displayName: "Dark Oak Wood Slab"
      }
    ]
  },
  {
    id: 128,
    displayName: "Sandstone Stairs",
    name: "sandstone_stairs",
    stackSize: 64
  },
  {
    id: 129,
    displayName: "Emerald Ore",
    name: "emerald_ore",
    stackSize: 64
  },
  {
    id: 130,
    displayName: "Ender Chest",
    name: "ender_chest",
    stackSize: 64
  },
  {
    id: 131,
    displayName: "Tripwire Hook",
    name: "tripwire_hook",
    stackSize: 64
  },
  {
    id: 133,
    displayName: "Block of Emerald",
    name: "emerald_block",
    stackSize: 64
  },
  {
    id: 134,
    displayName: "Spruce Wood Stairs",
    name: "spruce_stairs",
    stackSize: 64
  },
  {
    id: 135,
    displayName: "Birch Wood Stairs",
    name: "birch_stairs",
    stackSize: 64
  },
  {
    id: 136,
    displayName: "Jungle Wood Stairs",
    name: "jungle_stairs",
    stackSize: 64
  },
  {
    id: 137,
    displayName: "Command Block",
    name: "command_block",
    stackSize: 64
  },
  {
    id: 138,
    displayName: "Beacon",
    name: "beacon",
    stackSize: 64
  },
  {
    id: 139,
    displayName: "Cobblestone Wall",
    name: "cobblestone_wall",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Cobblestone Wall"
      },
      {
        metadata: 1,
        displayName: "Mossy Cobblestone Wall"
      }
    ]
  },
  {
    id: 143,
    displayName: "Wooden Button",
    name: "wooden_button",
    stackSize: 64
  },
  {
    id: 145,
    displayName: "Anvil",
    name: "anvil",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Anvil"
      },
      {
        metadata: 1,
        displayName: "Slightly Damaged Anvil"
      },
      {
        metadata: 2,
        displayName: "Very Damaged Anvil"
      }
    ]
  },
  {
    id: 146,
    displayName: "Trapped Chest",
    name: "trapped_chest",
    stackSize: 64
  },
  {
    id: 147,
    displayName: "Weighted Pressure Plate (Light)",
    name: "light_weighted_pressure_plate",
    stackSize: 64
  },
  {
    id: 148,
    displayName: "Weighted Pressure Plate (Heavy)",
    name: "heavy_weighted_pressure_plate",
    stackSize: 64
  },
  {
    id: 151,
    displayName: "Daylight Detector",
    name: "daylight_detector",
    stackSize: 64
  },
  {
    id: 152,
    displayName: "Block of Redstone",
    name: "redstone_block",
    stackSize: 64
  },
  {
    id: 153,
    displayName: "Nether Quartz",
    name: "quartz_ore",
    stackSize: 64
  },
  {
    id: 154,
    displayName: "Hopper",
    name: "hopper",
    stackSize: 64
  },
  {
    id: 155,
    displayName: "Block of Quartz",
    name: "quartz_block",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Block of Quartz"
      },
      {
        metadata: 1,
        displayName: "Chiseled Quartz Block"
      },
      {
        metadata: 2,
        displayName: "Pillar Quartz Block"
      }
    ]
  },
  {
    id: 156,
    displayName: "Quartz Stairs",
    name: "quartz_stairs",
    stackSize: 64
  },
  {
    id: 157,
    displayName: "Activator Rail",
    name: "activator_rail",
    stackSize: 64
  },
  {
    id: 158,
    displayName: "Dropper",
    name: "dropper",
    stackSize: 64
  },
  {
    id: 159,
    displayName: "Stained Clay",
    name: "stained_hardened_clay",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "White Stained Clay"
      },
      {
        metadata: 1,
        displayName: "Orange Stained Clay"
      },
      {
        metadata: 2,
        displayName: "Magenta Stained Clay"
      },
      {
        metadata: 3,
        displayName: "Light Blue Stained Clay"
      },
      {
        metadata: 4,
        displayName: "Yellow Stained Clay"
      },
      {
        metadata: 5,
        displayName: "Lime Stained Clay"
      },
      {
        metadata: 6,
        displayName: "Pink Stained Clay"
      },
      {
        metadata: 7,
        displayName: "Gray Stained Clay"
      },
      {
        metadata: 8,
        displayName: "Light Gray Stained Clay"
      },
      {
        metadata: 9,
        displayName: "Cyan Stained Clay"
      },
      {
        metadata: 10,
        displayName: "Purple Stained Clay"
      },
      {
        metadata: 11,
        displayName: "Blue Stained Clay"
      },
      {
        metadata: 12,
        displayName: "Brown Stained Clay"
      },
      {
        metadata: 13,
        displayName: "Green Stained Clay"
      },
      {
        metadata: 14,
        displayName: "Red Stained Clay"
      },
      {
        metadata: 15,
        displayName: "Black Stained Clay"
      }
    ]
  },
  {
    id: 160,
    displayName: "Stained Glass Pane",
    name: "stained_glass_pane",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "White Stained Glass Pane"
      },
      {
        metadata: 1,
        displayName: "Orange Stained Glass Pane"
      },
      {
        metadata: 2,
        displayName: "Magenta Stained Glass Pane"
      },
      {
        metadata: 3,
        displayName: "Light Blue Stained Glass Pane"
      },
      {
        metadata: 4,
        displayName: "Yellow Stained Glass Pane"
      },
      {
        metadata: 5,
        displayName: "Lime Stained Glass Pane"
      },
      {
        metadata: 6,
        displayName: "Pink Stained Glass Pane"
      },
      {
        metadata: 7,
        displayName: "Gray Stained Glass Pane"
      },
      {
        metadata: 8,
        displayName: "Light Gray Stained Glass Pane"
      },
      {
        metadata: 9,
        displayName: "Cyan Stained Glass Pane"
      },
      {
        metadata: 10,
        displayName: "Purple Stained Glass Pane"
      },
      {
        metadata: 11,
        displayName: "Blue Stained Glass Pane"
      },
      {
        metadata: 12,
        displayName: "Brown Stained Glass Pane"
      },
      {
        metadata: 13,
        displayName: "Green Stained Glass Pane"
      },
      {
        metadata: 14,
        displayName: "Red Stained Glass Pane"
      },
      {
        metadata: 15,
        displayName: "Black Stained Glass Pane"
      }
    ]
  },
  {
    id: 161,
    displayName: "Leaves",
    name: "leaves2",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Acacia Leaves"
      },
      {
        metadata: 1,
        displayName: "Dark Oak Leaves"
      }
    ]
  },
  {
    id: 162,
    displayName: "Wood",
    name: "log2",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Acacia Wood"
      },
      {
        metadata: 1,
        displayName: "Dark Oak Wood"
      }
    ]
  },
  {
    id: 163,
    displayName: "Acacia Wood Stairs",
    name: "acacia_stairs",
    stackSize: 64
  },
  {
    id: 164,
    displayName: "Dark Oak Wood Stairs",
    name: "dark_oak_stairs",
    stackSize: 64
  },
  {
    id: 165,
    displayName: "Slime Block",
    name: "slime",
    stackSize: 64
  },
  {
    id: 166,
    displayName: "Barrier",
    name: "barrier",
    stackSize: 64
  },
  {
    id: 167,
    displayName: "Iron Trapdoor",
    name: "iron_trapdoor",
    stackSize: 64
  },
  {
    id: 168,
    displayName: "Prismarine",
    name: "prismarine",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Prismarine"
      },
      {
        metadata: 1,
        displayName: "Prismarine Bricks"
      },
      {
        metadata: 2,
        displayName: "Dark Prismarine"
      }
    ]
  },
  {
    id: 169,
    displayName: "Sea Lantern",
    name: "sea_lantern",
    stackSize: 64
  },
  {
    id: 170,
    displayName: "Hay Bale",
    name: "hay_block",
    stackSize: 64
  },
  {
    id: 171,
    displayName: "Carpet",
    name: "carpet",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "White Carpet"
      },
      {
        metadata: 1,
        displayName: "Orange Carpet"
      },
      {
        metadata: 2,
        displayName: "Magenta Carpet"
      },
      {
        metadata: 3,
        displayName: "Light Blue Carpet"
      },
      {
        metadata: 4,
        displayName: "Yellow Carpet"
      },
      {
        metadata: 5,
        displayName: "Lime Carpet"
      },
      {
        metadata: 6,
        displayName: "Pink Carpet"
      },
      {
        metadata: 7,
        displayName: "Gray Carpet"
      },
      {
        metadata: 8,
        displayName: "Light Gray Carpet"
      },
      {
        metadata: 9,
        displayName: "Cyan Carpet"
      },
      {
        metadata: 10,
        displayName: "Purple Carpet"
      },
      {
        metadata: 11,
        displayName: "Blue Carpet"
      },
      {
        metadata: 12,
        displayName: "Brown Carpet"
      },
      {
        metadata: 13,
        displayName: "Green Carpet"
      },
      {
        metadata: 14,
        displayName: "Red Carpet"
      },
      {
        metadata: 15,
        displayName: "Black Carpet"
      }
    ]
  },
  {
    id: 172,
    displayName: "Hardened Clay",
    name: "hardened_clay",
    stackSize: 64
  },
  {
    id: 173,
    displayName: "Block of Coal",
    name: "coal_block",
    stackSize: 64
  },
  {
    id: 174,
    displayName: "Packed Ice",
    name: "packed_ice",
    stackSize: 64
  },
  {
    id: 175,
    displayName: "Large Flowers",
    name: "double_plant",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Sunflower"
      },
      {
        metadata: 1,
        displayName: "Lilac"
      },
      {
        metadata: 2,
        displayName: "Double Tallgrass"
      },
      {
        metadata: 3,
        displayName: "Large Fern"
      },
      {
        metadata: 4,
        displayName: "Rose Bush"
      },
      {
        metadata: 5,
        displayName: "Peony"
      }
    ]
  },
  {
    id: 179,
    displayName: "Red Sandstone",
    name: "red_sandstone",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Red Sandstone"
      },
      {
        metadata: 1,
        displayName: "Chiseled Red Sandstone"
      },
      {
        metadata: 2,
        displayName: "Smooth Red Sandstone"
      }
    ]
  },
  {
    id: 180,
    displayName: "Red Sandstone Stairs",
    name: "red_sandstone_stairs",
    stackSize: 64
  },
  {
    id: 182,
    displayName: "Red Sandstone Slab",
    name: "stone_slab2",
    stackSize: 64
  },
  {
    id: 183,
    displayName: "Spruce Fence Gate",
    name: "spruce_fence_gate",
    stackSize: 64
  },
  {
    id: 184,
    displayName: "Birch Fence Gate",
    name: "birch_fence_gate",
    stackSize: 64
  },
  {
    id: 185,
    displayName: "Jungle Fence Gate",
    name: "jungle_fence_gate",
    stackSize: 64
  },
  {
    id: 186,
    displayName: "Dark Oak Fence Gate",
    name: "dark_oak_fence_gate",
    stackSize: 64
  },
  {
    id: 187,
    displayName: "Acacia Fence Gate",
    name: "acacia_fence_gate",
    stackSize: 64
  },
  {
    id: 188,
    displayName: "Spruce Fence",
    name: "spruce_fence",
    stackSize: 64
  },
  {
    id: 189,
    displayName: "Birch Fence",
    name: "birch_fence",
    stackSize: 64
  },
  {
    id: 190,
    displayName: "Jungle Fence",
    name: "jungle_fence",
    stackSize: 64
  },
  {
    id: 191,
    displayName: "Dark Oak Fence",
    name: "dark_oak_fence",
    stackSize: 64
  },
  {
    id: 192,
    displayName: "Acacia Fence",
    name: "acacia_fence",
    stackSize: 64
  },
  {
    id: 256,
    displayName: "Iron Shovel",
    name: "iron_shovel",
    stackSize: 1,
    maxDurability: 250,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 257,
    displayName: "Iron Pickaxe",
    name: "iron_pickaxe",
    stackSize: 1,
    maxDurability: 250,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 258,
    displayName: "Iron Axe",
    name: "iron_axe",
    stackSize: 1,
    maxDurability: 250,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 259,
    displayName: "Flint and Steel",
    name: "flint_and_steel",
    stackSize: 1,
    maxDurability: 64,
    enchantCategories: [
      "breakable",
      "vanishable"
    ]
  },
  {
    id: 260,
    displayName: "Apple",
    name: "apple",
    stackSize: 64
  },
  {
    id: 261,
    displayName: "Bow",
    name: "bow",
    stackSize: 1,
    maxDurability: 384,
    enchantCategories: [
      "breakable",
      "bow",
      "vanishable"
    ]
  },
  {
    id: 262,
    displayName: "Arrow",
    name: "arrow",
    stackSize: 64
  },
  {
    id: 263,
    displayName: "Coal",
    name: "coal",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Coal"
      },
      {
        metadata: 1,
        displayName: "Charcoal"
      }
    ]
  },
  {
    id: 264,
    displayName: "Diamond",
    name: "diamond",
    stackSize: 64
  },
  {
    id: 265,
    displayName: "Iron Ingot",
    name: "iron_ingot",
    stackSize: 64
  },
  {
    id: 266,
    displayName: "Gold Ingot",
    name: "gold_ingot",
    stackSize: 64
  },
  {
    id: 267,
    displayName: "Iron Sword",
    name: "iron_sword",
    stackSize: 1,
    maxDurability: 250,
    enchantCategories: [
      "weapon",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 268,
    displayName: "Wooden Sword",
    name: "wooden_sword",
    stackSize: 1,
    maxDurability: 59,
    enchantCategories: [
      "weapon",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "oak_planks",
      "spruce_planks",
      "birch_planks",
      "jungle_planks",
      "acacia_planks",
      "dark_oak_planks",
      "crimson_planks",
      "warped_planks"
    ]
  },
  {
    id: 269,
    displayName: "Wooden Shovel",
    name: "wooden_shovel",
    stackSize: 1,
    maxDurability: 59,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "oak_planks",
      "spruce_planks",
      "birch_planks",
      "jungle_planks",
      "acacia_planks",
      "dark_oak_planks",
      "crimson_planks",
      "warped_planks"
    ]
  },
  {
    id: 270,
    displayName: "Wooden Pickaxe",
    name: "wooden_pickaxe",
    stackSize: 1,
    maxDurability: 59,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "oak_planks",
      "spruce_planks",
      "birch_planks",
      "jungle_planks",
      "acacia_planks",
      "dark_oak_planks",
      "crimson_planks",
      "warped_planks"
    ]
  },
  {
    id: 271,
    displayName: "Wooden Axe",
    name: "wooden_axe",
    stackSize: 1,
    maxDurability: 59,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "oak_planks",
      "spruce_planks",
      "birch_planks",
      "jungle_planks",
      "acacia_planks",
      "dark_oak_planks",
      "crimson_planks",
      "warped_planks"
    ]
  },
  {
    id: 272,
    displayName: "Stone Sword",
    name: "stone_sword",
    stackSize: 1,
    maxDurability: 131,
    enchantCategories: [
      "weapon",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "cobblestone",
      "blackstone"
    ]
  },
  {
    id: 273,
    displayName: "Stone Shovel",
    name: "stone_shovel",
    stackSize: 1,
    maxDurability: 131,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "cobblestone",
      "blackstone"
    ]
  },
  {
    id: 274,
    displayName: "Stone Pickaxe",
    name: "stone_pickaxe",
    stackSize: 1,
    maxDurability: 131,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "cobblestone",
      "blackstone"
    ]
  },
  {
    id: 275,
    displayName: "Stone Axe",
    name: "stone_axe",
    stackSize: 1,
    maxDurability: 131,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "cobblestone",
      "blackstone"
    ]
  },
  {
    id: 276,
    displayName: "Diamond Sword",
    name: "diamond_sword",
    stackSize: 1,
    maxDurability: 1561,
    enchantCategories: [
      "weapon",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 277,
    displayName: "Diamond Shovel",
    name: "diamond_shovel",
    stackSize: 1,
    maxDurability: 1561,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 278,
    displayName: "Diamond Pickaxe",
    name: "diamond_pickaxe",
    stackSize: 1,
    maxDurability: 1561,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 279,
    displayName: "Diamond Axe",
    name: "diamond_axe",
    stackSize: 1,
    maxDurability: 1561,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 280,
    displayName: "Stick",
    name: "stick",
    stackSize: 64
  },
  {
    id: 281,
    displayName: "Bowl",
    name: "bowl",
    stackSize: 64
  },
  {
    id: 282,
    displayName: "Mushroom Stew",
    name: "mushroom_stew",
    stackSize: 1
  },
  {
    id: 283,
    displayName: "Golden Sword",
    name: "golden_sword",
    stackSize: 1,
    maxDurability: 32,
    enchantCategories: [
      "weapon",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 284,
    displayName: "Golden Shovel",
    name: "golden_shovel",
    stackSize: 1,
    maxDurability: 32,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 285,
    displayName: "Golden Pickaxe",
    name: "golden_pickaxe",
    stackSize: 1,
    maxDurability: 32,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 286,
    displayName: "Golden Axe",
    name: "golden_axe",
    stackSize: 1,
    maxDurability: 32,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 287,
    displayName: "String",
    name: "string",
    stackSize: 64
  },
  {
    id: 288,
    displayName: "Feather",
    name: "feather",
    stackSize: 64
  },
  {
    id: 289,
    displayName: "Gunpowder",
    name: "gunpowder",
    stackSize: 64
  },
  {
    id: 290,
    displayName: "Wooden Hoe",
    name: "wooden_hoe",
    stackSize: 1,
    maxDurability: 59,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "oak_planks",
      "spruce_planks",
      "birch_planks",
      "jungle_planks",
      "acacia_planks",
      "dark_oak_planks",
      "crimson_planks",
      "warped_planks"
    ]
  },
  {
    id: 291,
    displayName: "Stone Hoe",
    name: "stone_hoe",
    stackSize: 1,
    maxDurability: 131,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "cobblestone",
      "blackstone"
    ]
  },
  {
    id: 292,
    displayName: "Iron Hoe",
    name: "iron_hoe",
    stackSize: 1,
    maxDurability: 250,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 293,
    displayName: "Diamond Hoe",
    name: "diamond_hoe",
    stackSize: 1,
    maxDurability: 1561,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 294,
    displayName: "Golden Hoe",
    name: "golden_hoe",
    stackSize: 1,
    maxDurability: 32,
    enchantCategories: [
      "digger",
      "breakable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 295,
    displayName: "Seeds",
    name: "wheat_seeds",
    stackSize: 64
  },
  {
    id: 296,
    displayName: "Wheat",
    name: "wheat",
    stackSize: 64
  },
  {
    id: 297,
    displayName: "Bread",
    name: "bread",
    stackSize: 64
  },
  {
    id: 298,
    displayName: "Leather Cap",
    name: "leather_helmet",
    stackSize: 1,
    maxDurability: 55,
    enchantCategories: [
      "armor",
      "armor_head",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "leather"
    ]
  },
  {
    id: 299,
    displayName: "Leather Tunic",
    name: "leather_chestplate",
    stackSize: 1,
    maxDurability: 80,
    enchantCategories: [
      "armor",
      "armor_chest",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "leather"
    ]
  },
  {
    id: 300,
    displayName: "Leather Pants",
    name: "leather_leggings",
    stackSize: 1,
    maxDurability: 75,
    enchantCategories: [
      "armor",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "leather"
    ]
  },
  {
    id: 301,
    displayName: "Leather Boots",
    name: "leather_boots",
    stackSize: 1,
    maxDurability: 65,
    enchantCategories: [
      "armor",
      "armor_feet",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "leather"
    ]
  },
  {
    id: 302,
    displayName: "Chain Helmet",
    name: "chainmail_helmet",
    stackSize: 1,
    maxDurability: 165,
    enchantCategories: [
      "armor",
      "armor_head",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 303,
    displayName: "Chain Chestplate",
    name: "chainmail_chestplate",
    stackSize: 1,
    maxDurability: 240,
    enchantCategories: [
      "armor",
      "armor_chest",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 304,
    displayName: "Chain Leggings",
    name: "chainmail_leggings",
    stackSize: 1,
    maxDurability: 225,
    enchantCategories: [
      "armor",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 305,
    displayName: "Chain Boots",
    name: "chainmail_boots",
    stackSize: 1,
    maxDurability: 195,
    enchantCategories: [
      "armor",
      "armor_feet",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 306,
    displayName: "Iron Helmet",
    name: "iron_helmet",
    stackSize: 1,
    maxDurability: 165,
    enchantCategories: [
      "armor",
      "armor_head",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 307,
    displayName: "Iron Chestplate",
    name: "iron_chestplate",
    stackSize: 1,
    maxDurability: 240,
    enchantCategories: [
      "armor",
      "armor_chest",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 308,
    displayName: "Iron Leggings",
    name: "iron_leggings",
    stackSize: 1,
    maxDurability: 225,
    enchantCategories: [
      "armor",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 309,
    displayName: "Iron Boots",
    name: "iron_boots",
    stackSize: 1,
    maxDurability: 195,
    enchantCategories: [
      "armor",
      "armor_feet",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "iron_ingot"
    ]
  },
  {
    id: 310,
    displayName: "Diamond Helmet",
    name: "diamond_helmet",
    stackSize: 1,
    maxDurability: 363,
    enchantCategories: [
      "armor",
      "armor_head",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 311,
    displayName: "Diamond Chestplate",
    name: "diamond_chestplate",
    stackSize: 1,
    maxDurability: 528,
    enchantCategories: [
      "armor",
      "armor_chest",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 312,
    displayName: "Diamond Leggings",
    name: "diamond_leggings",
    stackSize: 1,
    maxDurability: 495,
    enchantCategories: [
      "armor",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 313,
    displayName: "Diamond Boots",
    name: "diamond_boots",
    stackSize: 1,
    maxDurability: 429,
    enchantCategories: [
      "armor",
      "armor_feet",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "diamond"
    ]
  },
  {
    id: 314,
    displayName: "Golden Helmet",
    name: "golden_helmet",
    stackSize: 1,
    maxDurability: 77,
    enchantCategories: [
      "armor",
      "armor_head",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 315,
    displayName: "Golden Chestplate",
    name: "golden_chestplate",
    stackSize: 1,
    maxDurability: 112,
    enchantCategories: [
      "armor",
      "armor_chest",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 316,
    displayName: "Golden Leggings",
    name: "golden_leggings",
    stackSize: 1,
    maxDurability: 105,
    enchantCategories: [
      "armor",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 317,
    displayName: "Golden Boots",
    name: "golden_boots",
    stackSize: 1,
    maxDurability: 91,
    enchantCategories: [
      "armor",
      "armor_feet",
      "breakable",
      "wearable",
      "vanishable"
    ],
    repairWith: [
      "gold_ingot"
    ]
  },
  {
    id: 318,
    displayName: "Flint",
    name: "flint",
    stackSize: 64
  },
  {
    id: 319,
    displayName: "Raw Porkchop",
    name: "porkchop",
    stackSize: 64
  },
  {
    id: 320,
    displayName: "Cooked Porkchop",
    name: "cooked_porkchop",
    stackSize: 64
  },
  {
    id: 321,
    displayName: "Painting",
    name: "painting",
    stackSize: 64
  },
  {
    id: 322,
    displayName: "Golden Apple",
    name: "golden_apple",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Golden Apple"
      },
      {
        metadata: 1,
        displayName: "Enchanted Golden Apple"
      }
    ]
  },
  {
    id: 323,
    displayName: "Sign",
    name: "sign",
    stackSize: 16
  },
  {
    id: 324,
    displayName: "Oak Door",
    name: "wooden_door",
    stackSize: 64
  },
  {
    id: 325,
    displayName: "Bucket",
    name: "bucket",
    stackSize: 16
  },
  {
    id: 326,
    displayName: "Water Bucket",
    name: "water_bucket",
    stackSize: 1
  },
  {
    id: 327,
    displayName: "Lava Bucket",
    name: "lava_bucket",
    stackSize: 1
  },
  {
    id: 328,
    displayName: "Minecart",
    name: "minecart",
    stackSize: 1
  },
  {
    id: 329,
    displayName: "Saddle",
    name: "saddle",
    stackSize: 1
  },
  {
    id: 330,
    displayName: "Iron Door",
    name: "iron_door",
    stackSize: 64
  },
  {
    id: 331,
    displayName: "Redstone",
    name: "redstone",
    stackSize: 64
  },
  {
    id: 332,
    displayName: "Snowball",
    name: "snowball",
    stackSize: 16
  },
  {
    id: 333,
    displayName: "Boat",
    name: "boat",
    stackSize: 1
  },
  {
    id: 334,
    displayName: "Leather",
    name: "leather",
    stackSize: 64
  },
  {
    id: 335,
    displayName: "Milk",
    name: "milk_bucket",
    stackSize: 1
  },
  {
    id: 336,
    displayName: "Brick",
    name: "brick",
    stackSize: 64
  },
  {
    id: 337,
    displayName: "Clay",
    name: "clay_ball",
    stackSize: 64
  },
  {
    id: 338,
    displayName: "Sugar Canes",
    name: "reeds",
    stackSize: 64
  },
  {
    id: 339,
    displayName: "Paper",
    name: "paper",
    stackSize: 64
  },
  {
    id: 340,
    displayName: "Book",
    name: "book",
    stackSize: 64
  },
  {
    id: 341,
    displayName: "Slimeball",
    name: "slime_ball",
    stackSize: 64
  },
  {
    id: 342,
    displayName: "Minecart with Chest",
    name: "chest_minecart",
    stackSize: 1
  },
  {
    id: 343,
    displayName: "Minecart with Furnace",
    name: "furnace_minecart",
    stackSize: 1
  },
  {
    id: 344,
    displayName: "Egg",
    name: "egg",
    stackSize: 16
  },
  {
    id: 345,
    displayName: "Compass",
    name: "compass",
    stackSize: 64
  },
  {
    id: 346,
    displayName: "Fishing Rod",
    name: "fishing_rod",
    stackSize: 1,
    maxDurability: 64,
    enchantCategories: [
      "breakable",
      "fishing_rod",
      "vanishable"
    ]
  },
  {
    id: 347,
    displayName: "Clock",
    name: "clock",
    stackSize: 64
  },
  {
    id: 348,
    displayName: "Glowstone Dust",
    name: "glowstone_dust",
    stackSize: 64
  },
  {
    id: 349,
    displayName: "Fish",
    name: "fish",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Raw Fish"
      },
      {
        metadata: 1,
        displayName: "Raw Salmon"
      },
      {
        metadata: 2,
        displayName: "Clownfish"
      },
      {
        metadata: 3,
        displayName: "Pufferfish"
      }
    ]
  },
  {
    id: 350,
    displayName: "Cooked Fish",
    name: "cooked_fish",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Cooked Fish"
      },
      {
        metadata: 1,
        displayName: "Cooked Salmon"
      }
    ]
  },
  {
    id: 351,
    displayName: "Dye",
    name: "dye",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Ink Sac"
      },
      {
        metadata: 1,
        displayName: "Rose Red"
      },
      {
        metadata: 2,
        displayName: "Cactus Green"
      },
      {
        metadata: 3,
        displayName: "Cocoa Beans"
      },
      {
        metadata: 4,
        displayName: "Lapis Lazuli"
      },
      {
        metadata: 5,
        displayName: "Purple Dye"
      },
      {
        metadata: 6,
        displayName: "Cyan Dye"
      },
      {
        metadata: 7,
        displayName: "Light Gray Dye"
      },
      {
        metadata: 8,
        displayName: "Gray Dye"
      },
      {
        metadata: 9,
        displayName: "Pink Dye"
      },
      {
        metadata: 10,
        displayName: "Lime Dye"
      },
      {
        metadata: 11,
        displayName: "Dandelion Yellow"
      },
      {
        metadata: 12,
        displayName: "Light Blue Dye"
      },
      {
        metadata: 13,
        displayName: "Magenta Dye"
      },
      {
        metadata: 14,
        displayName: "Orange Dye"
      },
      {
        metadata: 15,
        displayName: "Bone Meal"
      }
    ]
  },
  {
    id: 352,
    displayName: "Bone",
    name: "bone",
    stackSize: 64
  },
  {
    id: 353,
    displayName: "Sugar",
    name: "sugar",
    stackSize: 64
  },
  {
    id: 354,
    displayName: "Cake",
    name: "cake",
    stackSize: 1
  },
  {
    id: 355,
    displayName: "Bed",
    name: "bed",
    stackSize: 1
  },
  {
    id: 356,
    displayName: "Redstone Repeater",
    name: "repeater",
    stackSize: 64
  },
  {
    id: 357,
    displayName: "Cookie",
    name: "cookie",
    stackSize: 64
  },
  {
    id: 358,
    displayName: "Map",
    name: "filled_map",
    stackSize: 64
  },
  {
    id: 359,
    displayName: "Shears",
    name: "shears",
    stackSize: 1,
    maxDurability: 238,
    enchantCategories: [
      "breakable",
      "vanishable"
    ]
  },
  {
    id: 360,
    displayName: "Melon",
    name: "melon",
    stackSize: 64
  },
  {
    id: 361,
    displayName: "Pumpkin Seeds",
    name: "pumpkin_seeds",
    stackSize: 64
  },
  {
    id: 362,
    displayName: "Melon Seeds",
    name: "melon_seeds",
    stackSize: 64
  },
  {
    id: 363,
    displayName: "Raw Beef",
    name: "beef",
    stackSize: 64
  },
  {
    id: 364,
    displayName: "Steak",
    name: "cooked_beef",
    stackSize: 64
  },
  {
    id: 365,
    displayName: "Raw Chicken",
    name: "chicken",
    stackSize: 64
  },
  {
    id: 366,
    displayName: "Cooked Chicken",
    name: "cooked_chicken",
    stackSize: 64
  },
  {
    id: 367,
    displayName: "Rotten Flesh",
    name: "rotten_flesh",
    stackSize: 64
  },
  {
    id: 368,
    displayName: "Ender Pearl",
    name: "ender_pearl",
    stackSize: 16
  },
  {
    id: 369,
    displayName: "Blaze Rod",
    name: "blaze_rod",
    stackSize: 64
  },
  {
    id: 370,
    displayName: "Ghast Tear",
    name: "ghast_tear",
    stackSize: 64
  },
  {
    id: 371,
    displayName: "Gold Nugget",
    name: "gold_nugget",
    stackSize: 64
  },
  {
    id: 372,
    displayName: "Nether Wart",
    name: "nether_wart",
    stackSize: 64
  },
  {
    id: 373,
    displayName: "Potion",
    name: "potion",
    stackSize: 1
  },
  {
    id: 374,
    displayName: "Glass Bottle",
    name: "glass_bottle",
    stackSize: 64
  },
  {
    id: 375,
    displayName: "Spider Eye",
    name: "spider_eye",
    stackSize: 64
  },
  {
    id: 376,
    displayName: "Fermented Spider Eye",
    name: "fermented_spider_eye",
    stackSize: 64
  },
  {
    id: 377,
    displayName: "Blaze Powder",
    name: "blaze_powder",
    stackSize: 64
  },
  {
    id: 378,
    displayName: "Magma Cream",
    name: "magma_cream",
    stackSize: 64
  },
  {
    id: 379,
    displayName: "Brewing Stand",
    name: "brewing_stand",
    stackSize: 64
  },
  {
    id: 380,
    displayName: "Cauldron",
    name: "cauldron",
    stackSize: 64
  },
  {
    id: 381,
    displayName: "Eye of Ender",
    name: "ender_eye",
    stackSize: 64
  },
  {
    id: 382,
    displayName: "Glistering Melon",
    name: "speckled_melon",
    stackSize: 64
  },
  {
    id: 383,
    displayName: "Spawn Egg",
    name: "spawn_egg",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Spawn"
      },
      {
        metadata: 1,
        displayName: "Spawn Dropped item"
      },
      {
        metadata: 7,
        displayName: "Spawn Thrown egg"
      },
      {
        metadata: 8,
        displayName: "Spawn Lead knot"
      },
      {
        metadata: 10,
        displayName: "Spawn Shot arrow"
      },
      {
        metadata: 11,
        displayName: "Spawn Thrown snowball"
      },
      {
        metadata: 12,
        displayName: "Spawn Ghast fireball"
      },
      {
        metadata: 13,
        displayName: "Spawn Blaze fireball"
      },
      {
        metadata: 14,
        displayName: "Spawn Thrown Ender Pearl"
      },
      {
        metadata: 15,
        displayName: "Spawn Thrown Eye of Ender"
      },
      {
        metadata: 16,
        displayName: "Spawn Thrown splash potion"
      },
      {
        metadata: 17,
        displayName: "Spawn Thrown Bottle o' Enchanting"
      },
      {
        metadata: 18,
        displayName: "Spawn Item Frame"
      },
      {
        metadata: 19,
        displayName: "Spawn Wither Skull"
      },
      {
        metadata: 20,
        displayName: "Spawn Primed TNT"
      },
      {
        metadata: 21,
        displayName: "Spawn Falling block"
      },
      {
        metadata: 21,
        displayName: "Spawn Falling block"
      },
      {
        metadata: 22,
        displayName: "Spawn Firework Rocket"
      },
      {
        metadata: 30,
        displayName: "Spawn Armor Stand"
      },
      {
        metadata: 41,
        displayName: "Spawn Boat"
      },
      {
        metadata: 42,
        displayName: "Spawn Minecart"
      },
      {
        metadata: 42,
        displayName: "Spawn Minecart"
      },
      {
        metadata: 42,
        displayName: "Spawn Minecart"
      },
      {
        metadata: 48,
        displayName: "Spawn Mob"
      },
      {
        metadata: 49,
        displayName: "Spawn Monster"
      },
      {
        metadata: 50,
        displayName: "Spawn Creeper"
      },
      {
        metadata: 51,
        displayName: "Spawn Skeleton"
      },
      {
        metadata: 52,
        displayName: "Spawn Spider"
      },
      {
        metadata: 53,
        displayName: "Spawn Giant"
      },
      {
        metadata: 54,
        displayName: "Spawn Zombie"
      },
      {
        metadata: 55,
        displayName: "Spawn Slime"
      },
      {
        metadata: 56,
        displayName: "Spawn Ghast"
      },
      {
        metadata: 57,
        displayName: "Spawn Zombie Pigman"
      },
      {
        metadata: 58,
        displayName: "Spawn Enderman"
      },
      {
        metadata: 59,
        displayName: "Spawn Cave Spider"
      },
      {
        metadata: 60,
        displayName: "Spawn Silverfish"
      },
      {
        metadata: 61,
        displayName: "Spawn Blaze"
      },
      {
        metadata: 62,
        displayName: "Spawn Magma Cube"
      },
      {
        metadata: 63,
        displayName: "Spawn Ender Dragon"
      },
      {
        metadata: 64,
        displayName: "Spawn Wither"
      },
      {
        metadata: 65,
        displayName: "Spawn Bat"
      },
      {
        metadata: 66,
        displayName: "Spawn Witch"
      },
      {
        metadata: 67,
        displayName: "Spawn Endermite"
      },
      {
        metadata: 68,
        displayName: "Spawn Guardian"
      },
      {
        metadata: 90,
        displayName: "Spawn Pig"
      },
      {
        metadata: 91,
        displayName: "Spawn Sheep"
      },
      {
        metadata: 92,
        displayName: "Spawn Cow"
      },
      {
        metadata: 93,
        displayName: "Spawn Chicken"
      },
      {
        metadata: 94,
        displayName: "Spawn Squid"
      },
      {
        metadata: 95,
        displayName: "Spawn Wolf"
      },
      {
        metadata: 96,
        displayName: "Spawn Mooshroom"
      },
      {
        metadata: 97,
        displayName: "Spawn Snow Golem"
      },
      {
        metadata: 98,
        displayName: "Spawn Ocelot"
      },
      {
        metadata: 99,
        displayName: "Spawn Iron Golem"
      },
      {
        metadata: 100,
        displayName: "Spawn Horse"
      },
      {
        metadata: 101,
        displayName: "Spawn Rabbit"
      },
      {
        metadata: 120,
        displayName: "Spawn Villager"
      },
      {
        metadata: 200,
        displayName: "Spawn Ender Crystal"
      }
    ]
  },
  {
    id: 384,
    displayName: "Bottle o' Enchanting",
    name: "experience_bottle",
    stackSize: 64
  },
  {
    id: 385,
    displayName: "Fire Charge",
    name: "fire_charge",
    stackSize: 64
  },
  {
    id: 386,
    displayName: "Book and Quill",
    name: "writable_book",
    stackSize: 1
  },
  {
    id: 387,
    displayName: "Written Book",
    name: "written_book",
    stackSize: 16
  },
  {
    id: 388,
    displayName: "Emerald",
    name: "emerald",
    stackSize: 64
  },
  {
    id: 389,
    displayName: "Item Frame",
    name: "item_frame",
    stackSize: 64
  },
  {
    id: 390,
    displayName: "Flower Pot",
    name: "flower_pot",
    stackSize: 64
  },
  {
    id: 391,
    displayName: "Carrot",
    name: "carrot",
    stackSize: 64
  },
  {
    id: 392,
    displayName: "Potato",
    name: "potato",
    stackSize: 64
  },
  {
    id: 393,
    displayName: "Baked Potato",
    name: "baked_potato",
    stackSize: 64
  },
  {
    id: 394,
    displayName: "Poisonous Potato",
    name: "poisonous_potato",
    stackSize: 64
  },
  {
    id: 395,
    displayName: "Empty Map",
    name: "map",
    stackSize: 64
  },
  {
    id: 396,
    displayName: "Golden Carrot",
    name: "golden_carrot",
    stackSize: 64
  },
  {
    id: 397,
    displayName: "Skull",
    name: "skull",
    stackSize: 64,
    variations: [
      {
        metadata: 0,
        displayName: "Skeleton Skull"
      },
      {
        metadata: 1,
        displayName: "Wither Skeleton Skull"
      },
      {
        metadata: 2,
        displayName: "Zombie Head"
      },
      {
        metadata: 3,
        displayName: "Head"
      },
      {
        metadata: 4,
        displayName: "Creeper Head"
      }
    ]
  },
  {
    id: 398,
    displayName: "Carrot on a Stick",
    name: "carrot_on_a_stick",
    stackSize: 1,
    maxDurability: 25,
    enchantCategories: [
      "breakable",
      "vanishable"
    ]
  },
  {
    id: 399,
    displayName: "Nether Star",
    name: "nether_star",
    stackSize: 64
  },
  {
    id: 400,
    displayName: "Pumpkin Pie",
    name: "pumpkin_pie",
    stackSize: 64
  },
  {
    id: 401,
    displayName: "Firework Rocket",
    name: "fireworks",
    stackSize: 64
  },
  {
    id: 402,
    displayName: "Firework Star",
    name: "firework_charge",
    stackSize: 64
  },
  {
    id: 403,
    displayName: "Enchanted Book",
    name: "enchanted_book",
    stackSize: 1
  },
  {
    id: 404,
    displayName: "Redstone Comparator",
    name: "comparator",
    stackSize: 64
  },
  {
    id: 405,
    displayName: "Nether Brick",
    name: "netherbrick",
    stackSize: 64
  },
  {
    id: 406,
    displayName: "Nether Quartz",
    name: "quartz",
    stackSize: 64
  },
  {
    id: 407,
    displayName: "Minecart with TNT",
    name: "tnt_minecart",
    stackSize: 1
  },
  {
    id: 408,
    displayName: "Minecart with Hopper",
    name: "hopper_minecart",
    stackSize: 1
  },
  {
    id: 409,
    displayName: "Prismarine Shard",
    name: "prismarine_shard",
    stackSize: 64
  },
  {
    id: 410,
    displayName: "Prismarine Crystals",
    name: "prismarine_crystals",
    stackSize: 64
  },
  {
    id: 411,
    displayName: "Raw Rabbit",
    name: "rabbit",
    stackSize: 64
  },
  {
    id: 412,
    displayName: "Cooked Rabbit",
    name: "cooked_rabbit",
    stackSize: 64
  },
  {
    id: 413,
    displayName: "Rabbit Stew",
    name: "rabbit_stew",
    stackSize: 1
  },
  {
    id: 414,
    displayName: "Rabbit's Foot",
    name: "rabbit_foot",
    stackSize: 64
  },
  {
    id: 415,
    displayName: "Rabbit Hide",
    name: "rabbit_hide",
    stackSize: 64
  },
  {
    id: 416,
    displayName: "Armor Stand",
    name: "armor_stand",
    stackSize: 16
  },
  {
    id: 417,
    displayName: "Iron Horse Armor",
    name: "iron_horse_armor",
    stackSize: 1
  },
  {
    id: 418,
    displayName: "Gold Horse Armor",
    name: "golden_horse_armor",
    stackSize: 1
  },
  {
    id: 419,
    displayName: "Diamond Horse Armor",
    name: "diamond_horse_armor",
    stackSize: 1
  },
  {
    id: 420,
    displayName: "Lead",
    name: "lead",
    stackSize: 64
  },
  {
    id: 421,
    displayName: "Name Tag",
    name: "name_tag",
    stackSize: 64
  },
  {
    id: 422,
    displayName: "Minecart with Command Block",
    name: "command_block_minecart",
    stackSize: 1
  },
  {
    id: 423,
    displayName: "Raw Mutton",
    name: "mutton",
    stackSize: 64
  },
  {
    id: 424,
    displayName: "Cooked Mutton",
    name: "cooked_mutton",
    stackSize: 64
  },
  {
    id: 425,
    displayName: "Banner",
    name: "banner",
    stackSize: 16,
    variations: [
      {
        metadata: 0,
        displayName: "Black Banner"
      },
      {
        metadata: 1,
        displayName: "Red Banner"
      },
      {
        metadata: 2,
        displayName: "Green Banner"
      },
      {
        metadata: 3,
        displayName: "Brown Banner"
      },
      {
        metadata: 4,
        displayName: "Blue Banner"
      },
      {
        metadata: 5,
        displayName: "Purple Banner"
      },
      {
        metadata: 6,
        displayName: "Cyan Banner"
      },
      {
        metadata: 7,
        displayName: "Light Gray Banner"
      },
      {
        metadata: 8,
        displayName: "Gray Banner"
      },
      {
        metadata: 9,
        displayName: "Pink Banner"
      },
      {
        metadata: 10,
        displayName: "Lime Banner"
      },
      {
        metadata: 11,
        displayName: "Yellow Banner"
      },
      {
        metadata: 12,
        displayName: "Light Blue Banner"
      },
      {
        metadata: 13,
        displayName: "Magenta Banner"
      },
      {
        metadata: 14,
        displayName: "Orange Banner"
      },
      {
        metadata: 15,
        displayName: "White Banner"
      }
    ]
  },
  {
    id: 427,
    displayName: "Spruce Door",
    name: "spruce_door",
    stackSize: 64
  },
  {
    id: 428,
    displayName: "Birch Door",
    name: "birch_door",
    stackSize: 64
  },
  {
    id: 429,
    displayName: "Jungle Door",
    name: "jungle_door",
    stackSize: 64
  },
  {
    id: 430,
    displayName: "Acacia Door",
    name: "acacia_door",
    stackSize: 64
  },
  {
    id: 431,
    displayName: "Dark Oak Door",
    name: "dark_oak_door",
    stackSize: 64
  },
  {
    id: 2256,
    displayName: "13 Disc",
    name: "record_13",
    stackSize: 1
  },
  {
    id: 2257,
    displayName: "Cat Disc",
    name: "record_cat",
    stackSize: 1
  },
  {
    id: 2258,
    displayName: "Blocks Disc",
    name: "record_blocks",
    stackSize: 1
  },
  {
    id: 2259,
    displayName: "Chirp Disc",
    name: "record_chirp",
    stackSize: 1
  },
  {
    id: 2260,
    displayName: "Far Disc",
    name: "record_far",
    stackSize: 1
  },
  {
    id: 2261,
    displayName: "Mall Disc",
    name: "record_mall",
    stackSize: 1
  },
  {
    id: 2262,
    displayName: "Mellohi Disc",
    name: "record_mellohi",
    stackSize: 1
  },
  {
    id: 2263,
    displayName: "Stal Disc",
    name: "record_stal",
    stackSize: 1
  },
  {
    id: 2264,
    displayName: "Strad Disc",
    name: "record_strad",
    stackSize: 1
  },
  {
    id: 2265,
    displayName: "Ward Disc",
    name: "record_ward",
    stackSize: 1
  },
  {
    id: 2266,
    displayName: "11 Disc",
    name: "record_11",
    stackSize: 1
  },
  {
    id: 2267,
    displayName: "Wait Disc",
    name: "record_wait",
    stackSize: 1
  }
];

// dist/types/constants.js
var MINECRAFT_ITEMS = items_default;
var ACTION_NAMES = {
  APPLY_POTION_EFFECT: "Apply Potion Effect",
  CLEAR_POTION_EFFECTS: "Clear All Potion Effects",
  FAIL_PARKOUR: "Fail Parkour",
  PARKOUR_CHECKPOINT: "Parkour Checkpoint",
  GIVE_EXPERIENCE_LEVELS: "Give Experience Levels",
  GIVE_ITEM: "Give Item",
  REMOVE_ITEM: "Remove Item",
  SEND_TO_LOBBY: "Send to Lobby",
  CONDITIONAL: "Conditional",
  SET_GROUP: "Change Player's Group",
  KILL: "Kill Player",
  HEAL: "Full Heal",
  TITLE: "Display Title",
  ACTION_BAR: "Display Action Bar",
  RESET_INVENTORY: "Reset Inventory",
  CHANGE_MAX_HEALTH: "Change Max Health",
  CHANGE_VAR: "Change Variable",
  CHANGE_HEALTH: "Change Health",
  MESSAGE: "Send a Chat Message",
  EXIT: "Exit",
  RANDOM: "Random Action",
  SET_VELOCITY: "Change Velocity",
  TELEPORT: "Teleport Player",
  CANCEL_EVENT: "Cancel Event",
  PLAY_SOUND: "Play Sound",
  SET_COMPASS_TARGET: "Set Compass Target",
  SET_GAMEMODE: "Set Gamemode",
  CHANGE_HUNGER: "Change Hunger Level",
  FUNCTION: "Trigger Function",
  APPLY_INVENTORY_LAYOUT: "Apply Inventory Layout",
  ENCHANT_HELD_ITEM: "Enchant Held Item",
  PAUSE: "Pause Execution",
  SET_TEAM: "Set Player Team",
  SET_MENU: "Display Menu",
  CLOSE_MENU: "Close Menu",
  USE_HELD_ITEM: "Use/Remove Held Item",
  DROP_ITEM: "Drop Item",
  LAUNCH: "Launch to Target",
  SET_PLAYER_WEATHER: "Set Player Weather",
  SET_PLAYER_TIME: "Set Player Time",
  TOGGLE_NAMETAG_DISPLAY: "Toggle Nametag Display"
};
var CONDITION_NAMES = {
  REQUIRE_GROUP: "Required Group",
  COMPARE_VAR: "Variable Requirement",
  REQUIRE_PERMISSION: "Required Permission",
  IS_IN_REGION: "Within Region",
  REQUIRE_ITEM: "Has Item",
  IS_DOING_PARKOUR: "Doing Parkour",
  REQUIRE_POTION_EFFECT: "Has Potion Effect",
  IS_SNEAKING: "Player Sneaking",
  IS_FLYING: "Player Flying",
  COMPARE_HEALTH: "Player Health",
  COMPARE_MAX_HEALTH: "Max Player Health",
  COMPARE_HUNGER: "Player Hunger",
  REQUIRE_GAMEMODE: "Required Gamemode",
  COMPARE_PLACEHOLDER: "Placeholder Number Requirement",
  REQUIRE_TEAM: "Required Team",
  DAMAGE_CAUSE: "Damage Cause",
  PVP_ENABLED: "PvP Enabled",
  FISHING_ENVIRONMENT: "Fishing Environment",
  PORTAL_TYPE: "Portal Type",
  BLOCK_TYPE: "Block Type",
  IS_ITEM: "Is Item",
  COMPARE_DAMAGE: "Damage Amount"
};
var OPERATIONS = [
  "Set",
  "Increment",
  "Decrement",
  "Multiply",
  "Divide"
];
var VAR_OPERATIONS = [
  "Shift Left",
  "Shift Right",
  "And Assign",
  "Or Assign",
  "Xor Assign",
  "Unset"
];
var COMPARISONS = [
  "Equal",
  "Less Than",
  "Less Than or Equal",
  "Greater Than",
  "Greater Than or Equal"
];
var GAMEMODES = [
  "Adventure",
  "Survival",
  "Creative"
];
var LOCATIONS = [
  "House Spawn Location",
  "Invokers Location",
  "Current Location",
  "Custom Coordinates"
];
var SOUNDS = [
  { name: "Ambience Cave", path: "ambient.cave.cave" },
  { name: "Ambience Rain", path: "ambient.weather.rain" },
  { name: "Ambience Thunder", path: "ambient.weather.thunder" },
  { name: "Anvil Break", path: "random.anvil_break" },
  { name: "Anvil Land", path: "random.anvil_land" },
  { name: "Anvil Use", path: "random.anvil_use" },
  { name: "Arrow Hit", path: "random.bowhit" },
  { name: "Burp", path: "random.burp" },
  { name: "Chest Close", path: "random.chestclosed" },
  { name: "Chest Open", path: "random.chestopen" },
  { name: "Click", path: "random.click" },
  { name: "Door Close", path: "random.door_close" },
  { name: "Door Open", path: "random.door_open" },
  { name: "Drink", path: "random.drink" },
  { name: "Eat", path: "random.eat" },
  { name: "Explode", path: "random.explode" },
  { name: "Fall Big", path: "game.player.hurt.fall.big" },
  { name: "Fall Small", path: "game.player.hurt.fall.small" },
  { name: "Fizz", path: "random.fizz" },
  { name: "Fuse", path: "game.tnt.primed" },
  { name: "Glass", path: "dig.glass" },
  { name: "Hurt Flesh", path: "game.player.hurt" },
  { name: "Item Break", path: "random.break" },
  { name: "Item Pickup", path: "random.pop" },
  { name: "Lava Pop", path: "liquid.lavapop" },
  { name: "Level Up", path: "random.levelup" },
  { name: "Note Bass", path: "note.bass" },
  { name: "Note Piano", path: "note.harp" },
  { name: "Note Bass Drum", path: "note.bd" },
  { name: "Note Sticks", path: "note.hat" },
  { name: "Note Bass Guitar", path: "note.bassattack" },
  { name: "Note Snare Drum", path: "note.snare" },
  { name: "Note Pling", path: "note.pling" },
  { name: "Orb Pickup", path: "random.orb" },
  { name: "Shoot Arrow", path: "random.bow" },
  { name: "Splash", path: "game.player.swim.splash" },
  { name: "Swim", path: "game.player.swim" },
  { name: "Wood Click", path: "random.wood_click" },
  { name: "Bat Death", path: "mob.bat.death" },
  { name: "Bat Hurt", path: "mob.bat.hurt" },
  { name: "Bat Idle", path: "mob.bat.idle" },
  { name: "Bat Loop", path: "mob.bat.loop" },
  { name: "Bat Takeoff", path: "mob.bat.takeoff" },
  { name: "Blaze Breath", path: "mob.blaze.breathe" },
  { name: "Blaze Death", path: "mob.blaze.death" },
  { name: "Blaze Hit", path: "mob.blaze.hit" },
  { name: "Cat Hiss", path: "mob.cat.hiss" },
  { name: "Cat Hit", path: "mob.cat.hitt" },
  { name: "Cat Meow", path: "mob.cat.meow" },
  { name: "Cat Purr", path: "mob.cat.purr" },
  { name: "Cat Purreow", path: "mob.cat.purreow" },
  { name: "Chicken Idle", path: "mob.chicken.say" },
  { name: "Chicken Hurt", path: "mob.chicken.hurt" },
  { name: "Chicken Egg Pop", path: "mob.chicken.plop" },
  { name: "Chicken Walk", path: "mob.chicken.step" },
  { name: "Cow Idle", path: "mob.cow.say" },
  { name: "Cow Hurt", path: "mob.cow.hurt" },
  { name: "Cow Walk", path: "mob.cow.step" },
  { name: "Creeper Hiss", path: "mob.creeper.say" },
  { name: "Creeper Death", path: "mob.creeper.death" },
  { name: "Enderdragon Death", path: "mob.enderdragon.end" },
  { name: "Enderdragon Growl", path: "mob.enderdragon.growl" },
  { name: "Enderdragon Hit", path: "mob.enderdragon.hit" },
  { name: "Enderdragon Wings", path: "mob.enderdragon.wings" },
  { name: "Enderman Death", path: "mob.endermen.death" },
  { name: "Enderman Hit", path: "mob.endermen.hit" },
  { name: "Enderman Idle", path: "mob.endermen.idle" },
  { name: "Enderman Teleport", path: "mob.endermen.portal" },
  { name: "Enderman Scream", path: "mob.endermen.scream" },
  { name: "Enderman Stare", path: "mob.endermen.stare" },
  { name: "Ghast Scream", path: "mob.ghast.scream" },
  { name: "Ghast Scream2", path: "mob.ghast.affectionate_scream" },
  { name: "Ghast Charge", path: "mob.ghast.charge" },
  { name: "Ghast Death", path: "mob.ghast.death" },
  { name: "Ghast Fireball", path: "mob.ghast.fireball" },
  { name: "Ghast Moan", path: "mob.ghast.moan" },
  { name: "Guardian Hit", path: "mob.guardian.hit" },
  { name: "Guardian Idle", path: "mob.guardian.idle" },
  { name: "Guardian Death", path: "mob.guardian.death" },
  { name: "Guardian Elder Hit", path: "mob.guardian.elder.hit" },
  { name: "Guardian Elder Idle", path: "mob.guardian.elder.idle" },
  { name: "Guardian Elder Death", path: "mob.guardian.elder.death" },
  { name: "Guardian Land Hit", path: "mob.guardian.land.hit" },
  { name: "Guardian Land Idle", path: "mob.guardian.land.idle" },
  { name: "Guardian Land Death", path: "mob.guardian.land.death" },
  { name: "Guardian Curse", path: "mob.guardian.curse" },
  { name: "Guardian Attack", path: "mob.guardian.attack" },
  { name: "Guardian Flop", path: "mob.guardian.flop" },
  { name: "Irongolem Death", path: "mob.irongolem.death" },
  { name: "Irongolem Hit", path: "mob.irongolem.hit" },
  { name: "Irongolem Throw", path: "mob.irongolem.throw" },
  { name: "Irongolem Walk", path: "mob.irongolem.walk" },
  { name: "Magmacube Walk", path: "mob.magmacube.small" },
  { name: "Magmacube Walk2", path: "mob.magmacube.big" },
  { name: "Magmacube Jump", path: "mob.magmacube.jump" },
  { name: "Pig Idle", path: "mob.pig.say" },
  { name: "Pig Death", path: "mob.pig.death" },
  { name: "Pig Walk", path: "mob.pig.step" },
  { name: "Rabbit Ambient", path: "mob.rabbit.idle" },
  { name: "Rabbit Death", path: "mob.rabbit.death" },
  { name: "Rabbit Hurt", path: "mob.rabbit.hurt" },
  { name: "Rabbit Jump", path: "mob.rabbit.hop" },
  { name: "Sheep Idle", path: "mob.sheep.say" },
  { name: "Sheep Shear", path: "mob.sheep.shear" },
  { name: "Sheep Walk", path: "mob.sheep.step" },
  { name: "Silverfish Hit", path: "mob.silverfish.hit" },
  { name: "Silverfish Kill", path: "mob.silverfish.kill" },
  { name: "Silverfish Idle", path: "mob.silverfish.say" },
  { name: "Silverfish Walk", path: "mob.silverfish.step" },
  { name: "Skeleton Idle", path: "mob.skeleton.say" },
  { name: "Skeleton Death", path: "mob.skeleton.death" },
  { name: "Skeleton Hurt", path: "mob.skeleton.hurt" },
  { name: "Skeleton Walk", path: "mob.skeleton.step" },
  { name: "Slime Attack", path: "mob.slime.attack" },
  { name: "Slime Walk", path: "mob.slime.small" },
  { name: "Slime Walk2", path: "mob.slime.big" },
  { name: "Spider Idle", path: "mob.spider.say" },
  { name: "Spider Death", path: "mob.spider.death" },
  { name: "Spider Walk", path: "mob.spider.step" },
  { name: "Wither Death", path: "mob.wither.death" },
  { name: "Wither Hurt", path: "mob.wither.hurt" },
  { name: "Wither Idle", path: "mob.wither.idle" },
  { name: "Wither Shoot", path: "mob.wither.shoot" },
  { name: "Wither Spawn", path: "mob.wither.spawn" },
  { name: "Wolf Bark", path: "mob.wolf.bark" },
  { name: "Wolf Death", path: "mob.wolf.death" },
  { name: "Wolf Growl", path: "mob.wolf.growl" },
  { name: "Wolf Howl", path: "mob.wolf.howl" },
  { name: "Wolf Hurt", path: "mob.wolf.hurt" },
  { name: "Wolf Pant", path: "mob.wolf.panting" },
  { name: "Wolf Shake", path: "mob.wolf.shake" },
  { name: "Wolf Walk", path: "mob.wolf.step" },
  { name: "Wolf Whine", path: "mob.wolf.whine" },
  { name: "Zombie Metal", path: "mob.zombie.metal" },
  { name: "Zombie Wood", path: "mob.zombie.wood" },
  { name: "Zombie Woodbreak", path: "mob.zombie.woodbreak" },
  { name: "Zombie Idle", path: "mob.zombie.say" },
  { name: "Zombie Death", path: "mob.zombie.death" },
  { name: "Zombie Hurt", path: "mob.zombie.hurt" },
  { name: "Zombie Infect", path: "mob.zombie.infect" },
  { name: "Zombie Unfect", path: "mob.zombie.unfect" },
  { name: "Zombie Remedy", path: "mob.zombie.remedy" },
  { name: "Zombie Walk", path: "mob.zombie.step" },
  { name: "Zombie Pig Idle", path: "mob.zombiepig.zpig" },
  { name: "Zombie Pig Angry", path: "mob.zombiepig.zpigangry" },
  { name: "Zombie Pig Death", path: "mob.zombiepig.zpigdeath" },
  { name: "Zombie Pig Hurt", path: "mob.zombiepig.zpighurt" },
  { name: "Firework Blast", path: "fireworks.blast" },
  { name: "Firework Blast2", path: "fireworks.blast_far" },
  { name: "Firework Large Blast", path: "fireworks.largeBlast" },
  { name: "Firework Large Blast2", path: "fireworks.largeBlast_far" },
  { name: "Firework Twinkle", path: "fireworks.twinkle" },
  { name: "Firework Twinkle2", path: "fireworks.twinkle_far" },
  { name: "Firework Launch", path: "fireworks.launch" },
  { name: "Fireworks Blast", path: "fireworks.blast" },
  { name: "Fireworks Blast2", path: "fireworks.blast_far" },
  { name: "Fireworks Large Blast", path: "fireworks.largeBlast" },
  { name: "Fireworks Large Blast2", path: "fireworks.largeBlast_far" },
  { name: "Fireworks Twinkle", path: "fireworks.twinkle" },
  { name: "Fireworks Twinkle2", path: "fireworks.twinkle_far" },
  { name: "Fireworks Launch", path: "fireworks.launch" },
  { name: "Successful Hit", path: "random.successful_hit" },
  { name: "Horse Angry", path: "mob.horse.angry" },
  { name: "Horse Armor", path: "mob.horse.armor" },
  { name: "Horse Breathe", path: "mob.horse.breathe" },
  { name: "Horse Death", path: "mob.horse.death" },
  { name: "Horse Gallop", path: "mob.horse.gallop" },
  { name: "Horse Hit", path: "mob.horse.hit" },
  { name: "Horse Idle", path: "mob.horse.idle" },
  { name: "Horse Jump", path: "mob.horse.jump" },
  { name: "Horse Land", path: "mob.horse.land" },
  { name: "Horse Saddle", path: "mob.horse.leather" },
  { name: "Horse Soft", path: "mob.horse.soft" },
  { name: "Horse Wood", path: "mob.horse.wood" },
  { name: "Donkey Angry", path: "mob.horse.donkey.angry" },
  { name: "Donkey Death", path: "mob.horse.donkey.death" },
  { name: "Donkey Hit", path: "mob.horse.donkey.hit" },
  { name: "Donkey Idle", path: "mob.horse.donkey.idle" },
  { name: "Horse Skeleton Death", path: "mob.horse.skeleton.death" },
  { name: "Horse Skeleton Hit", path: "mob.horse.skeleton.hit" },
  { name: "Horse Skeleton Idle", path: "mob.horse.skeleton.idle" },
  { name: "Horse Zombie Death", path: "mob.horse.zombie.death" },
  { name: "Horse Zombie Hit", path: "mob.horse.zombie.hit" },
  { name: "Horse Zombie Idle", path: "mob.horse.zombie.idle" },
  { name: "Villager Death", path: "mob.villager.death" },
  { name: "Villager Haggle", path: "mob.villager.haggle" },
  { name: "Villager Hit", path: "mob.villager.hit" },
  { name: "Villager Idle", path: "mob.villager.idle" },
  { name: "Villager No", path: "mob.villager.no" },
  { name: "Villager Yes", path: "mob.villager.yes" }
];
var POTION_EFFECTS = [
  "Speed",
  "Slowness",
  "Haste",
  "Mining Fatigue",
  "Strength",
  "Instant Health",
  "Instant Damage",
  "Jump Boost",
  "Nausea",
  "Regeneration",
  "Resistance",
  "Fire Resistance",
  "Water Breathing",
  "Invisibility",
  "Blindness",
  "Night Vision",
  "Hunger",
  "Weakness",
  "Poison",
  "Wither",
  "Health Boost",
  "Absorption"
];
var EVENTS = [
  "Player Join",
  "Player Quit",
  "Player Death",
  "Player Kill",
  "Player Respawn",
  "Group Change",
  "PvP State Change",
  "Fish Caught",
  "Player Enter Portal",
  "Player Damage",
  "Player Block Break",
  "Start Parkour",
  "Complete Parkour",
  "Player Drop Item",
  "Player Pick Up Item",
  "Player Change Held Item",
  "Player Toggle Sneak",
  "Player Toggle Flight"
];
var LOBBIES = [
  "Main Lobby",
  "Tournament Hall",
  "Blitz SG",
  "The TNT Games",
  "Mega Walls",
  "Arcade Games",
  "Cops and Crims",
  "UHC Champions",
  "Warlords",
  "Smash Heroes",
  "Housing",
  "SkyWars",
  "Speed UHC",
  "Classic Games",
  "Prototype",
  "Bed Wars",
  "Murder Mystery",
  "Build Battle",
  "Duels",
  "Wool Games"
];
var ENCHANTMENTS = [
  "Protection",
  "Fire Protection",
  "Feather Falling",
  "Blast Protection",
  "Projectile Projection",
  "Respiration",
  "Aqua Affinity",
  "Thorns",
  "Depth Strider",
  "Sharpness",
  "Smite",
  "Bane Of Arthropods",
  "Knockback",
  "Fire Aspect",
  "Looting",
  "Efficiency",
  "Silk Touch",
  "Unbreaking",
  "Fortune",
  "Power",
  "Punch",
  "Flame",
  "Infinity",
  "Luck Of The Sea",
  "Lure"
];
var PERMISSIONS = [
  "Fly",
  "Wood Door",
  "Iron Door",
  "Wood Trap Door",
  "Iron Trap Door",
  "Fence Gate",
  "Button",
  "Lever",
  "Use Launch Pads",
  "/tp",
  "/tp Other Players",
  "Jukebox",
  "Kick",
  "Ban",
  "Mute",
  "Pet Spawning",
  "Build",
  "Offline Build",
  "Fluid",
  "Pro Tools",
  "Use Chests",
  "Use Ender Chests",
  "Item Editor",
  "Switch Game Mode",
  "Edit Stats",
  "Change Player Group",
  "Change Gamerules",
  "Housing Menu",
  "Team Chat Spy",
  "Edit Actions",
  "Edit Regions",
  "Edit Scoreboard",
  "Edit Event Actions",
  "Edit Commands",
  "Edit Functions",
  "Edit Inventory Layouts",
  "Edit Teams",
  "Edit Custom Menus",
  "Item: Mailbox",
  "Item: Egg Hunt",
  "Item: Teleport Pad",
  "Item: Launch Pad",
  "Item: Action Pad",
  "Item: Hologram",
  "Item: NPCs",
  "Item: Action Button",
  "Item: Leaderboard",
  "Item: Trash Can",
  "Item: Biome Stick"
];
var DAMAGE_CAUSES = [
  "Entity Attack",
  "Projectile",
  "Suffocation",
  "Fall",
  "Lava",
  "Fire",
  "Fire Tick",
  "Drowning",
  "Starvation",
  "Poison",
  "Thorns"
];
var FISHING_ENVIRONMENTS = [
  "Water",
  "Lava"
];
var PORTAL_TYPES = [
  "Nether Portal",
  "End Portal"
];
var INVENTORY_SLOTS = [
  "First Available Slot",
  "Hand Slot",
  "Helmet",
  "Chestplate",
  "Leggings",
  "Boots"
];
var ITEM_PROPERTIES = [
  "Item Type",
  "Metadata"
];
var ITEM_LOCATIONS = [
  "Hand",
  "Armor",
  "Hotbar",
  "Inventory",
  "Cursor",
  "Crafting Grid",
  "Anywhere"
];
var ITEM_AMOUNTS = [
  "Any Amount",
  "Equal or Greater Amount"
];
var PLACEHOLDER_SPECS = [
  { name: "server.name", valueType: "string", args: "none" },
  { name: "server.shortname", valueType: "string", args: "none" },
  { name: "player.name", valueType: "string", args: "none" },
  { name: "player.ping", valueType: "number", args: "none" },
  { name: "player.health", valueType: "number", args: "none" },
  { name: "player.maxhealth", valueType: "number", args: "none" },
  { name: "player.hunger", valueType: "number", args: "none" },
  { name: "player.experience", valueType: "number", args: "none" },
  { name: "player.level", valueType: "number", args: "none" },
  { name: "player.version", valueType: "string", args: "none" },
  { name: "player.protocol", valueType: "number", args: "none" },
  { name: "player.gamemode", valueType: "string", args: "none" },
  { name: "player.region.name", valueType: "string", args: "none" },
  { name: "player.location.x", valueType: "number", args: "none" },
  { name: "player.location.y", valueType: "number", args: "none" },
  { name: "player.location.z", valueType: "number", args: "none" },
  { name: "player.location.pitch", valueType: "number", args: "none" },
  { name: "player.location.yaw", valueType: "number", args: "none" },
  { name: "player.pos.x", valueType: "number", args: "none" },
  { name: "player.pos.y", valueType: "number", args: "none" },
  { name: "player.pos.z", valueType: "number", args: "none" },
  { name: "player.pos.pitch", valueType: "number", args: "none" },
  { name: "player.pos.yaw", valueType: "number", args: "none" },
  { name: "player.block.x", valueType: "number", args: "none" },
  { name: "player.block.y", valueType: "number", args: "none" },
  { name: "player.block.z", valueType: "number", args: "none" },
  { name: "player.group.name", valueType: "string", args: "none" },
  { name: "player.group.tag", valueType: "string", args: "none" },
  { name: "player.group.priority", valueType: "number", args: "none" },
  { name: "player.group.color", valueType: "string", args: "none" },
  { name: "player.team.name", valueType: "string", args: "none" },
  { name: "player.team.tag", valueType: "string", args: "none" },
  { name: "player.team.color", valueType: "string", args: "none" },
  { name: "player.team.players", valueType: "number", args: "team", completion: "player.team.players/Team Name" },
  { name: "player.parkour.ticks", valueType: "number", args: "none" },
  { name: "player.parkour.formatted", valueType: "string", args: "none" },
  { name: "house.name", valueType: "string", args: "none" },
  { name: "house.guests", valueType: "number", args: "none" },
  { name: "house.cookies", valueType: "number", args: "none" },
  { name: "house.visitingrules", valueType: "string", args: "none" },
  { name: "house.players", valueType: "number", args: "none" },
  { name: "date.day", valueType: "number", args: "none" },
  { name: "date.month", valueType: "number", args: "none" },
  { name: "date.year", valueType: "number", args: "none" },
  { name: "date.hour", valueType: "number", args: "none" },
  { name: "date.minute", valueType: "number", args: "none" },
  { name: "date.seconds", valueType: "number", args: "none" },
  { name: "date.unix", valueType: "number", args: "none" },
  { name: "date.unix.ms", valueType: "number", args: "none" },
  { name: "var.player", valueType: "number", args: "var", completion: "var.player/name" },
  { name: "var.global", valueType: "number", args: "var", completion: "var.global/name" },
  { name: "var.team", valueType: "number", args: "teamVar", completion: "var.team/name Team Name" },
  { name: "random.int", valueType: "number", args: "integerBounds", completion: "random.int/1 10" },
  { name: "random.whole", valueType: "number", args: "integerBounds", completion: "random.whole/1 10" },
  { name: "random.decimal", valueType: "number", args: "numberBounds", completion: "random.decimal/0 1" }
];
var PLACEHOLDER_COMPLETIONS = PLACEHOLDER_SPECS.map((placeholder) => "completion" in placeholder ? placeholder.completion : placeholder.name);
function getPlaceholderSpec(name) {
  const lower = name.toLowerCase();
  return PLACEHOLDER_SPECS.find((spec) => spec.name === lower);
}
function getPlaceholderValueTypeFromValue(value) {
  if (!value.startsWith("%") || !value.endsWith("%"))
    return void 0;
  const inner = value.slice(1, -1);
  const slash = inner.indexOf("/");
  const name = slash === -1 ? inner : inner.slice(0, slash);
  return getPlaceholderSpec(name)?.valueType;
}

// dist/types/actionSpecs.js
var f = (name, kind, optional = false) => ({
  name,
  kind,
  optional
});
var VAR_FIELDS = [
  f("name", "varName"),
  f("op", "varOp"),
  f("value", "value"),
  f("automaticUnset", "boolean", true)
];
var TEAM_VAR_FIELDS = [
  f("name", "varName"),
  f("team", "team"),
  f("op", "varOp"),
  f("value", "value"),
  f("automaticUnset", "boolean", true)
];
var ACTION_SPECS = [
  { kw: "actionBar", fields: [f("message", "string")] },
  { kw: "applyLayout", fields: [f("layout", "string")] },
  {
    kw: "applyPotion",
    fields: [
      f("effect", "potion"),
      f("duration", "number"),
      f("level", "number"),
      f("override", "boolean"),
      f("showIcon", "boolean", true)
    ]
  },
  { kw: "balanceTeam", fields: [] },
  { kw: "cancelEvent", fields: [] },
  {
    kw: "changeHealth",
    fields: [f("op", "operation"), f("amount", "value")]
  },
  {
    kw: "changePlayerGroup",
    fields: [
      f("group", "string"),
      f("demotionProtection", "boolean", true)
    ]
  },
  {
    kw: "changeVelocity",
    fields: [f("x", "value"), f("y", "value"), f("z", "value")]
  },
  {
    kw: "chat",
    fields: [f("message", "string")]
  },
  { kw: "clearEffects", fields: [] },
  { kw: "closeMenu", fields: [] },
  { kw: "compassTarget", fields: [f("location", "location")] },
  { kw: "consumeItem", fields: [] },
  { kw: "displayMenu", fields: [f("menu", "string")] },
  {
    kw: "displayNametag",
    fields: [f("displayNametag", "boolean")]
  },
  {
    kw: "dropItem",
    fields: [
      f("itemName", "item"),
      f("location", "location", true),
      f("dropNaturally", "boolean", true),
      f("disableMerging", "boolean", true),
      f("prioritizePlayer", "boolean", true),
      f("inventoryFallback", "boolean", true),
      f("despawnDurationTicks", "value", true),
      f("pickupDelayTicks", "value", true)
    ]
  },
  {
    kw: "enchant",
    fields: [f("enchant", "enchant"), f("level", "number")]
  },
  { kw: "exit", fields: [] },
  { kw: "failParkour", fields: [f("message", "string")] },
  { kw: "fullHeal", fields: [] },
  {
    kw: "function",
    fields: [f("function", "function"), f("global", "boolean", true)]
  },
  { kw: "gamemode", fields: [f("gamemode", "gamemode")] },
  {
    kw: "giveItem",
    fields: [
      f("itemName", "item"),
      f("allowMultiple", "boolean", true),
      f("slot", "slot", true),
      f("replaceExisting", "boolean", true)
    ]
  },
  { kw: "globalstat", fields: VAR_FIELDS },
  { kw: "globalvar", fields: VAR_FIELDS },
  {
    kw: "hungerLevel",
    fields: [f("op", "operation"), f("amount", "value")]
  },
  {
    kw: "if",
    fields: [
      f("mode", "ifMode"),
      f("conditions", "block"),
      f("ifActions", "block"),
      f("elseActions", "block", true)
    ]
  },
  { kw: "kill", fields: [] },
  {
    kw: "launchTarget",
    fields: [f("location", "location"), f("strength", "number")]
  },
  { kw: "lobby", fields: [f("lobby", "lobby")] },
  {
    kw: "maxHealth",
    fields: [f("op", "operation"), f("amount", "value")]
  },
  { kw: "parkCheck", fields: [] },
  { kw: "pause", fields: [f("ticks", "number")] },
  {
    kw: "playerTime",
    fields: [f("time", "time")]
  },
  {
    kw: "playerWeather",
    fields: [f("weather", "weather")]
  },
  { kw: "random", fields: [f("actions", "block")] },
  { kw: "removeItem", fields: [f("itemName", "item")] },
  { kw: "resetInventory", fields: [] },
  { kw: "setTeam", fields: [f("team", "team")] },
  {
    kw: "sound",
    fields: [
      f("sound", "string"),
      f("volume", "number", true),
      f("pitch", "number", true),
      f("location", "location", true)
    ]
  },
  { kw: "stat", fields: VAR_FIELDS },
  { kw: "teamstat", fields: TEAM_VAR_FIELDS },
  { kw: "teamvar", fields: TEAM_VAR_FIELDS },
  {
    kw: "title",
    fields: [
      f("title", "string"),
      f("subtitle", "string", true),
      f("fadein", "number", true),
      f("stay", "number", true),
      f("fadeout", "number", true)
    ]
  },
  {
    kw: "tp",
    fields: [
      f("location", "location"),
      f("preventTeleportInsideBlocks", "boolean", true)
    ]
  },
  { kw: "var", fields: VAR_FIELDS },
  { kw: "xpLevel", fields: [f("amount", "value")] }
];
var ACTION_SPECS_BY_KW = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const spec of ACTION_SPECS)
    map.set(spec.kw.toLowerCase(), spec);
  return map;
})();
var COMPARE_HEALTH_FIELDS = [
  f("op", "comparison"),
  f("amount", "value")
];
var CONDITION_SPECS = [
  { kw: "blockType", fields: [f("itemName", "item")] },
  {
    kw: "damageAmount",
    fields: [f("op", "comparison"), f("amount", "value")]
  },
  { kw: "damageCause", fields: [f("cause", "damageCause")] },
  { kw: "doingParkour", fields: [] },
  { kw: "fishingEnv", fields: [f("environment", "fishingEnv")] },
  { kw: "gamemode", fields: [f("gamemode", "gamemode")] },
  {
    kw: "hasGroup",
    fields: [
      f("group", "group"),
      f("includeHigherGroups", "boolean", true)
    ]
  },
  {
    kw: "hasItem",
    fields: [
      f("itemName", "item"),
      f("whatToCheck", "itemProperty", true),
      f("whereToCheck", "itemLocation", true),
      f("amount", "itemAmount", true)
    ]
  },
  { kw: "hasPermission", fields: [f("permission", "permission")] },
  { kw: "hasPotion", fields: [f("effect", "potion")] },
  { kw: "hasTeam", fields: [f("team", "team")] },
  { kw: "health", fields: COMPARE_HEALTH_FIELDS },
  { kw: "hunger", fields: COMPARE_HEALTH_FIELDS },
  { kw: "inRegion", fields: [f("region", "string")] },
  { kw: "isFlying", fields: [] },
  { kw: "isItem", fields: [f("itemName", "item")] },
  { kw: "isSneaking", fields: [] },
  { kw: "maxHealth", fields: COMPARE_HEALTH_FIELDS },
  { kw: "canPvp", fields: [] },
  {
    kw: "placeholder",
    fields: [
      f("placeholder", "placeholder"),
      f("op", "comparison"),
      f("amount", "value"),
      f("fallback", "value", true)
    ]
  },
  { kw: "portal", fields: [f("portalType", "portal")] }
];
var CONDITION_SPECS_BY_KW = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const spec of CONDITION_SPECS)
    map.set(spec.kw.toLowerCase(), spec);
  return map;
})();

// dist/types/limits.js
var ACTION_LIMITS = {
  CONDITIONAL: 25,
  SET_GROUP: 1,
  KILL: 1,
  HEAL: 5,
  TITLE: 5,
  ACTION_BAR: 5,
  RESET_INVENTORY: 1,
  CHANGE_MAX_HEALTH: 5,
  PARKOUR_CHECKPOINT: 1,
  GIVE_ITEM: 40,
  REMOVE_ITEM: 40,
  MESSAGE: 20,
  APPLY_POTION_EFFECT: 22,
  CLEAR_POTION_EFFECTS: 5,
  GIVE_EXPERIENCE_LEVELS: 5,
  SEND_TO_LOBBY: 1,
  CHANGE_VAR: 25,
  TELEPORT: 5,
  FAIL_PARKOUR: 1,
  PLAY_SOUND: 25,
  SET_COMPASS_TARGET: 5,
  SET_GAMEMODE: 1,
  CHANGE_HEALTH: 5,
  CHANGE_HUNGER: 5,
  RANDOM: 25,
  FUNCTION: 10,
  APPLY_INVENTORY_LAYOUT: 5,
  ENCHANT_HELD_ITEM: 24,
  PAUSE: 30,
  SET_TEAM: 1,
  SET_MENU: 10,
  DROP_ITEM: 5,
  SET_VELOCITY: 5,
  LAUNCH: 5,
  SET_PLAYER_WEATHER: 5,
  SET_PLAYER_TIME: 5,
  TOGGLE_NAMETAG_DISPLAY: 5,
  EXIT: 1,
  CANCEL_EVENT: 1,
  CLOSE_MENU: 1,
  USE_HELD_ITEM: 1
};
var CONDITION_LIMITS = {
  REQUIRE_GROUP: 20,
  COMPARE_VAR: 20,
  REQUIRE_PERMISSION: 20,
  IS_IN_REGION: 20,
  REQUIRE_ITEM: 20,
  IS_DOING_PARKOUR: 1,
  REQUIRE_POTION_EFFECT: 22,
  IS_SNEAKING: 20,
  IS_FLYING: 20,
  COMPARE_HEALTH: 20,
  COMPARE_MAX_HEALTH: 20,
  COMPARE_HUNGER: 20,
  REQUIRE_GAMEMODE: 20,
  COMPARE_PLACEHOLDER: 20,
  REQUIRE_TEAM: 20,
  PVP_ENABLED: 20,
  FISHING_ENVIRONMENT: 20,
  PORTAL_TYPE: 20,
  DAMAGE_CAUSE: 20,
  COMPARE_DAMAGE: 20,
  BLOCK_TYPE: 20,
  IS_ITEM: 20
};
function getActionLimit(type, context) {
  if (type === "CONDITIONAL" && context.importable === "events" && context.nested === void 0) {
    return 40;
  }
  return ACTION_LIMITS[type];
}
function getConditionLimit(type) {
  return CONDITION_LIMITS[type];
}

// dist/check/passes/checkScope.js
var EVENT_SCOPED_CONDITIONS = {
  COMPARE_DAMAGE: ["Player Damage"],
  DAMAGE_CAUSE: ["Player Damage"],
  PVP_ENABLED: ["PvP State Change"],
  FISHING_ENVIRONMENT: ["Fish Caught"],
  PORTAL_TYPE: ["Player Enter Portal"],
  BLOCK_TYPE: ["Player Block Break"],
  IS_ITEM: [
    "Player Drop Item",
    "Player Pick Up Item",
    "Player Change Held Item"
  ]
};
var EVENT_FORBIDDEN_ACTIONS = {
  "Player Quit": [
    "SET_GROUP",
    "HEAL",
    "TITLE",
    "ACTION_BAR",
    "RESET_INVENTORY",
    "CHANGE_MAX_HEALTH",
    "PARKOUR_CHECKPOINT",
    "GIVE_ITEM",
    "REMOVE_ITEM",
    "MESSAGE",
    "APPLY_POTION_EFFECT",
    "CLEAR_POTION_EFFECTS",
    "GIVE_EXPERIENCE_LEVELS",
    "TELEPORT",
    "FAIL_PARKOUR",
    "PLAY_SOUND",
    "SET_COMPASS_TARGET",
    "SET_GAMEMODE",
    "CHANGE_HEALTH",
    "CHANGE_HUNGER",
    "APPLY_INVENTORY_LAYOUT",
    "ENCHANT_HELD_ITEM",
    "SET_TEAM",
    "SET_MENU",
    "DROP_ITEM",
    "SET_VELOCITY",
    "LAUNCH",
    "SET_PLAYER_WEATHER",
    "SET_PLAYER_TIME",
    "TOGGLE_NAMETAG_DISPLAY"
  ],
  "Group Change": ["SET_GROUP"]
};
var ALL_EVENT_FORBIDDEN_ACTIONS = [
  "KILL",
  "SEND_TO_LOBBY"
];
var NESTED_CONTAINER_FORBIDDEN_ACTIONS = [
  "CONDITIONAL",
  "RANDOM"
];
function checkActionContext(gcx) {
  for (const importable of gcx.importables) {
    if (importable.type === "FUNCTION") {
      checkAll(gcx, checkActionInFunction, importable.actions, { container: "functions" });
    } else if (importable.type === "EVENT") {
      checkAll(gcx, checkActionInEvent, importable.actions, {
        container: "events",
        event: importable.event
      });
    } else if (importable.type === "ITEM") {
      checkAll(gcx, checkActionInItem, importable.leftClickActions ?? [], { container: "items" });
      checkAll(gcx, checkActionInItem, importable.rightClickActions ?? [], { container: "items" });
    } else if (importable.type === "MENU") {
      for (const slot of importable.slots) {
        checkAll(gcx, checkActionInMenu, slot.actions ?? [], { container: "menus" });
      }
    } else if (importable.type === "REGION") {
      checkAll(gcx, checkActionInRegion, importable.onEnterActions ?? [], { container: "regions" });
      checkAll(gcx, checkActionInRegion, importable.onExitActions ?? [], { container: "regions" });
    } else if (importable.type === "NPC") {
      checkAll(gcx, checkActionInNpc, importable.leftClickActions ?? [], { container: "npcs" });
      checkAll(gcx, checkActionInNpc, importable.rightClickActions ?? [], { container: "npcs" });
    }
  }
}
function checkAll(gcx, check3, actions, scope) {
  for (const action of actions) {
    check3(gcx, action, scope);
    if (action.type === "CONDITIONAL") {
      checkAll(gcx, check3, action.ifActions, { ...scope, nested: "conditional" });
      checkAll(gcx, check3, action.elseActions, { ...scope, nested: "conditional" });
    } else if (action.type === "RANDOM") {
      checkAll(gcx, check3, action.actions, { ...scope, nested: "random" });
    }
  }
}
function checkActionInFunction(gcx, action, scope) {
  checkNestedScope(gcx, action, scope);
  checkNotCancelEvent(gcx, action, "functions");
  checkConditionScopes(gcx, action, void 0);
  checkNotItemOnly(gcx, action, "functions");
  checkNotMenuOnly(gcx, action, "functions");
  checkExitScope(gcx, action, scope);
}
var CANCELLABLE_EVENTS = [
  "Player Death",
  "Fish Caught",
  "Player Damage",
  "Player Drop Item",
  "Player Pick Up Item",
  "Player Change Held Item",
  "Player Toggle Sneak",
  "Player Toggle Flight"
];
var ITEM_ONLY_ACTIONS = {
  USE_HELD_ITEM: "Use/Remove Held Item"
};
var MENU_ONLY_ACTIONS = {
  CLOSE_MENU: "Close Menu"
};
function checkActionInEvent(gcx, action, scope) {
  const event = scope.event;
  if (!event) {
    return;
  }
  checkNestedScope(gcx, action, scope);
  if (ALL_EVENT_FORBIDDEN_ACTIONS.includes(action.type)) {
    gcx.addDiagnostic(Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside events`).addPrimarySpan(gcx.spans.getField(action, "type")));
  }
  if (!CANCELLABLE_EVENTS.includes(event) && action.type === "CANCEL_EVENT") {
    gcx.addDiagnostic(Diagnostic.error(`${event} event cannot be cancelled.`).addPrimarySpan(gcx.spans.getField(action, "type")));
  }
  checkNotForbiddenInEvent(gcx, action, event);
  checkConditionScopes(gcx, action, event);
  checkNotItemOnly(gcx, action, "events");
  checkNotMenuOnly(gcx, action, "events");
  checkExitScope(gcx, action, scope);
}
function checkActionInRegion(gcx, action, scope) {
  checkNestedScope(gcx, action, scope);
  checkNotCancelEvent(gcx, action, "regions");
  checkConditionScopes(gcx, action, void 0);
  checkNotItemOnly(gcx, action, "regions");
  checkNotMenuOnly(gcx, action, "regions");
  checkExitScope(gcx, action, scope);
}
function checkActionInItem(gcx, action, scope) {
  checkNestedScope(gcx, action, scope);
  checkNotCancelEvent(gcx, action, "items");
  checkConditionScopes(gcx, action, void 0);
  checkNotMenuOnly(gcx, action, "items");
  checkExitScope(gcx, action, scope);
  if (action.type === "CONDITIONAL" || action.type === "RANDOM") {
    gcx.addDiagnostic(Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside items`).addPrimarySpan(gcx.spans.getField(action, "type")));
  }
}
function checkActionInMenu(gcx, action, scope) {
  checkNestedScope(gcx, action, scope);
  checkNotCancelEvent(gcx, action, "menus");
  checkConditionScopes(gcx, action, void 0);
  checkNotItemOnly(gcx, action, "menus");
  checkExitScope(gcx, action, scope);
}
function checkActionInNpc(gcx, action, scope) {
  checkNestedScope(gcx, action, scope);
  checkNotCancelEvent(gcx, action, "npcs");
  checkConditionScopes(gcx, action, void 0);
  checkNotMenuOnly(gcx, action, "npcs");
  checkExitScope(gcx, action, scope);
}
function checkNotCancelEvent(gcx, action, context) {
  if (action.type === "CANCEL_EVENT") {
    gcx.addDiagnostic(Diagnostic.error(`Cancel Event action cannot be used inside ${context}`).addPrimarySpan(gcx.spans.getField(action, "type")));
  }
}
function checkNotItemOnly(gcx, action, context) {
  const displayName = ITEM_ONLY_ACTIONS[action.type];
  if (displayName) {
    gcx.addDiagnostic(Diagnostic.error(`${displayName} action can only be used inside items`).addPrimarySpan(gcx.spans.getField(action, "type")).addSecondarySpan(gcx.spans.getField(action, "type"), context));
  }
}
function checkNotMenuOnly(gcx, action, context) {
  const displayName = MENU_ONLY_ACTIONS[action.type];
  if (displayName) {
    gcx.addDiagnostic(Diagnostic.error(`${displayName} action can only be used inside menus`).addPrimarySpan(gcx.spans.getField(action, "type")).addSecondarySpan(gcx.spans.getField(action, "type"), context));
  }
}
function checkNotForbiddenInEvent(gcx, action, event) {
  if (!EVENT_FORBIDDEN_ACTIONS[event]?.includes(action.type)) {
    return;
  }
  gcx.addDiagnostic(Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside ${event} events`).addPrimarySpan(gcx.spans.getField(action, "type")));
}
function checkNestedScope(gcx, action, scope) {
  if (!scope.nested || !NESTED_CONTAINER_FORBIDDEN_ACTIONS.includes(action.type)) {
    return;
  }
  gcx.addDiagnostic(Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside ${scope.nested} actions`).addPrimarySpan(gcx.spans.getField(action, "type")));
}
function checkExitScope(gcx, action, scope) {
  if (action.type !== "EXIT" || scope.nested) {
    return;
  }
  gcx.addDiagnostic(Diagnostic.error("Exit action can only be used inside conditional or random actions").addPrimarySpan(gcx.spans.getField(action, "type")));
}
function checkConditionScopes(gcx, action, event) {
  if (action.type !== "CONDITIONAL") {
    return;
  }
  for (const condition of action.conditions) {
    const allowedEvents = EVENT_SCOPED_CONDITIONS[condition.type];
    if (!allowedEvents) {
      continue;
    }
    if (event && allowedEvents.includes(event)) {
      continue;
    }
    const context = event ? `${event} event` : "this context";
    const allowed = allowedEvents.join(", ");
    gcx.addDiagnostic(Diagnostic.error(`${condition.type} condition can only be used inside: ${allowed}. It cannot be used in ${context}.`).addPrimarySpan(gcx.spans.getField(condition, "type")));
  }
}

// dist/check/helpers.js
function getActions(gcx) {
  const res = [];
  for (const importable of gcx.importables) {
    if (importable.type === "FUNCTION") {
      res.push(...importable.actions);
    } else if (importable.type === "REGION") {
      res.push(...importable.onEnterActions ?? []);
      res.push(...importable.onExitActions ?? []);
    } else if (importable.type === "EVENT") {
      res.push(...importable.actions);
    } else if (importable.type === "ITEM") {
      res.push(...importable.leftClickActions ?? []);
      res.push(...importable.rightClickActions ?? []);
    }
  }
  return res;
}
function getTags(gcx) {
  const res = [];
  for (const importable of gcx.importables) {
    if (importable.type === "ITEM") {
      res.push(importable.nbt);
    }
  }
  return res;
}

// dist/check/passes/checkNestedConditionals.js
function checkNestedConditionals(gcx) {
  for (const action of getActions(gcx)) {
    checkAction(gcx, action);
  }
}
function checkAction(gcx, action) {
  if (action.type === "CONDITIONAL") {
    const subActions = action.ifActions.concat(action.elseActions);
    for (const subAction of subActions) {
      if (subAction.type === "CONDITIONAL") {
        gcx.addDiagnostic(Diagnostic.error("Nested Conditional actions are not allowed").addPrimarySpan(gcx.spans.getField(subAction, "type")));
      }
      if (subAction.type === "RANDOM") {
        gcx.addDiagnostic(Diagnostic.error("Random actions are not allowed inside Conditional actions").addPrimarySpan(gcx.spans.getField(subAction, "type")));
      }
    }
  } else if (action.type === "RANDOM") {
    const subActions = action.actions;
    for (const subAction of subActions) {
      if (subAction.type === "CONDITIONAL") {
        gcx.addDiagnostic(Diagnostic.error("Nested Random actions are not allowed").addPrimarySpan(gcx.spans.getField(subAction, "type")));
      }
      if (subAction.type === "RANDOM") {
        gcx.addDiagnostic(Diagnostic.error("Conditional actions are not allowed inside Random actions").addPrimarySpan(gcx.spans.getField(subAction, "type")));
      }
    }
  }
}

// dist/check/passes/checkNbt.js
function checkNbt(gcx) {
  const tags = getTags(gcx);
  for (const tag of tags) {
    checkTag(gcx, tag);
  }
}
function checkTag(gcx, tag) {
  if (tag.type !== "compound") {
    gcx.addDiagnostic(Diagnostic.error("Expected NBT tag compound").addPrimarySpan(gcx.spans.get(tag)));
    return;
  }
  checkTagId(gcx, tag);
  checkTagCount(gcx, tag);
}
function checkTagId(gcx, tag) {
  const tagId = tag.value["id"];
  if (tagId === void 0) {
    gcx.addDiagnostic(Diagnostic.error("Missing required tag 'id'").addPrimarySpan(gcx.spans.get(tag).endSpan()));
    return;
  }
  if (tagId.type !== "string") {
    gcx.addDiagnostic(Diagnostic.error("Expected string").addPrimarySpan(gcx.spans.get(tagId)));
    return;
  }
  const id = tagId.value;
  let idFound = false;
  for (const item of items_default) {
    if (id === `minecraft:${item.name}`) {
      idFound = true;
    }
  }
  if (!idFound) {
    gcx.addDiagnostic(Diagnostic.error("Invalid item id").addPrimarySpan(gcx.spans.get(tagId)));
    return;
  }
}
function checkTagCount(gcx, tag) {
  const tagCount = tag.value["Count"];
  if (tagCount === void 0) {
    gcx.addDiagnostic(Diagnostic.error("Missing required tag 'Count'").addPrimarySpan(gcx.spans.get(tag).endSpan()));
    return;
  }
  if (tagCount.type !== "byte") {
    gcx.addDiagnostic(Diagnostic.error("Expected byte").addPrimarySpan(gcx.spans.get(tagCount)));
    return;
  }
  const count = tagCount.value;
  if (count < 0) {
    gcx.addDiagnostic(Diagnostic.error("Count must be greater than or equal to 0").addPrimarySpan(gcx.spans.get(tagCount)));
    return;
  }
  if (count > 64) {
    gcx.addDiagnostic(Diagnostic.error("Count must be less than or equal to 64").addPrimarySpan(gcx.spans.get(tagCount)));
    return;
  }
}

// dist/spanTable.js
var SpanTable = class {
  nodeSpans = /* @__PURE__ */ new WeakMap();
  fieldSpans = /* @__PURE__ */ new WeakMap();
  set(node, span) {
    this.nodeSpans.set(node, span);
  }
  get(node) {
    const span = this.nodeSpans.get(node);
    if (!span)
      throw Error(`Missing span for reference: ${node}`);
    return span;
  }
  setField(node, key, span) {
    let map = this.fieldSpans.get(node);
    if (!map) {
      map = /* @__PURE__ */ new Map();
      this.fieldSpans.set(node, map);
    }
    map.set(key, span);
  }
  getField(node, key) {
    const span = this.fieldSpans.get(node)?.get(key);
    if (!span)
      throw Error(`Missing span for field ${String(key)} of reference: ${node}`);
    return span;
  }
};

// dist/span.js
var Span = class _Span {
  start;
  end;
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  static at(pos) {
    return new _Span(pos, pos);
  }
  static single(pos) {
    return new _Span(pos, pos + 1);
  }
  static dummy() {
    return _Span.at(-1);
  }
  startSpan() {
    return _Span.single(this.start);
  }
  endSpan() {
    return _Span.single(this.end - 1);
  }
  to(other) {
    const start = Math.min(this.start, other.start);
    const end = Math.max(this.end, other.end);
    return new _Span(start, end);
  }
};

// dist/nbt/parse/token.js
function token(kind, span, props) {
  return { kind, span, ...props };
}
var TOKEN_NAMES = {
  open_delim: "opening delimiter",
  close_delim: "closing delimiter",
  colon: ":",
  semicolon: ";",
  comma: ",",
  str: "string",
  bare: "literal",
  eof: "end of file",
  unknown: "unknown token"
};
function tokenToString(tok) {
  if (typeof tok === "string")
    return TOKEN_NAMES[tok];
  switch (tok.kind) {
    case "open_delim":
      if (tok.delim === "brace")
        return "{";
      if (tok.delim === "bracket")
        return "[";
      return TOKEN_NAMES.open_delim;
    case "close_delim":
      if (tok.delim === "brace")
        return "}";
      if (tok.delim === "bracket")
        return "]";
      return TOKEN_NAMES.close_delim;
    case "unknown":
      return tok.value ?? TOKEN_NAMES.unknown;
    case void 0:
      throw Error("undefined token kind");
    default:
      return TOKEN_NAMES[tok.kind];
  }
}

// dist/nbt/parse/lexer.js
var Lexer = class {
  src;
  pos;
  posOffset;
  constructor(src, posOffset = 0) {
    this.src = src;
    this.pos = 0;
    this.posOffset = posOffset;
  }
  advanceToken() {
    while (this.hasNext() && /\s/.test(this.peek())) {
      this.next();
    }
    if (!this.hasNext()) {
      return token("eof", new Span(this.posWithOffset, this.posWithOffset));
    }
    const lo = this.posWithOffset;
    const c = this.next();
    if (c === "{")
      return token("open_delim", Span.single(lo), { delim: "brace" });
    if (c === "}")
      return token("close_delim", Span.single(lo), { delim: "brace" });
    if (c === "[")
      return token("open_delim", Span.single(lo), { delim: "bracket" });
    if (c === "]")
      return token("close_delim", Span.single(lo), { delim: "bracket" });
    if (c === ":")
      return token("colon", Span.single(lo));
    if (c === ";")
      return token("semicolon", Span.single(lo));
    if (c === ",")
      return token("comma", Span.single(lo));
    if (c === '"' || c === "'") {
      const quote = c;
      let value = "";
      let escaped = false;
      while (this.hasNext()) {
        const ch = this.next();
        if (escaped) {
          value += decodeEscape(ch);
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === quote) {
          return token("str", new Span(lo, this.posWithOffset), { value });
        }
        value += ch;
      }
      return token("str", new Span(lo, this.posWithOffset), { value });
    }
    if (isBareStart(c)) {
      let value = c;
      while (this.hasNext() && isBareChar(this.peek())) {
        value += this.next();
      }
      return token("bare", new Span(lo, this.posWithOffset), { value });
    }
    return token("unknown", Span.single(lo), { value: c });
  }
  get posWithOffset() {
    return this.pos + this.posOffset;
  }
  hasNext() {
    return this.pos < this.src.length;
  }
  next() {
    return this.src.charAt(this.pos++);
  }
  peek(skip) {
    return this.src.charAt(this.pos + (skip ?? 0));
  }
};
function isBareStart(ch) {
  return /[A-Za-z0-9+\-.]/.test(ch);
}
function isBareChar(ch) {
  return /[A-Za-z0-9+\-._]/.test(ch);
}
function decodeEscape(ch) {
  if (ch === "n")
    return "\n";
  if (ch === "r")
    return "\r";
  if (ch === "t")
    return "	";
  return ch;
}

// node_modules/long/index.js
var wasm = null;
try {
  wasm = new WebAssembly.Instance(
    new WebAssembly.Module(
      new Uint8Array([
        // \0asm
        0,
        97,
        115,
        109,
        // version 1
        1,
        0,
        0,
        0,
        // section "type"
        1,
        13,
        2,
        // 0, () => i32
        96,
        0,
        1,
        127,
        // 1, (i32, i32, i32, i32) => i32
        96,
        4,
        127,
        127,
        127,
        127,
        1,
        127,
        // section "function"
        3,
        7,
        6,
        // 0, type 0
        0,
        // 1, type 1
        1,
        // 2, type 1
        1,
        // 3, type 1
        1,
        // 4, type 1
        1,
        // 5, type 1
        1,
        // section "global"
        6,
        6,
        1,
        // 0, "high", mutable i32
        127,
        1,
        65,
        0,
        11,
        // section "export"
        7,
        50,
        6,
        // 0, "mul"
        3,
        109,
        117,
        108,
        0,
        1,
        // 1, "div_s"
        5,
        100,
        105,
        118,
        95,
        115,
        0,
        2,
        // 2, "div_u"
        5,
        100,
        105,
        118,
        95,
        117,
        0,
        3,
        // 3, "rem_s"
        5,
        114,
        101,
        109,
        95,
        115,
        0,
        4,
        // 4, "rem_u"
        5,
        114,
        101,
        109,
        95,
        117,
        0,
        5,
        // 5, "get_high"
        8,
        103,
        101,
        116,
        95,
        104,
        105,
        103,
        104,
        0,
        0,
        // section "code"
        10,
        191,
        1,
        6,
        // 0, "get_high"
        4,
        0,
        35,
        0,
        11,
        // 1, "mul"
        36,
        1,
        1,
        126,
        32,
        0,
        173,
        32,
        1,
        173,
        66,
        32,
        134,
        132,
        32,
        2,
        173,
        32,
        3,
        173,
        66,
        32,
        134,
        132,
        126,
        34,
        4,
        66,
        32,
        135,
        167,
        36,
        0,
        32,
        4,
        167,
        11,
        // 2, "div_s"
        36,
        1,
        1,
        126,
        32,
        0,
        173,
        32,
        1,
        173,
        66,
        32,
        134,
        132,
        32,
        2,
        173,
        32,
        3,
        173,
        66,
        32,
        134,
        132,
        127,
        34,
        4,
        66,
        32,
        135,
        167,
        36,
        0,
        32,
        4,
        167,
        11,
        // 3, "div_u"
        36,
        1,
        1,
        126,
        32,
        0,
        173,
        32,
        1,
        173,
        66,
        32,
        134,
        132,
        32,
        2,
        173,
        32,
        3,
        173,
        66,
        32,
        134,
        132,
        128,
        34,
        4,
        66,
        32,
        135,
        167,
        36,
        0,
        32,
        4,
        167,
        11,
        // 4, "rem_s"
        36,
        1,
        1,
        126,
        32,
        0,
        173,
        32,
        1,
        173,
        66,
        32,
        134,
        132,
        32,
        2,
        173,
        32,
        3,
        173,
        66,
        32,
        134,
        132,
        129,
        34,
        4,
        66,
        32,
        135,
        167,
        36,
        0,
        32,
        4,
        167,
        11,
        // 5, "rem_u"
        36,
        1,
        1,
        126,
        32,
        0,
        173,
        32,
        1,
        173,
        66,
        32,
        134,
        132,
        32,
        2,
        173,
        32,
        3,
        173,
        66,
        32,
        134,
        132,
        130,
        34,
        4,
        66,
        32,
        135,
        167,
        36,
        0,
        32,
        4,
        167,
        11
      ])
    ),
    {}
  ).exports;
} catch {
}
function Long(low, high, unsigned) {
  this.low = low | 0;
  this.high = high | 0;
  this.unsigned = !!unsigned;
}
Long.prototype.__isLong__;
Object.defineProperty(Long.prototype, "__isLong__", { value: true });
function isLong(obj) {
  return (obj && obj["__isLong__"]) === true;
}
function ctz32(value) {
  var c = Math.clz32(value & -value);
  return value ? 31 - c : c;
}
Long.isLong = isLong;
var INT_CACHE = {};
var UINT_CACHE = {};
function fromInt(value, unsigned) {
  var obj, cachedObj, cache;
  if (unsigned) {
    value >>>= 0;
    if (cache = 0 <= value && value < 256) {
      cachedObj = UINT_CACHE[value];
      if (cachedObj) return cachedObj;
    }
    obj = fromBits(value, 0, true);
    if (cache) UINT_CACHE[value] = obj;
    return obj;
  } else {
    value |= 0;
    if (cache = -128 <= value && value < 128) {
      cachedObj = INT_CACHE[value];
      if (cachedObj) return cachedObj;
    }
    obj = fromBits(value, value < 0 ? -1 : 0, false);
    if (cache) INT_CACHE[value] = obj;
    return obj;
  }
}
Long.fromInt = fromInt;
function fromNumber(value, unsigned) {
  if (isNaN(value)) return unsigned ? UZERO : ZERO;
  if (unsigned) {
    if (value < 0) return UZERO;
    if (value >= TWO_PWR_64_DBL) return MAX_UNSIGNED_VALUE;
  } else {
    if (value <= -TWO_PWR_63_DBL) return MIN_VALUE;
    if (value + 1 >= TWO_PWR_63_DBL) return MAX_VALUE;
  }
  if (value < 0) return fromNumber(-value, unsigned).neg();
  return fromBits(
    value % TWO_PWR_32_DBL | 0,
    value / TWO_PWR_32_DBL | 0,
    unsigned
  );
}
Long.fromNumber = fromNumber;
function fromBits(lowBits, highBits, unsigned) {
  return new Long(lowBits, highBits, unsigned);
}
Long.fromBits = fromBits;
var pow_dbl = Math.pow;
function fromString(str, unsigned, radix) {
  if (str.length === 0) throw Error("empty string");
  if (typeof unsigned === "number") {
    radix = unsigned;
    unsigned = false;
  } else {
    unsigned = !!unsigned;
  }
  if (str === "NaN" || str === "Infinity" || str === "+Infinity" || str === "-Infinity")
    return unsigned ? UZERO : ZERO;
  radix = radix || 10;
  if (radix < 2 || 36 < radix) throw RangeError("radix");
  var p;
  if ((p = str.indexOf("-")) > 0) throw Error("interior hyphen");
  else if (p === 0) {
    return fromString(str.substring(1), unsigned, radix).neg();
  }
  var radixToPower = fromNumber(pow_dbl(radix, 8));
  var result = ZERO;
  for (var i = 0; i < str.length; i += 8) {
    var size = Math.min(8, str.length - i), value = parseInt(str.substring(i, i + size), radix);
    if (size < 8) {
      var power = fromNumber(pow_dbl(radix, size));
      result = result.mul(power).add(fromNumber(value));
    } else {
      result = result.mul(radixToPower);
      result = result.add(fromNumber(value));
    }
  }
  result.unsigned = unsigned;
  return result;
}
Long.fromString = fromString;
function fromValue(val, unsigned) {
  if (typeof val === "number") return fromNumber(val, unsigned);
  if (typeof val === "string") return fromString(val, unsigned);
  return fromBits(
    val.low,
    val.high,
    typeof unsigned === "boolean" ? unsigned : val.unsigned
  );
}
Long.fromValue = fromValue;
var TWO_PWR_16_DBL = 1 << 16;
var TWO_PWR_24_DBL = 1 << 24;
var TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;
var TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL;
var TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2;
var TWO_PWR_24 = fromInt(TWO_PWR_24_DBL);
var ZERO = fromInt(0);
Long.ZERO = ZERO;
var UZERO = fromInt(0, true);
Long.UZERO = UZERO;
var ONE = fromInt(1);
Long.ONE = ONE;
var UONE = fromInt(1, true);
Long.UONE = UONE;
var NEG_ONE = fromInt(-1);
Long.NEG_ONE = NEG_ONE;
var MAX_VALUE = fromBits(4294967295 | 0, 2147483647 | 0, false);
Long.MAX_VALUE = MAX_VALUE;
var MAX_UNSIGNED_VALUE = fromBits(4294967295 | 0, 4294967295 | 0, true);
Long.MAX_UNSIGNED_VALUE = MAX_UNSIGNED_VALUE;
var MIN_VALUE = fromBits(0, 2147483648 | 0, false);
Long.MIN_VALUE = MIN_VALUE;
var LongPrototype = Long.prototype;
LongPrototype.toInt = function toInt() {
  return this.unsigned ? this.low >>> 0 : this.low;
};
LongPrototype.toNumber = function toNumber() {
  if (this.unsigned)
    return (this.high >>> 0) * TWO_PWR_32_DBL + (this.low >>> 0);
  return this.high * TWO_PWR_32_DBL + (this.low >>> 0);
};
LongPrototype.toString = function toString(radix) {
  radix = radix || 10;
  if (radix < 2 || 36 < radix) throw RangeError("radix");
  if (this.isZero()) return "0";
  if (this.isNegative()) {
    if (this.eq(MIN_VALUE)) {
      var radixLong = fromNumber(radix), div = this.div(radixLong), rem1 = div.mul(radixLong).sub(this);
      return div.toString(radix) + rem1.toInt().toString(radix);
    } else return "-" + this.neg().toString(radix);
  }
  var radixToPower = fromNumber(pow_dbl(radix, 6), this.unsigned), rem = this;
  var result = "";
  while (true) {
    var remDiv = rem.div(radixToPower), intval = rem.sub(remDiv.mul(radixToPower)).toInt() >>> 0, digits = intval.toString(radix);
    rem = remDiv;
    if (rem.isZero()) return digits + result;
    else {
      while (digits.length < 6) digits = "0" + digits;
      result = "" + digits + result;
    }
  }
};
LongPrototype.getHighBits = function getHighBits() {
  return this.high;
};
LongPrototype.getHighBitsUnsigned = function getHighBitsUnsigned() {
  return this.high >>> 0;
};
LongPrototype.getLowBits = function getLowBits() {
  return this.low;
};
LongPrototype.getLowBitsUnsigned = function getLowBitsUnsigned() {
  return this.low >>> 0;
};
LongPrototype.getNumBitsAbs = function getNumBitsAbs() {
  if (this.isNegative())
    return this.eq(MIN_VALUE) ? 64 : this.neg().getNumBitsAbs();
  var val = this.high != 0 ? this.high : this.low;
  for (var bit = 31; bit > 0; bit--) if ((val & 1 << bit) != 0) break;
  return this.high != 0 ? bit + 33 : bit + 1;
};
LongPrototype.isSafeInteger = function isSafeInteger() {
  var top11Bits = this.high >> 21;
  if (!top11Bits) return true;
  if (this.unsigned) return false;
  return top11Bits === -1 && !(this.low === 0 && this.high === -2097152);
};
LongPrototype.isZero = function isZero() {
  return this.high === 0 && this.low === 0;
};
LongPrototype.eqz = LongPrototype.isZero;
LongPrototype.isNegative = function isNegative() {
  return !this.unsigned && this.high < 0;
};
LongPrototype.isPositive = function isPositive() {
  return this.unsigned || this.high >= 0;
};
LongPrototype.isOdd = function isOdd() {
  return (this.low & 1) === 1;
};
LongPrototype.isEven = function isEven() {
  return (this.low & 1) === 0;
};
LongPrototype.equals = function equals(other) {
  if (!isLong(other)) other = fromValue(other);
  if (this.unsigned !== other.unsigned && this.high >>> 31 === 1 && other.high >>> 31 === 1)
    return false;
  return this.high === other.high && this.low === other.low;
};
LongPrototype.eq = LongPrototype.equals;
LongPrototype.notEquals = function notEquals(other) {
  return !this.eq(
    /* validates */
    other
  );
};
LongPrototype.neq = LongPrototype.notEquals;
LongPrototype.ne = LongPrototype.notEquals;
LongPrototype.lessThan = function lessThan(other) {
  return this.comp(
    /* validates */
    other
  ) < 0;
};
LongPrototype.lt = LongPrototype.lessThan;
LongPrototype.lessThanOrEqual = function lessThanOrEqual(other) {
  return this.comp(
    /* validates */
    other
  ) <= 0;
};
LongPrototype.lte = LongPrototype.lessThanOrEqual;
LongPrototype.le = LongPrototype.lessThanOrEqual;
LongPrototype.greaterThan = function greaterThan(other) {
  return this.comp(
    /* validates */
    other
  ) > 0;
};
LongPrototype.gt = LongPrototype.greaterThan;
LongPrototype.greaterThanOrEqual = function greaterThanOrEqual(other) {
  return this.comp(
    /* validates */
    other
  ) >= 0;
};
LongPrototype.gte = LongPrototype.greaterThanOrEqual;
LongPrototype.ge = LongPrototype.greaterThanOrEqual;
LongPrototype.compare = function compare(other) {
  if (!isLong(other)) other = fromValue(other);
  if (this.eq(other)) return 0;
  var thisNeg = this.isNegative(), otherNeg = other.isNegative();
  if (thisNeg && !otherNeg) return -1;
  if (!thisNeg && otherNeg) return 1;
  if (!this.unsigned) return this.sub(other).isNegative() ? -1 : 1;
  return other.high >>> 0 > this.high >>> 0 || other.high === this.high && other.low >>> 0 > this.low >>> 0 ? -1 : 1;
};
LongPrototype.comp = LongPrototype.compare;
LongPrototype.negate = function negate() {
  if (!this.unsigned && this.eq(MIN_VALUE)) return MIN_VALUE;
  return this.not().add(ONE);
};
LongPrototype.neg = LongPrototype.negate;
LongPrototype.add = function add(addend) {
  if (!isLong(addend)) addend = fromValue(addend);
  var a48 = this.high >>> 16;
  var a32 = this.high & 65535;
  var a16 = this.low >>> 16;
  var a00 = this.low & 65535;
  var b48 = addend.high >>> 16;
  var b32 = addend.high & 65535;
  var b16 = addend.low >>> 16;
  var b00 = addend.low & 65535;
  var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
  c00 += a00 + b00;
  c16 += c00 >>> 16;
  c00 &= 65535;
  c16 += a16 + b16;
  c32 += c16 >>> 16;
  c16 &= 65535;
  c32 += a32 + b32;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c48 += a48 + b48;
  c48 &= 65535;
  return fromBits(c16 << 16 | c00, c48 << 16 | c32, this.unsigned);
};
LongPrototype.subtract = function subtract(subtrahend) {
  if (!isLong(subtrahend)) subtrahend = fromValue(subtrahend);
  return this.add(subtrahend.neg());
};
LongPrototype.sub = LongPrototype.subtract;
LongPrototype.multiply = function multiply(multiplier) {
  if (this.isZero()) return this;
  if (!isLong(multiplier)) multiplier = fromValue(multiplier);
  if (wasm) {
    var low = wasm["mul"](this.low, this.high, multiplier.low, multiplier.high);
    return fromBits(low, wasm["get_high"](), this.unsigned);
  }
  if (multiplier.isZero()) return this.unsigned ? UZERO : ZERO;
  if (this.eq(MIN_VALUE)) return multiplier.isOdd() ? MIN_VALUE : ZERO;
  if (multiplier.eq(MIN_VALUE)) return this.isOdd() ? MIN_VALUE : ZERO;
  if (this.isNegative()) {
    if (multiplier.isNegative()) return this.neg().mul(multiplier.neg());
    else return this.neg().mul(multiplier).neg();
  } else if (multiplier.isNegative()) return this.mul(multiplier.neg()).neg();
  if (this.lt(TWO_PWR_24) && multiplier.lt(TWO_PWR_24))
    return fromNumber(this.toNumber() * multiplier.toNumber(), this.unsigned);
  var a48 = this.high >>> 16;
  var a32 = this.high & 65535;
  var a16 = this.low >>> 16;
  var a00 = this.low & 65535;
  var b48 = multiplier.high >>> 16;
  var b32 = multiplier.high & 65535;
  var b16 = multiplier.low >>> 16;
  var b00 = multiplier.low & 65535;
  var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
  c00 += a00 * b00;
  c16 += c00 >>> 16;
  c00 &= 65535;
  c16 += a16 * b00;
  c32 += c16 >>> 16;
  c16 &= 65535;
  c16 += a00 * b16;
  c32 += c16 >>> 16;
  c16 &= 65535;
  c32 += a32 * b00;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c32 += a16 * b16;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c32 += a00 * b32;
  c48 += c32 >>> 16;
  c32 &= 65535;
  c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
  c48 &= 65535;
  return fromBits(c16 << 16 | c00, c48 << 16 | c32, this.unsigned);
};
LongPrototype.mul = LongPrototype.multiply;
LongPrototype.divide = function divide(divisor) {
  if (!isLong(divisor)) divisor = fromValue(divisor);
  if (divisor.isZero()) throw Error("division by zero");
  if (wasm) {
    if (!this.unsigned && this.high === -2147483648 && divisor.low === -1 && divisor.high === -1) {
      return this;
    }
    var low = (this.unsigned ? wasm["div_u"] : wasm["div_s"])(
      this.low,
      this.high,
      divisor.low,
      divisor.high
    );
    return fromBits(low, wasm["get_high"](), this.unsigned);
  }
  if (this.isZero()) return this.unsigned ? UZERO : ZERO;
  var approx, rem, res;
  if (!this.unsigned) {
    if (this.eq(MIN_VALUE)) {
      if (divisor.eq(ONE) || divisor.eq(NEG_ONE))
        return MIN_VALUE;
      else if (divisor.eq(MIN_VALUE)) return ONE;
      else {
        var halfThis = this.shr(1);
        approx = halfThis.div(divisor).shl(1);
        if (approx.eq(ZERO)) {
          return divisor.isNegative() ? ONE : NEG_ONE;
        } else {
          rem = this.sub(divisor.mul(approx));
          res = approx.add(rem.div(divisor));
          return res;
        }
      }
    } else if (divisor.eq(MIN_VALUE)) return this.unsigned ? UZERO : ZERO;
    if (this.isNegative()) {
      if (divisor.isNegative()) return this.neg().div(divisor.neg());
      return this.neg().div(divisor).neg();
    } else if (divisor.isNegative()) return this.div(divisor.neg()).neg();
    res = ZERO;
  } else {
    if (!divisor.unsigned) divisor = divisor.toUnsigned();
    if (divisor.gt(this)) return UZERO;
    if (divisor.gt(this.shru(1)))
      return UONE;
    res = UZERO;
  }
  rem = this;
  while (rem.gte(divisor)) {
    approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));
    var log2 = Math.ceil(Math.log(approx) / Math.LN2), delta = log2 <= 48 ? 1 : pow_dbl(2, log2 - 48), approxRes = fromNumber(approx), approxRem = approxRes.mul(divisor);
    while (approxRem.isNegative() || approxRem.gt(rem)) {
      approx -= delta;
      approxRes = fromNumber(approx, this.unsigned);
      approxRem = approxRes.mul(divisor);
    }
    if (approxRes.isZero()) approxRes = ONE;
    res = res.add(approxRes);
    rem = rem.sub(approxRem);
  }
  return res;
};
LongPrototype.div = LongPrototype.divide;
LongPrototype.modulo = function modulo(divisor) {
  if (!isLong(divisor)) divisor = fromValue(divisor);
  if (wasm) {
    var low = (this.unsigned ? wasm["rem_u"] : wasm["rem_s"])(
      this.low,
      this.high,
      divisor.low,
      divisor.high
    );
    return fromBits(low, wasm["get_high"](), this.unsigned);
  }
  return this.sub(this.div(divisor).mul(divisor));
};
LongPrototype.mod = LongPrototype.modulo;
LongPrototype.rem = LongPrototype.modulo;
LongPrototype.not = function not() {
  return fromBits(~this.low, ~this.high, this.unsigned);
};
LongPrototype.countLeadingZeros = function countLeadingZeros() {
  return this.high ? Math.clz32(this.high) : Math.clz32(this.low) + 32;
};
LongPrototype.clz = LongPrototype.countLeadingZeros;
LongPrototype.countTrailingZeros = function countTrailingZeros() {
  return this.low ? ctz32(this.low) : ctz32(this.high) + 32;
};
LongPrototype.ctz = LongPrototype.countTrailingZeros;
LongPrototype.and = function and(other) {
  if (!isLong(other)) other = fromValue(other);
  return fromBits(this.low & other.low, this.high & other.high, this.unsigned);
};
LongPrototype.or = function or(other) {
  if (!isLong(other)) other = fromValue(other);
  return fromBits(this.low | other.low, this.high | other.high, this.unsigned);
};
LongPrototype.xor = function xor(other) {
  if (!isLong(other)) other = fromValue(other);
  return fromBits(this.low ^ other.low, this.high ^ other.high, this.unsigned);
};
LongPrototype.shiftLeft = function shiftLeft(numBits) {
  if (isLong(numBits)) numBits = numBits.toInt();
  if ((numBits &= 63) === 0) return this;
  else if (numBits < 32)
    return fromBits(
      this.low << numBits,
      this.high << numBits | this.low >>> 32 - numBits,
      this.unsigned
    );
  else return fromBits(0, this.low << numBits - 32, this.unsigned);
};
LongPrototype.shl = LongPrototype.shiftLeft;
LongPrototype.shiftRight = function shiftRight(numBits) {
  if (isLong(numBits)) numBits = numBits.toInt();
  if ((numBits &= 63) === 0) return this;
  else if (numBits < 32)
    return fromBits(
      this.low >>> numBits | this.high << 32 - numBits,
      this.high >> numBits,
      this.unsigned
    );
  else
    return fromBits(
      this.high >> numBits - 32,
      this.high >= 0 ? 0 : -1,
      this.unsigned
    );
};
LongPrototype.shr = LongPrototype.shiftRight;
LongPrototype.shiftRightUnsigned = function shiftRightUnsigned(numBits) {
  if (isLong(numBits)) numBits = numBits.toInt();
  if ((numBits &= 63) === 0) return this;
  if (numBits < 32)
    return fromBits(
      this.low >>> numBits | this.high << 32 - numBits,
      this.high >>> numBits,
      this.unsigned
    );
  if (numBits === 32) return fromBits(this.high, 0, this.unsigned);
  return fromBits(this.high >>> numBits - 32, 0, this.unsigned);
};
LongPrototype.shru = LongPrototype.shiftRightUnsigned;
LongPrototype.shr_u = LongPrototype.shiftRightUnsigned;
LongPrototype.rotateLeft = function rotateLeft(numBits) {
  var b;
  if (isLong(numBits)) numBits = numBits.toInt();
  if ((numBits &= 63) === 0) return this;
  if (numBits === 32) return fromBits(this.high, this.low, this.unsigned);
  if (numBits < 32) {
    b = 32 - numBits;
    return fromBits(
      this.low << numBits | this.high >>> b,
      this.high << numBits | this.low >>> b,
      this.unsigned
    );
  }
  numBits -= 32;
  b = 32 - numBits;
  return fromBits(
    this.high << numBits | this.low >>> b,
    this.low << numBits | this.high >>> b,
    this.unsigned
  );
};
LongPrototype.rotl = LongPrototype.rotateLeft;
LongPrototype.rotateRight = function rotateRight(numBits) {
  var b;
  if (isLong(numBits)) numBits = numBits.toInt();
  if ((numBits &= 63) === 0) return this;
  if (numBits === 32) return fromBits(this.high, this.low, this.unsigned);
  if (numBits < 32) {
    b = 32 - numBits;
    return fromBits(
      this.high << b | this.low >>> numBits,
      this.low << b | this.high >>> numBits,
      this.unsigned
    );
  }
  numBits -= 32;
  b = 32 - numBits;
  return fromBits(
    this.low << b | this.high >>> numBits,
    this.high << b | this.low >>> numBits,
    this.unsigned
  );
};
LongPrototype.rotr = LongPrototype.rotateRight;
LongPrototype.toSigned = function toSigned() {
  if (!this.unsigned) return this;
  return fromBits(this.low, this.high, false);
};
LongPrototype.toUnsigned = function toUnsigned() {
  if (this.unsigned) return this;
  return fromBits(this.low, this.high, true);
};
LongPrototype.toBytes = function toBytes(le) {
  return le ? this.toBytesLE() : this.toBytesBE();
};
LongPrototype.toBytesLE = function toBytesLE() {
  var hi = this.high, lo = this.low;
  return [
    lo & 255,
    lo >>> 8 & 255,
    lo >>> 16 & 255,
    lo >>> 24,
    hi & 255,
    hi >>> 8 & 255,
    hi >>> 16 & 255,
    hi >>> 24
  ];
};
LongPrototype.toBytesBE = function toBytesBE() {
  var hi = this.high, lo = this.low;
  return [
    hi >>> 24,
    hi >>> 16 & 255,
    hi >>> 8 & 255,
    hi & 255,
    lo >>> 24,
    lo >>> 16 & 255,
    lo >>> 8 & 255,
    lo & 255
  ];
};
Long.fromBytes = function fromBytes(bytes, unsigned, le) {
  return le ? Long.fromBytesLE(bytes, unsigned) : Long.fromBytesBE(bytes, unsigned);
};
Long.fromBytesLE = function fromBytesLE(bytes, unsigned) {
  return new Long(
    bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24,
    bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24,
    unsigned
  );
};
Long.fromBytesBE = function fromBytesBE(bytes, unsigned) {
  return new Long(
    bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7],
    bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3],
    unsigned
  );
};
if (typeof BigInt === "function") {
  Long.fromBigInt = function fromBigInt(value, unsigned) {
    var lowBits = Number(BigInt.asIntN(32, value));
    var highBits = Number(BigInt.asIntN(32, value >> BigInt(32)));
    return fromBits(lowBits, highBits, unsigned);
  };
  Long.fromValue = function fromValueWithBigInt(value, unsigned) {
    if (typeof value === "bigint") return Long.fromBigInt(value, unsigned);
    return fromValue(value, unsigned);
  };
  LongPrototype.toBigInt = function toBigInt() {
    var lowBigInt = BigInt(this.low >>> 0);
    var highBigInt = BigInt(this.unsigned ? this.high >>> 0 : this.high);
    return highBigInt << BigInt(32) | lowBigInt;
  };
}
var long_default = Long;

// dist/long.js
var jsLongImpl = {
  fromString: (s) => long_default.fromString(s),
  fromNumber: (n) => long_default.fromNumber(n),
  fromBits: (low, high) => long_default.fromBits(low, high),
  toString: (v) => v.toString(),
  toNumber: (v) => v.toNumber(),
  high: (v) => v.high,
  low: (v) => v.low,
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  mod: (a, b) => a.mod(b),
  shl: (a, bits) => a.shl(bits),
  shr: (a, bits) => a.shr(bits),
  shru: (a, bits) => a.shru(bits),
  and: (a, b) => a.and(b),
  or: (a, b) => a.or(b),
  xor: (a, b) => a.xor(b),
  eq: (a, b) => a.eq(b),
  gt: (a, b) => a.gt(b),
  lt: (a, b) => a.lt(b),
  zero: () => long_default.ZERO
};
var longImpl = jsLongImpl;
var Long2 = class _Long {
  static MIN_VALUE_STRING = "-9223372036854775808";
  static MAX_VALUE_STRING = "9223372036854775807";
  value;
  constructor(value) {
    this.value = value;
  }
  static fromString(value) {
    return new _Long(longImpl.fromString(value));
  }
  static fromNumber(value) {
    return new _Long(longImpl.fromNumber(value));
  }
  static fromBits(low, high) {
    return new _Long(longImpl.fromBits(low, high));
  }
  static get ZERO() {
    return new _Long(longImpl.zero());
  }
  static get MIN_VALUE() {
    return _Long.fromString(_Long.MIN_VALUE_STRING);
  }
  static get MAX_VALUE() {
    return _Long.fromString(_Long.MAX_VALUE_STRING);
  }
  toString() {
    return longImpl.toString(this.value);
  }
  toNumber() {
    return longImpl.toNumber(this.value);
  }
  get high() {
    return longImpl.high(this.value);
  }
  get low() {
    return longImpl.low(this.value);
  }
  static coerce(value) {
    return typeof value === "number" ? _Long.fromNumber(value) : value;
  }
  add(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.add(this.value, rhs.value));
  }
  sub(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.sub(this.value, rhs.value));
  }
  mul(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.mul(this.value, rhs.value));
  }
  div(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.div(this.value, rhs.value));
  }
  mod(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.mod(this.value, rhs.value));
  }
  shl(bits) {
    const shift = typeof bits === "number" ? bits : bits.toNumber();
    return new _Long(longImpl.shl(this.value, shift));
  }
  shr(bits) {
    const shift = typeof bits === "number" ? bits : bits.toNumber();
    return new _Long(longImpl.shr(this.value, shift));
  }
  shru(bits) {
    const shift = typeof bits === "number" ? bits : bits.toNumber();
    return new _Long(longImpl.shru(this.value, shift));
  }
  and(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.and(this.value, rhs.value));
  }
  or(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.or(this.value, rhs.value));
  }
  xor(other) {
    const rhs = _Long.coerce(other);
    return new _Long(longImpl.xor(this.value, rhs.value));
  }
  eq(other) {
    const rhs = _Long.coerce(other);
    return longImpl.eq(this.value, rhs.value);
  }
  gt(other) {
    const rhs = _Long.coerce(other);
    return longImpl.gt(this.value, rhs.value);
  }
  lt(other) {
    const rhs = _Long.coerce(other);
    return longImpl.lt(this.value, rhs.value);
  }
  lte(other) {
    return !this.gt(other);
  }
  gte(other) {
    return !this.lt(other);
  }
  isZero() {
    return this.eq(0);
  }
  isNegative() {
    return this.lt(0);
  }
};

// dist/helpers.js
function partialEq(src, target) {
  return Object.keys(target).every((key) => {
    return target[key] === src[key];
  });
}

// dist/nbt/parse/parser.js
var Parser = class {
  gcx;
  lexer;
  token;
  prev;
  constructor(gcx, lexer) {
    this.gcx = gcx;
    this.lexer = lexer;
    this.token = { kind: "eof", span: new Span(0, 0) };
    this.prev = this.token;
    this.next();
  }
  parseCompletely() {
    const value = this.parseTag();
    if (!this.check("eof")) {
      throw Diagnostic.error(`Expected ${tokenToString("eof")}`).addPrimarySpan(this.token.span);
    }
    return value;
  }
  parseTag() {
    if (this.check({ kind: "open_delim", delim: "brace" })) {
      return this.parseCompound();
    }
    if (this.check({ kind: "open_delim", delim: "bracket" })) {
      return this.parseListOrArray();
    }
    if (this.check("str")) {
      this.next();
      return this.withValueSpan({ type: "string", value: this.prev.value }, this.prev.span, this.prev.span);
    }
    if (this.check("bare")) {
      this.next();
      return this.parseBareTag(this.prev.value, this.prev.span);
    }
    throw Diagnostic.error("Expected SNBT value").addPrimarySpan(this.token.span);
  }
  parseCompound() {
    const lo = this.token.span.start;
    this.expect({ kind: "open_delim", delim: "brace" });
    const value = {};
    this.gcx.spans.set(value, this.prev.span);
    while (true) {
      if (this.eat({ kind: "close_delim", delim: "brace" }))
        break;
      const key = this.parseKey();
      this.expect("colon");
      const tag = this.parseTag();
      value[key] = tag;
      this.gcx.spans.setField(value, key, this.gcx.spans.get(tag));
      if (this.eat("comma")) {
        if (this.eat({ kind: "close_delim", delim: "brace" }))
          break;
        continue;
      }
      if (this.eat({ kind: "close_delim", delim: "brace" }))
        break;
      throw Diagnostic.error(`Expected ${tokenToString("comma")}`).addPrimarySpan(this.token.span);
    }
    const span = new Span(lo, this.prev.span.end);
    this.gcx.spans.set(value, span);
    return this.withValueSpan({ type: "compound", value }, span, span);
  }
  parseListOrArray() {
    const lo = this.token.span.start;
    this.expect({ kind: "open_delim", delim: "bracket" });
    if (this.eat({ kind: "close_delim", delim: "bracket" })) {
      const span = new Span(lo, this.prev.span.end);
      const value = { type: "int", value: [] };
      this.gcx.spans.set(value, span);
      this.gcx.spans.setField(value, "value", span);
      return this.withValueSpan({
        type: "list",
        value
      }, span, span);
    }
    if (this.check("bare")) {
      const prefix = this.token.value;
      const prefixSpan = this.token.span;
      if (isArrayPrefix(prefix)) {
        this.next();
        if (this.eat("semicolon")) {
          return this.parseTypedArray(toUpperArrayPrefix(prefix), prefixSpan, lo);
        }
        return this.parseListFromFirst(this.parseBareTag(prefix, prefixSpan), lo);
      }
    }
    return this.parseListFromFirst(this.parseTag(), lo);
  }
  parseListFromFirst(first, lo) {
    const elementType = first.type;
    const values = [first.value];
    while (true) {
      if (this.eat({ kind: "close_delim", delim: "bracket" }))
        break;
      this.expect("comma");
      if (this.eat({ kind: "close_delim", delim: "bracket" }))
        break;
      const tag = this.parseTag();
      if (tag.type !== elementType) {
        throw Diagnostic.error("SNBT list values must have the same tag type").addPrimarySpan(this.prev.span, `Expected ${elementType}`);
      }
      values.push(tag.value);
    }
    const span = new Span(lo, this.prev.span.end);
    const value = {
      type: elementType,
      value: values
    };
    this.gcx.spans.set(value, span);
    this.gcx.spans.setField(value, "value", span);
    return this.withValueSpan({
      type: "list",
      value
    }, span, span);
  }
  parseTypedArray(prefix, prefixSpan, lo) {
    if (this.eat({ kind: "close_delim", delim: "bracket" })) {
      const span2 = new Span(lo, this.prev.span.end);
      if (prefix === "B")
        return this.withValueSpan({ type: "byte_array", value: [] }, span2, span2);
      if (prefix === "S")
        return this.withValueSpan({ type: "short_array", value: [] }, span2, span2);
      if (prefix === "I")
        return this.withValueSpan({ type: "int_array", value: [] }, span2, span2);
      return this.withValueSpan({ type: "long_array", value: [] }, span2, span2);
    }
    if (prefix === "B") {
      const value2 = this.parseNumberArray("byte");
      const span2 = new Span(lo, this.prev.span.end);
      return this.withValueSpan({ type: "byte_array", value: value2 }, span2, span2);
    }
    if (prefix === "S") {
      const value2 = this.parseNumberArray("short");
      const span2 = new Span(lo, this.prev.span.end);
      return this.withValueSpan({ type: "short_array", value: value2 }, span2, span2);
    }
    if (prefix === "I") {
      const value2 = this.parseNumberArray("int");
      const span2 = new Span(lo, this.prev.span.end);
      return this.withValueSpan({ type: "int_array", value: value2 }, span2, span2);
    }
    if (prefix !== "L") {
      throw Diagnostic.error(`Unsupported typed array prefix '${prefix}'`).addPrimarySpan(prefixSpan);
    }
    const value = this.parseLongArray();
    const span = new Span(lo, this.prev.span.end);
    return this.withValueSpan({ type: "long_array", value }, span, span);
  }
  parseNumberArray(kind) {
    const values = [];
    while (true) {
      this.expect("bare");
      const tag = this.parseBareTag(this.prev.value, this.prev.span);
      if (tag.type !== kind) {
        throw Diagnostic.error(`Expected ${kind} literal`).addPrimarySpan(this.prev.span).addSecondarySpan(this.prev.span, `Got ${tag.type}`);
      }
      values.push(tag.value);
      if (this.eat({ kind: "close_delim", delim: "bracket" }))
        break;
      this.expect("comma");
      if (this.eat({ kind: "close_delim", delim: "bracket" }))
        break;
    }
    return values;
  }
  parseLongArray() {
    const values = [];
    while (true) {
      this.expect("bare");
      const tag = this.parseBareTag(this.prev.value, this.prev.span);
      if (tag.type !== "long") {
        throw Diagnostic.error("Expected long literal").addPrimarySpan(this.prev.span).addSecondarySpan(this.prev.span, `Got ${tag.type}`);
      }
      values.push(tag.value);
      if (this.eat({ kind: "close_delim", delim: "bracket" }))
        break;
      this.expect("comma");
      if (this.eat({ kind: "close_delim", delim: "bracket" }))
        break;
    }
    return values;
  }
  parseKey() {
    if (this.check("str")) {
      this.next();
      return this.prev.value;
    }
    if (this.check("bare")) {
      this.next();
      return this.prev.value;
    }
    throw Diagnostic.error("Expected object key").addPrimarySpan(this.token.span);
  }
  parseBareTag(raw, span) {
    const lower = raw.toLowerCase();
    if (lower === "true")
      return this.withValueSpan({ type: "byte", value: 1 }, span, span);
    if (lower === "false")
      return this.withValueSpan({ type: "byte", value: 0 }, span, span);
    const parsed = parseNumericRaw(raw);
    if (!parsed)
      return this.withValueSpan({ type: "string", value: raw }, span, span);
    const kind = parsed.suffix;
    if (kind === "b") {
      return this.withValueSpan({ type: "byte", value: assertRangeInt(parsed.value, -128, 127, "byte", span) }, span, span);
    }
    if (kind === "s") {
      return this.withValueSpan({ type: "short", value: assertRangeInt(parsed.value, -32768, 32767, "short", span) }, span, span);
    }
    if (kind === "i") {
      return this.withValueSpan({ type: "int", value: assertRangeInt(parsed.value, -2147483648, 2147483647, "int", span) }, span, span);
    }
    if (kind === "l") {
      return this.withValueSpan({ type: "long", value: parseLong(parsed.rawNoSuffix, span) }, span, span);
    }
    if (kind === "f") {
      return this.withValueSpan({ type: "float", value: assertFinite(parsed.value, "float", span) }, span, span);
    }
    if (kind === "d") {
      return this.withValueSpan({ type: "double", value: assertFinite(parsed.value, "double", span) }, span, span);
    }
    if (parsed.isFloatLike) {
      return this.withValueSpan({ type: "double", value: assertFinite(parsed.value, "double", span) }, span, span);
    }
    if (!Number.isSafeInteger(parsed.value)) {
      return this.withValueSpan({ type: "long", value: parseLong(parsed.rawNoSuffix, span) }, span, span);
    }
    if (parsed.value < -2147483648 || parsed.value > 2147483647) {
      return this.withValueSpan({ type: "long", value: parseLong(parsed.rawNoSuffix, span) }, span, span);
    }
    return this.withValueSpan({ type: "int", value: parsed.value }, span, span);
  }
  withValueSpan(tag, span, valueSpan) {
    this.gcx.spans.set(tag, span);
    this.gcx.spans.setField(tag, "value", valueSpan);
    return tag;
  }
  next() {
    this.prev = this.token;
    this.token = this.lexer.advanceToken();
  }
  check(tok) {
    return typeof tok === "string" ? this.token.kind === tok : partialEq(this.token, tok);
  }
  eat(tok) {
    const matches = this.check(tok);
    if (matches)
      this.next();
    return matches;
  }
  expect(tok) {
    if (!this.eat(tok)) {
      throw Diagnostic.error(`Expected ${tokenToString(tok)}`).addPrimarySpan(this.token.span);
    }
  }
};
function isArrayPrefix(raw) {
  return raw.length === 1 && /[bBsSiIlL]/.test(raw);
}
function toUpperArrayPrefix(raw) {
  if (raw === "b" || raw === "B")
    return "B";
  if (raw === "s" || raw === "S")
    return "S";
  if (raw === "i" || raw === "I")
    return "I";
  return "L";
}
function assertFinite(value, typeName, span) {
  if (Number.isFinite(value))
    return value;
  throw Diagnostic.error(`${typeName} literal is not finite`).addPrimarySpan(span);
}
function assertRangeInt(value, min, max, typeName, span) {
  if (!Number.isInteger(value)) {
    throw Diagnostic.error(`${typeName} literal must be an integer`).addPrimarySpan(span);
  }
  if (value < min || value > max) {
    throw Diagnostic.error(`${typeName} literal out of range`).addPrimarySpan(span).addSubDiagnostic(Diagnostic.note(`Expected range ${min}..${max}`));
  }
  return value;
}
function parseLong(raw, span) {
  if (!/^[+-]?\d+$/.test(raw)) {
    throw Diagnostic.error("long literal must be an integer").addPrimarySpan(span);
  }
  const long = Long2.fromString(raw);
  if (long.toString() !== normalizeIntegerString(raw)) {
    throw Diagnostic.error("long literal out of 64-bit range").addPrimarySpan(span);
  }
  return long;
}
function normalizeIntegerString(raw) {
  const sign = raw.startsWith("-") ? "-" : "";
  const digits = raw.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  if (digits === "0")
    return "0";
  return `${sign}${digits}`;
}
function parseNumericRaw(raw) {
  const match = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([bBsSiIlLfFdD])?$/);
  if (!match)
    return void 0;
  const value = Number(match[1]);
  if (Number.isNaN(value))
    return void 0;
  return {
    rawNoSuffix: match[1],
    value,
    suffix: match[2]?.toLowerCase(),
    isFloatLike: match[1].includes(".") || /[eE]/.test(match[1])
  };
}

// dist/nbt/parse/index.js
function parseSnbt(gcx, path2) {
  try {
    const file = gcx.sourceMap.getFile(path2);
    const parser = new Parser(gcx, new Lexer(file.src, file.startPos));
    const tag = parser.parseCompletely();
    return tag;
  } catch (e) {
    if (e instanceof Diagnostic) {
      gcx.addDiagnostic(e);
    } else if (e instanceof Error) {
      gcx.addDiagnostic(Diagnostic.bugFromError(e));
    } else {
      gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path2}`));
    }
    return void 0;
  }
}

// dist/items/index.js
function isDirectSnbtItemReference(value) {
  return value.toLowerCase().endsWith(".snbt");
}
function resolveItemReference(gcx, itemNames, ownerNode, itemName) {
  const named = itemNames.get(itemName);
  if (named !== void 0) {
    return {
      kind: "named",
      key: itemName,
      name: named.name,
      importable: named,
      nbt: named.nbt
    };
  }
  if (!isDirectSnbtItemReference(itemName)) {
    return void 0;
  }
  const resolvedPath = resolveItemPathFromOwner(gcx, ownerNode, itemName);
  if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
    gcx.addDiagnostic(Diagnostic.error(`SNBT item file does not exist '${itemName}'`).addPrimarySpan(gcx.spans.getField(ownerNode, "itemName"), "not found").addSubDiagnostic(Diagnostic.help("Direct item paths are resolved relative to the HTSL file that contains the item field.")));
    return void 0;
  }
  const nbt = parseSnbt(gcx, resolvedPath);
  if (nbt === void 0) {
    return void 0;
  }
  return {
    kind: "snbtPath",
    key: itemName,
    path: resolvedPath,
    nbt
  };
}
function resolveItemPathFromOwner(gcx, ownerNode, itemName) {
  const fieldSpan = gcx.spans.getField(ownerNode, "itemName");
  const sourceFile = gcx.sourceMap.getFileByPos(fieldSpan.start);
  const parentPath = gcx.sourceMap.fileLoader.getParentPath(sourceFile.path);
  return gcx.sourceMap.fileLoader.resolvePath(parentPath, itemName);
}

// dist/check/passes/checkItems.js
function checkItems(gcx) {
  const items = collectItems(gcx);
  checkDuplicateItemNames(gcx, items);
  checkItemReferences(gcx, items);
}
function collectItems(gcx) {
  return gcx.importables.filter((importable) => importable.type === "ITEM");
}
function checkDuplicateItemNames(gcx, items) {
  const seen = {};
  for (const item of items) {
    const existing = seen[item.name];
    if (existing !== void 0) {
      gcx.addDiagnostic(Diagnostic.error(`Duplicate item name '${item.name}'`).addPrimarySpan(gcx.spans.getField(item, "name"), "duplicate item name").addSecondarySpan(gcx.spans.getField(existing, "name"), "first item with this name").addSubDiagnostic(Diagnostic.help("Item references use top-level items[].name, so item names must be unique.")));
      continue;
    }
    seen[item.name] = item;
  }
}
function checkItemReferences(gcx, items) {
  const itemNames = new Map(items.map((item) => [item.name, item]));
  for (const importable of gcx.importables) {
    if (importable.type === "FUNCTION") {
      checkActions(gcx, itemNames, importable.actions);
    } else if (importable.type === "EVENT") {
      checkActions(gcx, itemNames, importable.actions);
    } else if (importable.type === "REGION") {
      checkActions(gcx, itemNames, importable.onEnterActions ?? []);
      checkActions(gcx, itemNames, importable.onExitActions ?? []);
    } else if (importable.type === "ITEM") {
      checkActions(gcx, itemNames, importable.leftClickActions ?? []);
      checkActions(gcx, itemNames, importable.rightClickActions ?? []);
    } else if (importable.type === "MENU") {
      for (const slot of importable.slots) {
        checkActions(gcx, itemNames, slot.actions ?? []);
      }
    }
  }
}
function checkActions(gcx, itemNames, actions) {
  for (const action of actions) {
    if (action.type === "GIVE_ITEM" || action.type === "REMOVE_ITEM" || action.type === "DROP_ITEM") {
      if (action.itemName !== void 0) {
        checkItemReference(gcx, itemNames, action, action.itemName);
      }
    }
    if (action.type === "CONDITIONAL") {
      checkConditions(gcx, itemNames, action.conditions);
      checkActions(gcx, itemNames, action.ifActions);
      checkActions(gcx, itemNames, action.elseActions);
    } else if (action.type === "RANDOM") {
      checkActions(gcx, itemNames, action.actions);
    }
  }
}
function checkConditions(gcx, itemNames, conditions) {
  for (const condition of conditions) {
    if (condition.type === "REQUIRE_ITEM" || condition.type === "BLOCK_TYPE" || condition.type === "IS_ITEM") {
      if (condition.itemName !== void 0) {
        checkItemReference(gcx, itemNames, condition, condition.itemName);
      }
    }
  }
}
function checkItemReference(gcx, itemNames, node, itemName) {
  const resolved = resolveItemReference(gcx, itemNames, node, itemName);
  if (resolved !== void 0) {
    return;
  }
  if (itemName.toLowerCase().endsWith(".snbt")) {
    return;
  }
  gcx.addDiagnostic(Diagnostic.error(`Unknown item '${itemName}'`).addPrimarySpan(gcx.spans.getField(node, "itemName")).addSubDiagnostic(Diagnostic.help("Item fields must match a top-level items[].name or a direct .snbt path.")));
}

// dist/check/passes/checkLimits.js
function checkLimits(gcx) {
  for (const importable of gcx.importables) {
    if (importable.type === "FUNCTION") {
      checkActionList(gcx, importable.actions, {
        importable: "functions",
        label: `Function "${importable.name}"`
      });
    } else if (importable.type === "EVENT") {
      checkActionList(gcx, importable.actions, {
        importable: "events",
        eventName: importable.event,
        label: `${importable.event} event`
      });
    } else if (importable.type === "ITEM") {
      checkActionList(gcx, importable.leftClickActions ?? [], {
        importable: "items",
        label: `Item "${importable.name}" left-click actions`
      });
      checkActionList(gcx, importable.rightClickActions ?? [], {
        importable: "items",
        label: `Item "${importable.name}" right-click actions`
      });
    } else if (importable.type === "MENU") {
      for (const slot of importable.slots) {
        checkActionList(gcx, slot.actions ?? [], {
          importable: "menus",
          label: `Menu "${importable.name}" slot ${slot.slot}`
        });
      }
    } else if (importable.type === "REGION") {
      checkActionList(gcx, importable.onEnterActions ?? [], {
        importable: "regions",
        label: `Region "${importable.name}" enter actions`
      });
      checkActionList(gcx, importable.onExitActions ?? [], {
        importable: "regions",
        label: `Region "${importable.name}" exit actions`
      });
    } else if (importable.type === "NPC") {
      checkActionList(gcx, importable.leftClickActions ?? [], {
        importable: "npcs",
        label: `NPC "${importable.name}" left-click actions`
      });
      checkActionList(gcx, importable.rightClickActions ?? [], {
        importable: "npcs",
        label: `NPC "${importable.name}" right-click actions`
      });
    }
  }
}
function checkActionList(gcx, actions, context) {
  checkActionCounts(gcx, actions, context);
  for (const action of actions) {
    if (action.type === "CONDITIONAL") {
      checkConditionList(gcx, action.conditions, "Conditional");
      checkActionList(gcx, action.ifActions, {
        ...context,
        nested: "conditional",
        label: `${context.label} Conditional if-actions`
      });
      checkActionList(gcx, action.elseActions, {
        ...context,
        nested: "conditional",
        label: `${context.label} Conditional else-actions`
      });
    } else if (action.type === "RANDOM") {
      checkActionList(gcx, action.actions, {
        ...context,
        nested: "random",
        label: `${context.label} Random actions`
      });
    }
  }
}
function checkActionCounts(gcx, actions, context) {
  const counts = /* @__PURE__ */ new Map();
  for (const action of actions) {
    const existing = counts.get(action.type);
    if (existing) {
      existing.push(action);
    } else {
      counts.set(action.type, [action]);
    }
  }
  for (const [type, matchingActions] of counts) {
    const limit = getActionLimit(type, context);
    if (limit === void 0 || matchingActions.length <= limit) {
      continue;
    }
    const firstExtra = matchingActions[limit];
    gcx.addDiagnostic(Diagnostic.error(`Maximum amount of ${ACTION_NAMES[type]} actions exceeded in ${context.label}: ${matchingActions.length}/${limit}.`).addPrimarySpan(gcx.spans.getField(firstExtra, "type")));
  }
}
function checkConditionList(gcx, conditions, label) {
  const counts = /* @__PURE__ */ new Map();
  for (const condition of conditions) {
    const existing = counts.get(condition.type);
    if (existing) {
      existing.push(condition);
    } else {
      counts.set(condition.type, [condition]);
    }
  }
  for (const [type, matchingConditions] of counts) {
    const limit = getConditionLimit(type);
    if (limit === void 0 || matchingConditions.length <= limit) {
      continue;
    }
    const firstExtra = matchingConditions[limit];
    gcx.addDiagnostic(Diagnostic.error(`Maximum amount of ${CONDITION_NAMES[type]} conditions exceeded in ${label}: ${matchingConditions.length}/${limit}.`).addPrimarySpan(gcx.spans.getField(firstExtra, "type")));
  }
}

// dist/check/index.js
var PASSES = [
  checkActionContext,
  checkNestedConditionals,
  checkLimits,
  checkItems,
  checkNbt
];
function check(gcx) {
  for (const pass of PASSES) {
    pass(gcx);
  }
}

// dist/context.js
var GlobalCtxt = class _GlobalCtxt {
  path;
  sourceMap;
  spans;
  importables;
  diagnostics;
  activeImportJsonPaths;
  loadedImportJsonPaths;
  /**
   * Maps each parsed importable to the resolved path of the file that owns
   * its primary content — for FUNCTION/EVENT this is the referenced .htsl
   * (where the action body lives), for ITEM/MENU/REGION/NPC it is the
   * import.json that declared them. Lives off the importable to avoid
   * touching the importable's own keys (which knowledge-cache hashing
   * walks via Object.keys — see ct_module/src/knowledge/hash.ts).
   */
  sourceFiles;
  htslTiming;
  constructor(sourceMap, path2, spans = new SpanTable()) {
    this.sourceMap = sourceMap;
    this.spans = spans;
    this.path = path2;
    this.importables = [];
    this.diagnostics = [];
    this.activeImportJsonPaths = [];
    this.loadedImportJsonPaths = /* @__PURE__ */ new Set();
    this.sourceFiles = /* @__PURE__ */ new WeakMap();
    this.htslTiming = null;
  }
  addDiagnostic(diag) {
    this.diagnostics.push(diag);
  }
  isFailed() {
    return this.diagnostics.find((it) => it.level === "error" || it.level === "bug") !== void 0;
  }
  resolvePath(path2) {
    return this.sourceMap.fileLoader.resolvePath(this.sourceMap.fileLoader.getParentPath(this.path), path2);
  }
  readFile(path2) {
    return this.sourceMap.fileLoader.readFile(this.resolvePath(path2));
  }
  fileExists(path2) {
    return this.sourceMap.fileLoader.fileExists(this.resolvePath(path2));
  }
  subContext(path2) {
    const gcx = new _GlobalCtxt(this.sourceMap, this.resolvePath(path2), this.spans);
    gcx.importables = this.importables;
    gcx.diagnostics = this.diagnostics;
    gcx.activeImportJsonPaths = this.activeImportJsonPaths;
    gcx.loadedImportJsonPaths = this.loadedImportJsonPaths;
    gcx.sourceFiles = this.sourceFiles;
    gcx.htslTiming = this.htslTiming;
    return gcx;
  }
};

// dist/htsl/index.js
var htsl_exports = {};
__export(htsl_exports, {
  DEFAULT_PRINT_STYLE: () => DEFAULT_PRINT_STYLE,
  clearHtslCache: () => clearHtslCache,
  helpers: () => helpers_exports2,
  parseHtsl: () => parseHtsl,
  print: () => print_exports,
  printAction: () => printAction,
  printActions: () => printActions,
  printActionsWithDiagnostics: () => printActionsWithDiagnostics,
  printCondition: () => printCondition2,
  setHtslCacheMtimeProvider: () => setHtslCacheMtimeProvider
});

// dist/htsl/parse/token.js
function token2(kind, span, props) {
  return { kind, span, ...props };
}
var TOKEN_KIND_NAMES = {
  comma: ",",
  exclamation: "!",
  bin_op: "binary operator",
  bin_op_eq: "binary operator",
  cmp_op: "comparison",
  cmp_op_eq: "comparison",
  open_delim: "opening delimiter",
  close_delim: "closing delimiter",
  str: "string",
  i64: "number",
  f64: "number",
  placeholder: "placeholder",
  ident: "identifier",
  doc_comment: "doc comment",
  eol: "end of line",
  eof: "end of file",
  unknown: "unknown token"
};
var DELIMITER_SYMBOLS = {
  parenthesis: "()",
  brace: "{}",
  bracket: "[]"
};
var BIN_OP_SYMBOLS = {
  plus: "+",
  minus: "-",
  star: "*",
  slash: "/",
  lt_lt: "<<",
  gt_gt: ">>",
  ampersand: "&",
  vertical_bar: "|",
  caret: "^"
};
var CMP_OP_SYMBOLS = {
  greater_than: ">",
  less_than: "<",
  equals: "="
};
function tokenToString2(tok) {
  if (typeof tok === "string") {
    return TOKEN_KIND_NAMES[tok];
  }
  switch (tok.kind) {
    case "comma":
      return ",";
    case "bin_op":
      return tok.op ? BIN_OP_SYMBOLS[tok.op] : TOKEN_KIND_NAMES[tok.kind];
    case "bin_op_eq":
      return tok.op ? `${BIN_OP_SYMBOLS[tok.op]}=` : TOKEN_KIND_NAMES[tok.kind];
    case "cmp_op":
      return tok.op ? CMP_OP_SYMBOLS[tok.op] : TOKEN_KIND_NAMES[tok.kind];
    case "cmp_op_eq":
      return tok.op ? `${CMP_OP_SYMBOLS[tok.op]}=` : TOKEN_KIND_NAMES[tok.kind];
    case "open_delim":
      return tok.delim ? DELIMITER_SYMBOLS[tok.delim].charAt(0) : TOKEN_KIND_NAMES[tok.kind];
    case "close_delim":
      return tok.delim ? DELIMITER_SYMBOLS[tok.delim].charAt(1) : TOKEN_KIND_NAMES[tok.kind];
    case "unknown":
      return tok.value;
    case void 0:
      throw Error("undefined token kind");
    default:
      return TOKEN_KIND_NAMES[tok.kind];
  }
}

// dist/htsl/parse/lexer.js
var Lexer2 = class {
  src;
  pos;
  posOffset;
  constructor(file) {
    this.src = file.src;
    this.pos = 0;
    this.posOffset = file.startPos;
  }
  advanceToken() {
    while (this.hasNext() && /^\s+$/.test(this.peek()) && this.peek() != "\n") {
      this.next();
    }
    if (!this.hasNext())
      return token2("eof", new Span(this.posWithOffset, this.posWithOffset));
    const lo = this.posWithOffset;
    const c = this.next();
    if (c === "/" && this.peek() === "/") {
      if (this.peek(1) == "/") {
        this.next();
        this.next();
        let value = "";
        do {
          value += this.next();
        } while (this.hasNext() && this.peek() !== "\n");
        if (value.endsWith("\r")) {
          value = value.substring(0, value.length - 1);
        }
        return token2("doc_comment", new Span(lo, this.posWithOffset), { value });
      }
      do {
        this.next();
      } while (this.hasNext() && this.peek() !== "\n");
      return this.advanceToken();
    }
    if (c === "/" && this.peek() === "*") {
      this.next();
      let depth = 1;
      while (this.hasNext()) {
        const c2 = this.next();
        if (c2 === "/" && this.peek() === "*") {
          this.next();
          depth++;
        } else if (c2 === "*" && this.peek() === "/") {
          this.next();
          depth--;
          if (depth === 0)
            break;
        }
      }
      return this.advanceToken();
    }
    if (c === ",")
      return token2("comma", Span.single(lo));
    if (c === "!")
      return token2("exclamation", Span.single(lo));
    if (c === "+") {
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 2), { op: "plus" });
      }
      return token2("bin_op", Span.single(lo), { op: "plus" });
    }
    if (c === "-") {
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 2), { op: "minus" });
      }
      return token2("bin_op", Span.single(lo), { op: "minus" });
    }
    if (c === "*") {
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 2), { op: "star" });
      }
      return token2("bin_op", Span.single(lo), { op: "star" });
    }
    if (c === "/") {
      if (this.peek() === "/")
        this.next();
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, this.posWithOffset), { op: "slash" });
      }
      return token2("bin_op", new Span(lo, this.posWithOffset), { op: "slash" });
    }
    if (c === "<" && this.peek(0) == "<") {
      this.next();
      if (this.peek(0) === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 3), { op: "lt_lt" });
      }
      return token2("bin_op", Span.single(lo), { op: "lt_lt" });
    }
    if (c === ">" && this.peek(0) == ">") {
      this.next();
      if (this.peek(0) === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 3), { op: "gt_gt" });
      }
      return token2("bin_op", Span.single(lo), { op: "gt_gt" });
    }
    if (c === "&") {
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 2), { op: "ampersand" });
      }
      return token2("bin_op", Span.single(lo), { op: "ampersand" });
    }
    if (c === "|") {
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 2), { op: "vertical_bar" });
      }
      return token2("bin_op", Span.single(lo), { op: "vertical_bar" });
    }
    if (c === "^") {
      if (this.peek() === "=") {
        this.next();
        return token2("bin_op_eq", new Span(lo, lo + 2), { op: "caret" });
      }
      return token2("bin_op", Span.single(lo), { op: "caret" });
    }
    if (c === "=") {
      if (this.peek(0) === "=") {
        this.next();
        return token2("cmp_op_eq", new Span(lo, lo + 2), { op: "equals" });
      }
      return token2("cmp_op", Span.single(lo), { op: "equals" });
    }
    if (c === "<") {
      if (this.peek(0) === "=") {
        this.next();
        return token2("cmp_op_eq", new Span(lo, lo + 2), { op: "less_than" });
      }
      return token2("cmp_op", Span.single(lo), { op: "less_than" });
    }
    if (c === ">") {
      if (this.peek(0) === "=") {
        this.next();
        return token2("cmp_op_eq", new Span(lo, lo + 2), { op: "greater_than" });
      }
      return token2("cmp_op", Span.single(lo), { op: "greater_than" });
    }
    if (c === "(")
      return token2("open_delim", Span.single(lo), { delim: "parenthesis" });
    if (c === ")")
      return token2("close_delim", Span.single(lo), { delim: "parenthesis" });
    if (c === "{")
      return token2("open_delim", Span.single(lo), { delim: "brace" });
    if (c === "}")
      return token2("close_delim", Span.single(lo), { delim: "brace" });
    if (c === "[")
      return token2("open_delim", Span.single(lo), { delim: "bracket" });
    if (c === "]")
      return token2("close_delim", Span.single(lo), { delim: "bracket" });
    if (c === '"') {
      let value = "";
      let escapeNext = false;
      while (this.hasNext()) {
        const c2 = this.next();
        if (!escapeNext && c2 === '"')
          break;
        if (!escapeNext && c2 === "\\") {
          escapeNext = true;
          continue;
        }
        escapeNext = false;
        value += c2;
      }
      return token2("str", new Span(lo, this.posWithOffset), { value });
    }
    if (c === "%") {
      let value = "";
      while (this.hasNext()) {
        const c2 = this.next();
        if (c2 === "%")
          break;
        value += c2;
      }
      return token2("placeholder", new Span(lo, this.posWithOffset), { value });
    }
    if (/[0-9]/.test(c)) {
      let value = c;
      while (this.hasNext()) {
        if (!/[0-9_]/.test(this.peek()))
          break;
        value += this.next();
      }
      if (this.peek() === ".") {
        value += ".";
        this.next();
        while (this.hasNext()) {
          if (!/[0-9_]/.test(this.peek()))
            break;
          value += this.next();
        }
        return token2("f64", new Span(lo, this.posWithOffset), { value });
      }
      return token2("i64", new Span(lo, this.posWithOffset), { value });
    }
    if (/[a-zA-Z_]/.test(c)) {
      let value = c;
      while (this.hasNext()) {
        if (!/[a-zA-Z_/\-0-9.-]/.test(this.peek()))
          break;
        value += this.next();
      }
      return token2("ident", new Span(lo, this.posWithOffset), { value });
    }
    if (c === "\n")
      return token2("eol", Span.single(lo));
    return token2("unknown", Span.single(lo), { value: c });
  }
  get posWithOffset() {
    return this.pos + this.posOffset;
  }
  hasNext() {
    return this.pos < this.src.length;
  }
  next() {
    return this.src.charAt(this.pos++);
  }
  peek(skip) {
    return this.src.charAt(this.pos + (skip ?? 0));
  }
};

// dist/htsl/parse/placeholders.js
function parseNumericalPlaceholder(p) {
  return parsePlaceholder(p, { requireNumeric: true });
}
function parseAnyPlaceholder(p) {
  return parsePlaceholder(p, { requireNumeric: false });
}
function parsePlaceholder(p, opts) {
  function eatKw(kw) {
    return p.eatIdent(kw);
  }
  if (eatKw("var") || eatKw("stat")) {
    const name = parseVarName(p);
    if (p.check("i64") || p.check("f64") || p.check("str") || p.check("placeholder")) {
      const fallback = parseValue(p);
      return `%var.player/${name} ${fallback}%`;
    } else {
      return `%var.player/${name}%`;
    }
  }
  if (eatKw("globalvar") || eatKw("globalstat")) {
    const name = parseVarName(p);
    if (p.check("i64") || p.check("f64") || p.check("str") || p.check("placeholder")) {
      const fallback = parseValue(p);
      return `%var.global/${name} ${fallback}%`;
    } else {
      return `%var.global/${name}%`;
    }
  }
  if (eatKw("teamvar") || eatKw("teamstat")) {
    const name = parseVarName(p);
    if (!p.check("ident") && !p.check("str")) {
      throw Diagnostic.error("Expected team name").addPrimarySpan(p.token.span);
    }
    const team = parseVarName(p);
    if (p.check("i64") || p.check("f64") || p.check("str") || p.check("placeholder")) {
      const fallback = parseValue(p);
      return `%var.team/${name} ${team} ${fallback}%`;
    } else {
      return `%var.team/${name} ${team}%`;
    }
  }
  if (eatKw("randomint")) {
    const from = p.parseNumber();
    const to = p.parseNumber();
    return `%random.int/${from} ${to}%`;
  }
  if (eatKw("health"))
    return "%player.health%";
  if (eatKw("maxHealth"))
    return "%player.maxHealth%";
  if (eatKw("hunger"))
    return "%player.hunger%";
  if (eatKw("locX"))
    return "%player.location.x%";
  if (eatKw("locY"))
    return "%player.location.y%";
  if (eatKw("locZ"))
    return "%player.location.z%";
  if (eatKw("unix"))
    return "%date.unix%";
  if (p.token.kind !== "str" && p.token.kind !== "placeholder") {
    throw Diagnostic.error("Expected placeholder").addPrimarySpan(p.token.span);
  }
  let value = p.token.value;
  const span = p.token.span;
  p.next();
  if (p.prev.kind === "str") {
    if (!(value.startsWith("%") && value.endsWith("%"))) {
      p.gcx.addDiagnostic(Diagnostic.error("Expected placeholder").addPrimarySpan(p.prev.span));
      return "";
    }
    value = value.substring(1, value.length - 1);
  }
  return validatePlaceholder(p, value, span, opts);
}
function validateNumericalPlaceholder(p, value, span) {
  return validatePlaceholder(p, value, span, { requireNumeric: true });
}
function validatePlaceholder(p, value, span, opts) {
  const index = value.indexOf("/");
  const name = value.substring(0, index == -1 ? value.length : index).toLowerCase();
  const args = index == -1 ? [] : value.substring(index + 1).split(" ");
  function addIssueInvalidPlaceholder() {
    p.gcx.addDiagnostic(Diagnostic.error("Invalid placeholder").addPrimarySpan(span));
  }
  function addIssueInvalidArgument(message) {
    const lo = index == -1 ? value.length - 1 : index + 1;
    p.gcx.addDiagnostic(Diagnostic.error(message).addPrimarySpan(new Span(span.start + lo, span.end)));
  }
  const spec = PLACEHOLDER_SPECS.find((placeholder) => placeholder.name === name);
  if (spec?.args === "none") {
    if (args.length > 0)
      addIssueInvalidArgument("No arguments expected");
    if (opts.requireNumeric && spec.valueType !== "number") {
      p.gcx.addDiagnostic(Diagnostic.error(`Expected a numeric placeholder; \`%${name}%\` returns a string`).addPrimarySpan(span));
    }
    return `%${value}%`;
  }
  switch (name) {
    case "var.player":
    case "var.global":
      if (args.length == 0)
        addIssueInvalidArgument("Expected stat key");
      break;
    case "var.team":
      if (args.length == 0)
        addIssueInvalidArgument("Expected stat key");
      if (args.length == 1)
        addIssueInvalidArgument("Expected team name");
      if (args.length > 2)
        addIssueInvalidArgument("Team stat key cannot contain spaces");
      break;
    case "random.int":
    case "random.whole":
      if (args.length == 0)
        addIssueInvalidArgument("Expected lower bound");
      else if (args.length == 1)
        addIssueInvalidArgument("Expected upper bound");
      else if (args.length > 2)
        addIssueInvalidArgument("Unknown argument");
      else if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1]))
        addIssueInvalidArgument("Bounds must be integers");
      break;
    case "random.decimal":
      if (args.length == 0)
        addIssueInvalidArgument("Expected lower bound");
      else if (args.length == 1)
        addIssueInvalidArgument("Expected upper bound");
      else if (args.length > 2)
        addIssueInvalidArgument("Unknown argument");
      else if (isNaN(Number(args[0])) || isNaN(Number(args[1])))
        addIssueInvalidArgument("Bounds must be numbers");
      break;
    default:
      addIssueInvalidPlaceholder();
  }
  return `%${value}%`;
}

// dist/htsl/parse/helpers.js
var helpers_exports2 = {};
__export(helpers_exports2, {
  ACTIONS_TO_KWS: () => ACTIONS_TO_KWS,
  ACTION_KWS: () => ACTION_KWS,
  COMPARISON_SYMBOLS: () => COMPARISON_SYMBOLS,
  CONDITIONS_TO_KWS: () => CONDITIONS_TO_KWS,
  CONDITION_KWS: () => CONDITION_KWS,
  OPERATION_SYMBOLS: () => OPERATION_SYMBOLS,
  SHORTHANDS: () => SHORTHANDS
});
var ACTION_KWS = [
  "applyLayout",
  "applyPotion",
  "balanceTeam",
  "cancelEvent",
  "changeHealth",
  "hungerLevel",
  "maxHealth",
  "changePlayerGroup",
  "clearEffects",
  "closeMenu",
  "actionBar",
  "displayMenu",
  "title",
  "enchant",
  "exit",
  "failParkour",
  "fullHeal",
  "xpLevel",
  "giveItem",
  "kill",
  "parkCheck",
  "pause",
  "sound",
  "removeItem",
  "resetInventory",
  "chat",
  "lobby",
  "compassTarget",
  "gamemode",
  "setTeam",
  "tp",
  "consumeItem",
  "playerWeather",
  "playerTime",
  "displayNametag",
  "stat",
  "globalstat",
  "teamstat",
  "launchTarget",
  "changeVelocity",
  "dropItem",
  "function",
  "random",
  "if",
  "var",
  "globalvar",
  "teamvar"
];
var CONDITION_KWS = [
  "blockType",
  "damageAmount",
  "damageCause",
  "doingParkour",
  "fishingEnv",
  "hasItem",
  "hasPotion",
  "isItem",
  "isSneaking",
  "maxHealth",
  "isFlying",
  "health",
  "hunger",
  "portal",
  "canPvp",
  "gamemode",
  "hasGroup",
  "hasPermission",
  "hasTeam",
  "inRegion",
  "stat",
  "globalstat",
  "teamstat",
  "placeholder",
  "var",
  "globalvar",
  "teamvar"
];
var ACTIONS_TO_KWS = {
  ACTION_BAR: "actionBar",
  APPLY_INVENTORY_LAYOUT: "applyLayout",
  APPLY_POTION_EFFECT: "applyPotion",
  CANCEL_EVENT: "cancelEvent",
  CHANGE_HEALTH: "changeHealth",
  CHANGE_HUNGER: "hungerLevel",
  CHANGE_MAX_HEALTH: "maxHealth",
  CHANGE_VAR: "var",
  CLEAR_POTION_EFFECTS: "clearEffects",
  CLOSE_MENU: "closeMenu",
  CONDITIONAL: "if",
  DROP_ITEM: "dropItem",
  ENCHANT_HELD_ITEM: "enchant",
  EXIT: "exit",
  FAIL_PARKOUR: "failParkour",
  PARKOUR_CHECKPOINT: "parkCheck",
  FUNCTION: "function",
  GIVE_EXPERIENCE_LEVELS: "xpLevel",
  GIVE_ITEM: "giveItem",
  HEAL: "fullHeal",
  KILL: "kill",
  LAUNCH: "launchTarget",
  MESSAGE: "chat",
  PAUSE: "pause",
  PLAY_SOUND: "sound",
  RANDOM: "random",
  REMOVE_ITEM: "removeItem",
  RESET_INVENTORY: "resetInventory",
  SEND_TO_LOBBY: "lobby",
  SET_COMPASS_TARGET: "compassTarget",
  SET_GAMEMODE: "gamemode",
  SET_GROUP: "changePlayerGroup",
  SET_MENU: "displayMenu",
  SET_PLAYER_TIME: "playerTime",
  SET_PLAYER_WEATHER: "playerWeather",
  SET_TEAM: "setTeam",
  SET_VELOCITY: "changeVelocity",
  TELEPORT: "tp",
  TITLE: "title",
  TOGGLE_NAMETAG_DISPLAY: "displayNametag",
  USE_HELD_ITEM: "consumeItem"
};
var CONDITIONS_TO_KWS = {
  BLOCK_TYPE: "blockType",
  COMPARE_DAMAGE: "damageAmount",
  COMPARE_HEALTH: "health",
  COMPARE_HUNGER: "hunger",
  COMPARE_MAX_HEALTH: "maxHealth",
  COMPARE_PLACEHOLDER: "placeholder",
  COMPARE_VAR: "var",
  DAMAGE_CAUSE: "damageCause",
  FISHING_ENVIRONMENT: "fishingEnv",
  IS_DOING_PARKOUR: "doingParkour",
  IS_FLYING: "isFlying",
  IS_IN_REGION: "inRegion",
  IS_ITEM: "isItem",
  IS_SNEAKING: "isSneaking",
  PORTAL_TYPE: "portal",
  PVP_ENABLED: "canPvp",
  REQUIRE_GAMEMODE: "gamemode",
  REQUIRE_GROUP: "hasGroup",
  REQUIRE_ITEM: "hasItem",
  REQUIRE_PERMISSION: "hasPermission",
  REQUIRE_POTION_EFFECT: "hasPotion",
  REQUIRE_TEAM: "hasTeam"
};
var OPERATION_SYMBOLS = {
  Set: "=",
  Increment: "+=",
  Decrement: "-=",
  Multiply: "*=",
  Divide: "/=",
  "Shift Left": "<<=",
  "Shift Right": ">>=",
  "And Assign": "&=",
  "Or Assign": "|=",
  "Xor Assign": "^=",
  Unset: "unset"
};
var COMPARISON_SYMBOLS = {
  Equal: "==",
  "Less Than": "<",
  "Less Than or Equal": "<=",
  "Greater Than": ">",
  "Greater Than or Equal": ">="
};
var SHORTHANDS = [
  "globalstat",
  "stat",
  "teamstat",
  "globalvar",
  "var",
  "teamvar",
  "randomint",
  "health",
  "maxHealth",
  "hunger",
  "locX",
  "locY",
  "locZ",
  "unix"
];

// dist/htsl/parse/arguments.js
function normalizeNumberLiteral(value) {
  return value.replaceAll("_", "");
}
function parseDecimalValueString(value) {
  const parsed = parseFloat(value);
  if (parsed === 0 && value.startsWith("-"))
    return "0.0";
  let formatted = null;
  for (let p = 1; p <= 17; p++) {
    const candidate = parsed.toPrecision(p);
    if (candidate.indexOf("e") !== -1 || candidate.indexOf("E") !== -1) {
      continue;
    }
    if (parseFloat(candidate) === parsed) {
      formatted = candidate;
      break;
    }
  }
  if (formatted === null) {
    formatted = parsed.toFixed(20).replace(/(\.\d*?)0+$/, "$1");
    if (formatted.charAt(formatted.length - 1) === ".") {
      formatted = formatted + "0";
    }
  }
  return formatted.indexOf(".") !== -1 ? formatted : `${formatted}.0`;
}
function parseLocation(p) {
  const type = p.parseOption(LOCATIONS, { singular: "location", plural: "locations" });
  if (type === "Custom Coordinates") {
    const value = parseCoordinates(p);
    return { type, value };
  } else {
    return { type };
  }
}
function parseGamemode(p) {
  return p.parseOption(GAMEMODES, { singular: "gamemode", plural: "gamemodes" });
}
function parseComparison(p) {
  if (p.eat({ kind: "cmp_op", op: "equals" }) || p.eat({ kind: "cmp_op_eq", op: "equals" })) {
    return "Equal";
  }
  if (p.eat({ kind: "cmp_op", op: "less_than" })) {
    return "Less Than";
  }
  if (p.eat({ kind: "cmp_op_eq", op: "less_than" })) {
    return "Less Than or Equal";
  }
  if (p.eat({ kind: "cmp_op", op: "greater_than" })) {
    return "Greater Than";
  }
  if (p.eat({ kind: "cmp_op_eq", op: "greater_than" })) {
    return "Greater Than or Equal";
  }
  if (p.check("ident") || p.check("str")) {
    return p.parseOption(COMPARISONS, { singular: "comparison", plural: "comparisons" });
  } else {
    const err = Diagnostic.error("Expected comparison").addPrimarySpan(p.token.span);
    err.addSubDiagnostic(Diagnostic.help("Valid comparisons are: ==, <, <=, >, >="));
    throw err;
  }
}
function parseOperation(p) {
  if (p.eatIdent("Inc", true) || p.eat({ kind: "bin_op_eq", op: "plus" })) {
    return "Increment";
  }
  if (p.eatIdent("Dec", true) || p.eat({ kind: "bin_op_eq", op: "minus" })) {
    return "Decrement";
  }
  if (p.eatIdent("Mult", true) || p.eatIdent("Mul", true) || p.eat({ kind: "bin_op_eq", op: "star" })) {
    return "Multiply";
  }
  if (p.eatIdent("Div", true) || p.eat({ kind: "bin_op_eq", op: "slash" })) {
    return "Divide";
  }
  if (p.eat({ kind: "cmp_op", op: "equals" })) {
    return "Set";
  }
  if (p.check("ident") || p.check("str")) {
    return p.parseOption(OPERATIONS, { singular: "operation", plural: "operations" });
  } else {
    const err = Diagnostic.error("Expected operation").addPrimarySpan(p.token.span);
    err.addSubDiagnostic(Diagnostic.help("Valid operations are: =, +=, -=, *=, /="));
    throw err;
  }
}
function parseVarName(p) {
  if (p.token.kind !== "ident" && p.token.kind !== "str") {
    throw Diagnostic.error("Expected var name").addPrimarySpan(p.token.span);
  }
  const value = p.token.value;
  const maybeErr = Diagnostic.error("Invalid var name");
  if (value.length > 16) {
    p.gcx.addDiagnostic(maybeErr.addPrimarySpan(p.token.span, "Exceeds 16-character limit"));
  } else if (value.length < 1) {
    p.gcx.addDiagnostic(maybeErr.addPrimarySpan(p.token.span, "Cannot be empty"));
  } else if (value.includes(" ")) {
    p.gcx.addDiagnostic(maybeErr.addPrimarySpan(p.token.span, "Cannot contain spaces"));
  }
  p.next();
  return value;
}
function parseVarOperation(p) {
  try {
    return parseOperation(p);
  } catch (e) {
  }
  if (p.eatIdent("Shl", true) || p.eat({ kind: "bin_op_eq", op: "lt_lt" })) {
    return "Shift Left";
  }
  if (p.eatIdent("Shr", true) || p.eat({ kind: "bin_op_eq", op: "gt_gt" })) {
    return "Shift Right";
  }
  if (p.eat({ kind: "bin_op_eq", op: "ampersand" })) {
    return "And Assign";
  }
  if (p.eat({ kind: "bin_op_eq", op: "vertical_bar" })) {
    return "Or Assign";
  }
  if (p.eat({ kind: "bin_op_eq", op: "caret" })) {
    return "Xor Assign";
  }
  if (p.check("ident") || p.check("str")) {
    return p.parseOption([...OPERATIONS, ...VAR_OPERATIONS], { singular: "var operation", plural: "var operations" });
  } else {
    const err = Diagnostic.error("Expected operation").addPrimarySpan(p.token.span);
    err.addSubDiagnostic(Diagnostic.help("Valid operations are: =, +=, -=, *=, /=, <<=, >>=, &=, |=, ^=, Unset"));
    throw err;
  }
}
function parseNumericValue(p) {
  const negative = p.eat({ kind: "bin_op", op: "minus" });
  const maybeErr = Diagnostic.error("Invalid amount");
  if (p.eat("i64")) {
    const value = normalizeNumberLiteral(p.prev.value);
    const withNegative = negative ? `-${value}` : value;
    const long = Long2.fromString(withNegative);
    if (withNegative != long.toString()) {
      throw maybeErr.addPrimarySpan(p.prev.span, "Number exceeds 64-bit integer limit");
    }
    return long.toString();
  } else if (p.eat("f64")) {
    const value = normalizeNumberLiteral(p.prev.value);
    const withNegative = negative ? `-${value}` : value;
    return parseDecimalValueString(withNegative);
  } else if (negative) {
    throw maybeErr.addPrimarySpan(p.token.span, "Expected number");
  }
  if (p.check("str")) {
    const token3 = p.token;
    const value = token3.value;
    const normalizedValue = normalizeNumberLiteral(value);
    if (/^-?\d+$/.test(normalizedValue)) {
      p.next();
      const long = Long2.fromString(normalizedValue);
      if (normalizedValue != long.toString()) {
        throw maybeErr.addPrimarySpan(token3.span, "Number exceeds 64-bit integer limit");
      }
      return long.toString();
    }
    if (normalizedValue.includes(".") && !isNaN(Number(normalizedValue))) {
      p.next();
      return parseDecimalValueString(normalizedValue);
    }
    const castMatch = value.match(/^(%(.+)%)\s*([LD])$/i);
    if (castMatch) {
      p.next();
      validateNumericalPlaceholder(p, castMatch[2], token3.span);
      return `"${value}"`;
    }
    if (!value.startsWith("%")) {
      throw Diagnostic.error("Expected number or numeric placeholder").addPrimarySpan(token3.span, `\`"${value}"\` is not a number`);
    }
  }
  let isShorthand = false;
  for (const shorthand of SHORTHANDS) {
    if (p.check({ kind: "ident", value: shorthand })) {
      isShorthand = true;
    }
  }
  if (isShorthand || p.check("placeholder") || p.check("str")) {
    return parseNumericalPlaceholder(p);
  }
  throw Diagnostic.error("Expected amount").addPrimarySpan(p.token.span);
}
function parseValue(p) {
  if (p.check("str")) {
    return `"${p.parseString()}"`;
  }
  if (p.eat("placeholder")) {
    return `%${p.prev.value}%`;
  }
  return parseNumericValue(p);
}
function parseInventorySlot(p) {
  if (!p.check("i64") && !p.check("ident") && !p.check("str")) {
    throw Diagnostic.error("Expected inventory slot name or index").addPrimarySpan(p.token.span);
  }
  if (p.check("i64")) {
    return p.parseBoundedNumber(-1, 39);
  }
  if (p.eatString("First Slot") || p.eatIdent("first_slot", true)) {
    return "First Available Slot";
  }
  if (p.eatString("Hand") || p.eatIdent("hand", true)) {
    return "Hand Slot";
  }
  if (p.check("str")) {
    const value = p.token.value;
    const hotbarMatch = value.match(/^hotbar slot ([1-9])$/i);
    if (hotbarMatch) {
      p.next();
      return Number(hotbarMatch[1]) - 1;
    }
    const inventoryMatch = value.match(/^inventory slot ([1-9]|1[0-9]|2[0-7])$/i);
    if (inventoryMatch) {
      p.next();
      return Number(inventoryMatch[1]) + 8;
    }
  }
  return p.parseOption(INVENTORY_SLOTS, { singular: "inventory slot name", plural: "inventory slot names" });
}
function parsePotionEffect(p) {
  return p.parseOption(POTION_EFFECTS, { singular: "potion effect", plural: "potion effects" });
}
function parseLobby(p) {
  return p.parseOption(LOBBIES, { singular: "lobby", plural: "lobbies" });
}
function parseEnchantment(p) {
  return p.parseOption(ENCHANTMENTS, { singular: "enchantment", plural: "enchantments" });
}
function parseSound(p) {
  if (p.check("ident")) {
    const token3 = p.token;
    try {
      const name = p.parseOption(SOUNDS.map((it) => it.name), { singular: "sound name", plural: "sound names" });
      return SOUNDS.find((it) => it.name == name).path;
    } catch (err) {
      if (err instanceof Diagnostic && err.level === "error") {
        if (token3.value.includes(".")) {
          err.addSubDiagnostic(Diagnostic.help("Surround this sound key in quotes").addEdit(token3.span, `"${token3.value}"`));
        }
      }
      throw err;
    }
  } else if (p.check("str")) {
    const value = p.token.value;
    for (const sound of SOUNDS) {
      if (value.toLowerCase() === sound.name.toLowerCase() || value.toLowerCase() === sound.name.replaceAll(" ", "_").toLowerCase()) {
        p.next();
        return sound.path;
      }
    }
    if (value.includes(" ") || !value.includes(".")) {
      p.gcx.addDiagnostic(Diagnostic.error("Invalid sound key").addPrimarySpan(p.token.span));
    }
    p.next();
    return value;
  } else {
    throw Diagnostic.error("Expected sound name or sound key").addPrimarySpan(p.token.span);
  }
}
function parsePermission(p) {
  return p.parseOption(PERMISSIONS, { singular: "permission", plural: "permissions" });
}
function parseDamageCause(p) {
  return p.parseOption(DAMAGE_CAUSES, { singular: "damage cause", plural: "damage causes" });
}
function parseFishingEnvironment(p) {
  return p.parseOption(FISHING_ENVIRONMENTS, {
    singular: "fishing environment",
    plural: "fishing environments"
  });
}
function parsePortalType(p) {
  return p.parseOption(PORTAL_TYPES, { singular: "portal type", plural: "portal types" });
}
function parseItemProperty(p) {
  return p.parseOption(ITEM_PROPERTIES, { singular: "item property", plural: "item properties" });
}
function parseItemLocation(p) {
  return p.parseOption(ITEM_LOCATIONS, { singular: "item location", plural: "item locations" });
}
function parseItemAmount(p) {
  return p.parseOption(ITEM_AMOUNTS, { singular: "item amount", plural: "item amounts" });
}
function parseCoordinates(p) {
  if (p.token.kind !== "str") {
    throw Diagnostic.error("Expected coordinates").addPrimarySpan(p.token.span);
  }
  let value = p.token.value;
  const sp = p.token.span;
  p.next();
  const tokens = value.split(" ");
  function addDiagnostic(message, span) {
    p.gcx.addDiagnostic(Diagnostic.error(message).addPrimarySpan(span));
  }
  const isNumeric = (s) => !isNaN(Number(normalizeNumberLiteral(s)));
  const isPlaceholder = (s, span) => {
    const match = s.match(/^%(.+)%[LD]?$/i);
    if (!match)
      return false;
    validateNumericalPlaceholder(p, match[1], span);
    return true;
  };
  const isNumericOrPlaceholder = (s, span) => isNumeric(s) || isPlaceholder(s, span);
  const isRelative = (s, span) => (s.startsWith("~") || s.startsWith("^")) && (s.length == 1 || isNumericOrPlaceholder(s.substring(1), span));
  let offset = 0;
  const components = tokens.map((token3, index) => {
    const start = offset + 1;
    offset += token3.length + 1;
    const end = start + token3.length;
    const tokenSpan = new Span(sp.start + start, sp.start + end);
    const isValid = isRelative(token3, tokenSpan) || isNumericOrPlaceholder(token3, tokenSpan);
    if (!isValid) {
      addDiagnostic("Invalid component", tokenSpan);
    }
    return { token: token3, isRelative: isRelative(token3, tokenSpan), index, span: tokenSpan };
  });
  if (components.length < 3) {
    addDiagnostic("Expected 3 components", new Span(sp.start, sp.end));
    return "";
  }
  const coordinateComponents = components.slice(0, 3);
  const allDirectional = coordinateComponents.every((c) => c.token.startsWith("^"));
  const anyDirectional = coordinateComponents.some((c) => c.token.startsWith("^"));
  if (anyDirectional && !allDirectional) {
    addDiagnostic("All components must be directional", sp);
  }
  if (components.length > 5) {
    const extra = components.slice(5);
    const span = new Span(extra[0].span.start, extra[extra.length - 1].span.end);
    addDiagnostic("Expected at most 5 components", span);
  }
  if (components.length >= 4) {
    const yaw = components[3];
    if (!isNumericOrPlaceholder(yaw.token, yaw.span)) {
      addDiagnostic("Invalid yaw", yaw.span);
    }
  }
  if (components.length >= 5) {
    const pitch = components[4];
    if (!isNumericOrPlaceholder(pitch.token, pitch.span)) {
      addDiagnostic("Invalid pitch", pitch.span);
    }
  }
  return value;
}

// dist/htsl/parse/conditions.js
function setField(p, node, key, parser) {
  const { value, span } = p.spanned(parser);
  node[key] = value;
  p.gcx.spans.setField(node, key, span);
  return value;
}
function setFieldWithSpan(p, node, key, value, span) {
  node[key] = value;
  p.gcx.spans.setField(node, key, span);
}
function setNodeSpan(p, node, span) {
  p.gcx.spans.set(node, span);
}
function setConditionMeta(p, condition, inverted, note) {
  if (inverted.value) {
    setFieldWithSpan(p, condition, "inverted", true, inverted.span);
  }
  if (note) {
    setFieldWithSpan(p, condition, "note", note.value.trim(), note.span);
  }
}
function parseCondition(p) {
  function eatKw(kw) {
    return p.eatIdent(kw);
  }
  let note;
  if (p.check("doc_comment")) {
    note = p.spanned(p.parseDocComment);
    p.eat("eol");
  }
  const inverted = p.spanned(() => p.eat("exclamation"));
  if (eatKw("hasGroup")) {
    return parseConditionRequireGroup(p, inverted, note);
  } else if (eatKw("var") || eatKw("stat")) {
    return parseConditionCompareVar(p, inverted, note);
  } else if (eatKw("globalvar") || eatKw("globalstat")) {
    return parseConditionCompareGlobalVar(p, inverted, note);
  } else if (eatKw("hasPermission")) {
    return parseConditionRequirePermission(p, inverted, note);
  } else if (eatKw("inRegion")) {
    return parseConditionIsInRegion(p, inverted, note);
  } else if (eatKw("hasItem")) {
    return parseConditionRequireItem(p, inverted, note);
  } else if (eatKw("doingParkour")) {
    return parseSimpleCondition(p, "IS_DOING_PARKOUR", inverted, note);
  } else if (eatKw("hasPotion")) {
    return parseConditionRequirePotionEffect(p, inverted, note);
  } else if (eatKw("isItem")) {
    return parseConditionIsItem(p, inverted, note);
  } else if (eatKw("isSneaking")) {
    return parseSimpleCondition(p, "IS_SNEAKING", inverted, note);
  } else if (eatKw("isFlying")) {
    return parseSimpleCondition(p, "IS_FLYING", inverted, note);
  } else if (eatKw("health")) {
    return parseConditionCompareHealth(p, inverted, note);
  } else if (eatKw("maxHealth")) {
    return parseConditionCompareMaxHealth(p, inverted, note);
  } else if (eatKw("hunger")) {
    return parseConditionCompareHunger(p, inverted, note);
  } else if (eatKw("portal")) {
    return parseConditionPortalType(p, inverted, note);
  } else if (eatKw("canPvp")) {
    return parseSimpleCondition(p, "PVP_ENABLED", inverted, note);
  } else if (eatKw("gamemode")) {
    return parseConditionRequireGamemode(p, inverted, note);
  } else if (eatKw("placeholder")) {
    return parseConditionComparePlaceholder(p, inverted, note);
  } else if (eatKw("hasTeam")) {
    return parseConditionRequireTeam(p, inverted, note);
  } else if (eatKw("teamvar") || eatKw("teamstat")) {
    return parseConditionCompareTeamVar(p, inverted, note);
  } else if (eatKw("blockType")) {
    return parseConditionBlockType(p, inverted, note);
  } else if (eatKw("damageAmount")) {
    return parseConditionCompareDamage(p, inverted, note);
  } else if (eatKw("damageCause")) {
    return parseConditionDamageCause(p, inverted, note);
  } else if (eatKw("fishingEnv")) {
    return parseConditionFishingEnvironment(p, inverted, note);
  }
  if (p.check("ident")) {
    throw Diagnostic.error("Unknown condition").addPrimarySpan(p.token.span);
  } else {
    throw Diagnostic.error("Expected condition").addPrimarySpan(p.token.span);
  }
}
function parseSimpleCondition(p, type, inverted, note) {
  const condition = { type };
  const typeSpan = p.prev.span;
  p.gcx.spans.setField(condition, "type", typeSpan);
  setConditionMeta(p, condition, inverted, note);
  setNodeSpan(p, condition, typeSpan);
  return condition;
}
function parseConditionRecovering(p, type, inverted, note, parser) {
  const start = p.prev.span.start;
  const typeSpan = p.prev.span;
  const condition = { type };
  p.gcx.spans.setField(condition, "type", typeSpan);
  setConditionMeta(p, condition, inverted, note);
  p.parseRecovering(["comma", { kind: "close_delim", delim: "parenthesis" }], () => {
    parser(condition);
  });
  setNodeSpan(p, condition, new Span(start, p.prev.span.end));
  return condition;
}
function checkEnd(p) {
  return p.check("comma") || p.check({ kind: "close_delim", delim: "parenthesis" });
}
function parseConditionRequireGroup(p, inverted, note) {
  return parseConditionRecovering(p, "REQUIRE_GROUP", inverted, note, (condition) => {
    setField(p, condition, "group", p.parseName);
    if (checkEnd(p))
      return;
    setField(p, condition, "includeHigherGroups", p.parseBoolean);
  });
}
function parseConditionCompareVar(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
    setFieldWithSpan(p, condition, "holder", { type: "Player" }, p.prev.span);
    setField(p, condition, "var", parseVarName);
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseValue);
    if (checkEnd(p))
      return;
    setField(p, condition, "fallback", parseValue);
  });
}
function parseConditionCompareGlobalVar(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
    setFieldWithSpan(p, condition, "holder", { type: "Global" }, p.prev.span);
    setField(p, condition, "var", parseVarName);
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseValue);
    if (checkEnd(p))
      return;
    setField(p, condition, "fallback", parseValue);
  });
}
function parseConditionRequirePermission(p, inverted, note) {
  return parseConditionRecovering(p, "REQUIRE_PERMISSION", inverted, note, (condition) => {
    setField(p, condition, "permission", parsePermission);
  });
}
function parseConditionIsInRegion(p, inverted, note) {
  return parseConditionRecovering(p, "IS_IN_REGION", inverted, note, (condition) => {
    setField(p, condition, "region", p.parseName);
  });
}
function parseConditionRequireItem(p, inverted, note) {
  return parseConditionRecovering(p, "REQUIRE_ITEM", inverted, note, (condition) => {
    setField(p, condition, "itemName", p.parseName);
    if (checkEnd(p))
      return;
    setField(p, condition, "whatToCheck", parseItemProperty);
    if (checkEnd(p))
      return;
    setField(p, condition, "whereToCheck", parseItemLocation);
    if (checkEnd(p))
      return;
    setField(p, condition, "amount", parseItemAmount);
  });
}
function parseConditionRequirePotionEffect(p, inverted, note) {
  return parseConditionRecovering(p, "REQUIRE_POTION_EFFECT", inverted, note, (condition) => {
    setField(p, condition, "effect", parsePotionEffect);
  });
}
function parseConditionCompareHealth(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_HEALTH", inverted, note, (condition) => {
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseNumericValue);
  });
}
function parseConditionCompareMaxHealth(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_MAX_HEALTH", inverted, note, (condition) => {
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseNumericValue);
  });
}
function parseConditionCompareHunger(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_HUNGER", inverted, note, (condition) => {
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseNumericValue);
  });
}
function parseConditionRequireGamemode(p, inverted, note) {
  return parseConditionRecovering(p, "REQUIRE_GAMEMODE", inverted, note, (condition) => {
    setField(p, condition, "gamemode", parseGamemode);
  });
}
function parseConditionComparePlaceholder(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_PLACEHOLDER", inverted, note, (condition) => {
    setField(p, condition, "placeholder", parseAnyPlaceholder);
    const placeholderType = condition.placeholder ? getPlaceholderValueTypeFromValue(condition.placeholder) : void 0;
    setField(p, condition, "op", parseComparison);
    if (placeholderType === "string" && condition.op !== void 0 && condition.op !== "Equal") {
      p.gcx.addDiagnostic(Diagnostic.error("String placeholders can only be compared with ==").addPrimarySpan(p.gcx.spans.getField(condition, "op"), "Use ==").addSecondarySpan(p.gcx.spans.getField(condition, "placeholder"), "Returns a string"));
    }
    const amountParser = placeholderType === "string" ? parseValue : parseNumericValue;
    setField(p, condition, "amount", amountParser);
    if (checkEnd(p))
      return;
    setField(p, condition, "fallback", parseValue);
  });
}
function parseConditionRequireTeam(p, inverted, note) {
  return parseConditionRecovering(p, "REQUIRE_TEAM", inverted, note, (condition) => {
    setField(p, condition, "team", p.parseName);
  });
}
function parseConditionCompareTeamVar(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
    setField(p, condition, "var", parseVarName);
    const teamSpan = p.token.span;
    const team = p.parseName();
    const holder = { type: "Team", team };
    setFieldWithSpan(p, condition, "holder", holder, teamSpan.to(p.prev.span));
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseValue);
    if (checkEnd(p))
      return;
    setField(p, condition, "fallback", parseValue);
  });
}
function parseConditionBlockType(p, inverted, note) {
  return parseConditionRecovering(p, "BLOCK_TYPE", inverted, note, (condition) => {
    setField(p, condition, "itemName", p.parseName);
  });
}
function parseConditionDamageCause(p, inverted, note) {
  return parseConditionRecovering(p, "DAMAGE_CAUSE", inverted, note, (condition) => {
    setField(p, condition, "cause", parseDamageCause);
  });
}
function parseConditionFishingEnvironment(p, inverted, note) {
  return parseConditionRecovering(p, "FISHING_ENVIRONMENT", inverted, note, (condition) => {
    setField(p, condition, "environment", parseFishingEnvironment);
  });
}
function parseConditionIsItem(p, inverted, note) {
  return parseConditionRecovering(p, "IS_ITEM", inverted, note, (condition) => {
    setField(p, condition, "itemName", p.parseName);
  });
}
function parseConditionPortalType(p, inverted, note) {
  return parseConditionRecovering(p, "PORTAL_TYPE", inverted, note, (condition) => {
    setField(p, condition, "portalType", parsePortalType);
  });
}
function parseConditionCompareDamage(p, inverted, note) {
  return parseConditionRecovering(p, "COMPARE_DAMAGE", inverted, note, (condition) => {
    setField(p, condition, "op", parseComparison);
    setField(p, condition, "amount", parseNumericValue);
  });
}

// dist/htsl/parse/actions.js
function setField2(p, node, key, parser) {
  const { value, span } = p.spanned(parser);
  node[key] = value;
  p.gcx.spans.setField(node, key, span);
  return value;
}
function setFieldWithSpan2(p, node, key, value, span) {
  node[key] = value;
  p.gcx.spans.setField(node, key, span);
}
function setNodeSpan2(p, node, span) {
  p.gcx.spans.set(node, span);
}
function setNote(p, node, note) {
  if (!note)
    return;
  setFieldWithSpan2(p, node, "note", note.value.trim(), note.span);
}
function parseAction(p) {
  function eatKw(kw) {
    return p.eatIdent(kw);
  }
  let note;
  if (p.check("doc_comment")) {
    note = p.spanned(p.parseDocComment);
    p.eat("eol");
  }
  if (eatKw("actionBar")) {
    return parseActionActionBar(p, note);
  } else if (eatKw("applyLayout")) {
    return parseActionApplyInventoryLayout(p, note);
  } else if (eatKw("applyPotion")) {
    return parseActionApplyPotionEffect(p, note);
  } else if (eatKw("cancelEvent")) {
    return parseSimpleAction(p, "CANCEL_EVENT", note);
  } else if (eatKw("changeHealth")) {
    return parseActionChangeHealth(p, note);
  } else if (eatKw("changePlayerGroup")) {
    return parseActionSetGroup(p, note);
  } else if (eatKw("changeVelocity")) {
    return parseActionSetVelocity(p, note);
  } else if (eatKw("chat")) {
    return parseActionMessage(p, note);
  } else if (eatKw("clearEffects")) {
    return parseSimpleAction(p, "CLEAR_POTION_EFFECTS", note);
  } else if (eatKw("closeMenu")) {
    return parseSimpleAction(p, "CLOSE_MENU", note);
  } else if (eatKw("compassTarget")) {
    return parseActionSetCompassTarget(p, note);
  } else if (eatKw("displayMenu")) {
    return parseActionDisplayMenu(p, note);
  } else if (eatKw("dropItem")) {
    return parseActionDropItem(p, note);
  } else if (eatKw("enchant")) {
    return parseActionEnchantHeldItem(p, note);
  } else if (eatKw("exit")) {
    return parseSimpleAction(p, "EXIT", note);
  } else if (eatKw("failParkour")) {
    return parseActionFailParkour(p, note);
  } else if (eatKw("fullHeal")) {
    return parseSimpleAction(p, "HEAL", note);
  } else if (eatKw("parkCheck")) {
    return parseSimpleAction(p, "PARKOUR_CHECKPOINT", note);
  } else if (eatKw("function")) {
    return parseActionFunction(p, note);
  } else if (eatKw("gamemode")) {
    return parseActionSetGamemode(p, note);
  } else if (eatKw("giveItem")) {
    return parseActionGiveItem(p, note);
  } else if (eatKw("globalvar") || eatKw("globalstat")) {
    return parseActionChangeGlobalVar(p, note);
  } else if (eatKw("hungerLevel")) {
    return parseActionChangeHunger(p, note);
  } else if (eatKw("if")) {
    return parseActionConditional(p, note);
  } else if (eatKw("kill")) {
    return parseSimpleAction(p, "KILL", note);
  } else if (eatKw("launchTarget")) {
    return parseActionLaunch(p, note);
  } else if (eatKw("lobby")) {
    return parseActionSendToLobby(p, note);
  } else if (eatKw("maxHealth")) {
    return parseActionChangeMaxHealth(p, note);
  } else if (eatKw("pause")) {
    return parseActionPause(p, note);
  } else if (eatKw("random")) {
    return parseActionRandom(p, note);
  } else if (eatKw("removeItem")) {
    return parseActionRemoveItem(p, note);
  } else if (eatKw("resetInventory")) {
    return parseSimpleAction(p, "RESET_INVENTORY", note);
  } else if (eatKw("setTeam")) {
    return parseActionSetTeam(p, note);
  } else if (eatKw("sound")) {
    return parseActionPlaySound(p, note);
  } else if (eatKw("teamvar") || eatKw("teamstat")) {
    return parseActionChangeTeamVar(p, note);
  } else if (eatKw("title")) {
    return parseActionTitle(p, note);
  } else if (eatKw("tp")) {
    return parseActionTeleport(p, note);
  } else if (eatKw("consumeItem")) {
    return parseSimpleAction(p, "USE_HELD_ITEM", note);
  } else if (eatKw("var") || eatKw("stat")) {
    return parseActionChangeVar(p, note);
  } else if (eatKw("playerWeather")) {
    return parseActionSetPlayerWeather(p, note);
  } else if (eatKw("playerTime")) {
    return parseActionSetPlayerTime(p, note);
  } else if (eatKw("displayNametag")) {
    return parseActionToggleNametagDisplay(p, note);
  } else if (eatKw("xpLevel")) {
    return parseActionGiveExperienceLevels(p, note);
  }
  if (p.check("ident")) {
    const err = Diagnostic.error("Unknown action").addPrimarySpan(p.token.span);
    if (p.eatIdent("goto")) {
      let addHelp2 = function(message) {
        err.addSubDiagnostic(Diagnostic.help(message));
      };
      var addHelp = addHelp2;
      err.addSubDiagnostic(Diagnostic.note("'goto' is no longer supported in htsw"));
      if (p.eatIdent("function"))
        addHelp2("Define this function separately in 'import.json'");
      else if (p.eatIdent("event"))
        addHelp2("Define this event separately in 'import.json'");
    }
    throw err;
  }
  p.next();
  throw Diagnostic.error("Expected action").addPrimarySpan(p.prev.span);
}
function parseSimpleAction(p, type, note) {
  const action = { type };
  const typeSpan = p.prev.span;
  setNote(p, action, note);
  setNodeSpan2(p, action, typeSpan);
  p.gcx.spans.setField(action, "type", typeSpan);
  return action;
}
function parseActionRecovering(p, type, note, parser) {
  const start = p.prev.span.start;
  const typeSpan = p.prev.span;
  const action = { type };
  p.gcx.spans.setField(action, "type", typeSpan);
  setNote(p, action, note);
  p.gcx.spans.setField(action, "type", typeSpan);
  p.parseRecovering(["eol"], () => {
    parser(action);
  });
  setNodeSpan2(p, action, new Span(start, p.prev.span.end));
  return action;
}
function parseActionActionBar(p, note) {
  return parseActionRecovering(p, "ACTION_BAR", note, (action) => {
    setField2(p, action, "message", p.parseString);
  });
}
function parseActionApplyInventoryLayout(p, note) {
  return parseActionRecovering(p, "APPLY_INVENTORY_LAYOUT", note, (action) => {
    setField2(p, action, "layout", p.parseString);
  });
}
function parseActionApplyPotionEffect(p, note) {
  return parseActionRecovering(p, "APPLY_POTION_EFFECT", note, (action) => {
    setField2(p, action, "effect", parsePotionEffect);
    setField2(p, action, "duration", () => p.parseBoundedNumber(1, 2592e3));
    setField2(p, action, "level", () => p.parseBoundedNumber(1, 10));
    setField2(p, action, "override", p.parseBoolean);
    if (p.checkEol())
      return;
    setField2(p, action, "showIcon", p.parseBoolean);
  });
}
function parseActionChangeGlobalVar(p, note) {
  return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
    setFieldWithSpan2(p, action, "holder", { type: "Global" }, p.prev.span);
    setField2(p, action, "key", parseVarName);
    const op = setField2(p, action, "op", parseVarOperation);
    if (op === "Unset")
      return;
    setField2(p, action, "value", parseValue);
    if (p.checkEol())
      return;
    setField2(p, action, "unset", p.parseBoolean);
  });
}
function parseActionChangeHealth(p, note) {
  return parseActionRecovering(p, "CHANGE_HEALTH", note, (action) => {
    setField2(p, action, "op", parseOperation);
    setField2(p, action, "amount", parseNumericValue);
  });
}
function parseActionChangeHunger(p, note) {
  return parseActionRecovering(p, "CHANGE_HUNGER", note, (action) => {
    setField2(p, action, "op", parseOperation);
    setField2(p, action, "amount", parseNumericValue);
  });
}
function parseActionChangeMaxHealth(p, note) {
  return parseActionRecovering(p, "CHANGE_MAX_HEALTH", note, (action) => {
    setField2(p, action, "op", parseOperation);
    setField2(p, action, "amount", parseNumericValue);
  });
}
function parseActionChangeTeamVar(p, note) {
  return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
    setField2(p, action, "key", parseVarName);
    const teamSpan = p.token.span;
    const team = p.parseName();
    const holder = { type: "Team", team };
    setFieldWithSpan2(p, action, "holder", holder, teamSpan.to(p.prev.span));
    const op = setField2(p, action, "op", parseVarOperation);
    if (op === "Unset")
      return;
    setField2(p, action, "value", parseValue);
    if (p.checkEol())
      return;
    setField2(p, action, "unset", p.parseBoolean);
  });
}
function parseActionChangeVar(p, note) {
  return parseActionRecovering(p, "CHANGE_VAR", note, (action) => {
    setFieldWithSpan2(p, action, "holder", { type: "Player" }, p.prev.span);
    setField2(p, action, "key", parseVarName);
    const op = setField2(p, action, "op", parseVarOperation);
    if (op === "Unset")
      return;
    setField2(p, action, "value", parseValue);
    if (p.checkEol())
      return;
    setField2(p, action, "unset", p.parseBoolean);
  });
}
function parseActionConditional(p, note) {
  return parseActionRecovering(p, "CONDITIONAL", note, (action) => {
    setField2(p, action, "matchAny", () => {
      if (p.eatIdent("and") || p.eatIdent("false"))
        return false;
      if (p.eatIdent("or") || p.eatIdent("true"))
        return true;
      if (p.check("ident")) {
        throw Diagnostic.error("Expected conditional mode").addPrimarySpan(p.token.span);
      }
      return false;
    });
    setField2(p, action, "conditions", () => {
      return p.parseDelimitedCommaSeq("parenthesis", () => {
        return p.parseRecovering(["comma", { kind: "close_delim", delim: "parenthesis" }], () => parseCondition(p));
      }).filter((it) => it !== void 0);
    });
    setField2(p, action, "ifActions", p.parseBlock);
    const token3 = p.token;
    const hadNewline = p.eat("eol");
    if (p.eatIdent("else")) {
      setField2(p, action, "elseActions", p.parseBlock);
    } else {
      action.elseActions = [];
      if (hadNewline) {
        p.tokens.push(p.token);
        p.token = token3;
      }
    }
  });
}
function parseActionDisplayMenu(p, note) {
  return parseActionRecovering(p, "SET_MENU", note, (action) => {
    setField2(p, action, "menu", p.parseName);
  });
}
function parseActionDropItem(p, note) {
  return parseActionRecovering(p, "DROP_ITEM", note, (action) => {
    setField2(p, action, "itemName", p.parseName);
    if (p.checkEol())
      return;
    if (p.eatIdent("null") || p.eatString("null")) {
      if (p.checkEol())
        return;
    } else {
      setField2(p, action, "location", parseLocation);
      if (p.checkEol())
        return;
    }
    setField2(p, action, "dropNaturally", p.parseBoolean);
    if (p.checkEol())
      return;
    setField2(p, action, "disableMerging", p.parseBoolean);
    if (p.checkEol())
      return;
    setField2(p, action, "prioritizePlayer", p.parseBoolean);
    if (p.checkEol())
      return;
    setField2(p, action, "inventoryFallback", p.parseBoolean);
    if (p.checkEol())
      return;
    setField2(p, action, "despawnDurationTicks", parseNumericValue);
    if (p.checkEol())
      return;
    setField2(p, action, "pickupDelayTicks", parseNumericValue);
  });
}
function parseActionEnchantHeldItem(p, note) {
  return parseActionRecovering(p, "ENCHANT_HELD_ITEM", note, (action) => {
    setField2(p, action, "enchant", parseEnchantment);
    setField2(p, action, "level", () => p.parseBoundedNumber(1, 10));
  });
}
function parseActionFailParkour(p, note) {
  return parseActionRecovering(p, "FAIL_PARKOUR", note, (action) => {
    setField2(p, action, "message", p.parseString);
  });
}
function parseActionFunction(p, note) {
  return parseActionRecovering(p, "FUNCTION", note, (action) => {
    setField2(p, action, "function", p.parseName);
    if (p.checkEol())
      return;
    setField2(p, action, "global", p.parseBoolean);
  });
}
function parseActionGiveExperienceLevels(p, note) {
  return parseActionRecovering(p, "GIVE_EXPERIENCE_LEVELS", note, (action) => {
    setField2(p, action, "amount", parseNumericValue);
  });
}
function parseActionGiveItem(p, note) {
  return parseActionRecovering(p, "GIVE_ITEM", note, (action) => {
    setField2(p, action, "itemName", p.parseName);
    if (p.checkEol())
      return;
    setField2(p, action, "allowMultiple", p.parseBoolean);
    if (p.checkEol())
      return;
    setField2(p, action, "slot", parseInventorySlot);
    if (p.checkEol())
      return;
    setField2(p, action, "replaceExisting", p.parseBoolean);
  });
}
function parseActionLaunch(p, note) {
  return parseActionRecovering(p, "LAUNCH", note, (action) => {
    setField2(p, action, "location", parseLocation);
    setField2(p, action, "strength", () => p.parseBoundedNumber(1, 10));
  });
}
function parseActionMessage(p, note) {
  return parseActionRecovering(p, "MESSAGE", note, (action) => {
    setField2(p, action, "message", p.parseString);
  });
}
function parseActionPause(p, note) {
  return parseActionRecovering(p, "PAUSE", note, (action) => {
    setField2(p, action, "ticks", () => p.parseBoundedNumber(1, 1e3));
  });
}
function parseActionPlaySound(p, note) {
  return parseActionRecovering(p, "PLAY_SOUND", note, (action) => {
    setField2(p, action, "sound", parseSound);
    if (p.checkEol())
      return;
    setField2(p, action, "volume", p.parseDouble);
    if (p.checkEol())
      return;
    setField2(p, action, "pitch", p.parseDouble);
    if (p.checkEol())
      return;
    if (p.eatIdent("null") || p.eatString("null"))
      return;
    setField2(p, action, "location", parseLocation);
  });
}
function parseActionRandom(p, note) {
  return parseActionRecovering(p, "RANDOM", note, (action) => {
    setField2(p, action, "actions", p.parseBlock);
  });
}
function parseActionRemoveItem(p, note) {
  return parseActionRecovering(p, "REMOVE_ITEM", note, (action) => {
    setField2(p, action, "itemName", p.parseName);
  });
}
function parseActionSendToLobby(p, note) {
  return parseActionRecovering(p, "SEND_TO_LOBBY", note, (action) => {
    setField2(p, action, "lobby", parseLobby);
  });
}
function parseActionSetCompassTarget(p, note) {
  return parseActionRecovering(p, "SET_COMPASS_TARGET", note, (action) => {
    setField2(p, action, "location", parseLocation);
  });
}
function parseActionSetGamemode(p, note) {
  return parseActionRecovering(p, "SET_GAMEMODE", note, (action) => {
    setField2(p, action, "gamemode", parseGamemode);
  });
}
function parseActionSetGroup(p, note) {
  return parseActionRecovering(p, "SET_GROUP", note, (action) => {
    setField2(p, action, "group", p.parseString);
    if (p.checkEol())
      return;
    setField2(p, action, "demotionProtection", p.parseBoolean);
  });
}
function parseActionSetTeam(p, note) {
  return parseActionRecovering(p, "SET_TEAM", note, (action) => {
    setField2(p, action, "team", p.parseName);
  });
}
function parseActionSetPlayerWeather(p, note) {
  return parseActionRecovering(p, "SET_PLAYER_WEATHER", note, (action) => {
    setField2(p, action, "weather", p.parseString);
  });
}
function parseActionSetPlayerTime(p, note) {
  return parseActionRecovering(p, "SET_PLAYER_TIME", note, (action) => {
    setField2(p, action, "time", p.parseString);
  });
}
function parseActionToggleNametagDisplay(p, note) {
  return parseActionRecovering(p, "TOGGLE_NAMETAG_DISPLAY", note, (action) => {
    setField2(p, action, "displayNametag", p.parseBoolean);
  });
}
function parseActionSetVelocity(p, note) {
  return parseActionRecovering(p, "SET_VELOCITY", note, (action) => {
    setField2(p, action, "x", parseNumericValue);
    setField2(p, action, "y", parseNumericValue);
    setField2(p, action, "z", parseNumericValue);
  });
}
function parseActionTeleport(p, note) {
  return parseActionRecovering(p, "TELEPORT", note, (action) => {
    setField2(p, action, "location", parseLocation);
    if (p.checkEol())
      return;
    setField2(p, action, "preventTeleportInsideBlocks", p.parseBoolean);
  });
}
function parseActionTitle(p, note) {
  return parseActionRecovering(p, "TITLE", note, (action) => {
    setField2(p, action, "title", p.parseString);
    if (p.checkEol())
      return;
    setField2(p, action, "subtitle", p.parseString);
    if (p.checkEol())
      return;
    setField2(p, action, "fadein", () => p.parseBoundedNumber(0, 5));
    setField2(p, action, "stay", () => p.parseBoundedNumber(0, 10));
    setField2(p, action, "fadeout", () => p.parseBoundedNumber(0, 5));
  });
}

// dist/htsl/parse/parser.js
function normalizeNumberLiteral2(value) {
  return value.replaceAll("_", "");
}
var Parser2 = class {
  gcx;
  lexer;
  tokens;
  token;
  prev;
  constructor(ctx, lexer) {
    this.gcx = ctx;
    this.lexer = lexer;
    this.tokens = [];
    this.token = { kind: "eof", span: new Span(0, 0) };
    this.prev = this.token;
    this.next();
  }
  parseCompletely() {
    const actions = [];
    while (true) {
      this.eatNewlines();
      if (this.check("eof"))
        break;
      const action = this.parseRecovering(["eol"], () => parseAction(this));
      if (!this.eat("eol") && !this.check("eof")) {
        this.gcx.addDiagnostic(Diagnostic.error("Expected end of line").addPrimarySpan(this.token.span));
      }
      if (action === void 0)
        continue;
      actions.push(action);
    }
    return actions;
  }
  parseBlock() {
    const actions = [];
    this.expect({ kind: "open_delim", delim: "brace" });
    while (true) {
      this.eatNewlines();
      if (this.check("eof")) {
        throw Diagnostic.error("expected }").addPrimarySpan(this.token.span);
      }
      if (this.eat({ kind: "close_delim", delim: "brace" }))
        break;
      const action = this.parseRecovering(["eol", { kind: "close_delim", delim: "brace" }], parseAction);
      if (!action)
        continue;
      if (!this.eat("eol") && !this.check("eof") && !this.check({ kind: "close_delim", delim: "brace" })) {
        this.gcx.addDiagnostic(Diagnostic.error("Expected end of line").addPrimarySpan(this.token.span));
      }
      actions.push(action);
    }
    return actions;
  }
  parseName() {
    if (this.token.kind !== "ident" && this.token.kind !== "str") {
      throw Diagnostic.error("Expected name").addPrimarySpan(this.token.span);
    }
    const value = this.token.value;
    this.next();
    return value;
  }
  parseBoolean() {
    let value;
    if (this.eatIdent("true"))
      value = true;
    else if (this.eatIdent("false"))
      value = false;
    if (value === void 0) {
      throw Diagnostic.error("Expected true/false value").addPrimarySpan(this.token.span);
    }
    return value;
  }
  /**
   * Attempts to match and return a value from a list of valid options.
   *
   * Matching is case-insensitive and performed against a normalized form of
   * each option, where spaces in the option list are converted to underscores
   * before comparison. The returned value preserves the original formatting
   * from the `options` list.
   *
   * @param options A list of valid option strings.
   * @param errorFormatting Terms used when generating error messages.
   * @returns The parsed option in its canonical form from the `options` list.
   */
  parseOption(options, errorTerms) {
    const normalize = (value) => value.replaceAll(" ", "").replaceAll("_", "").toLowerCase();
    for (const option of options) {
      if (this.check("ident") && normalize(this.token.value) === normalize(option)) {
        this.next();
        return option;
      }
    }
    const err = Diagnostic.error(`Expected ${errorTerms?.singular ?? "option"}`).addPrimarySpan(this.token.span);
    function addHelp(message) {
      err.addSubDiagnostic(Diagnostic.help(message));
    }
    if (this.check("ident")) {
      addHelp(`Valid ${errorTerms?.plural ?? "options"} are:`);
      const optionsToDisplay = Math.min(5, options.length);
      for (let i = 0; i < optionsToDisplay; i++) {
        addHelp(`  ${options[i].replaceAll(" ", "_")}`);
      }
      if (options.length > 5) {
        addHelp(`And ${options.length - 5} others`);
      }
    } else if (this.check("str")) {
      for (const option of options) {
        if (normalize(this.token.value) === normalize(option)) {
          this.next();
          return option;
        }
      }
    }
    throw err;
  }
  parseDocComment() {
    this.expect("doc_comment");
    return this.prev.value;
  }
  parseIdent() {
    this.expect("ident");
    return this.prev.value;
  }
  parseString() {
    if (this.eat("placeholder")) {
      return `%${this.prev.value}%`;
    }
    this.expect("str");
    return this.prev.value;
  }
  parseBoundedNumber(min, max) {
    const { value, span } = this.spanned(this.parseNumber);
    if (Number(value) < min) {
      this.gcx.addDiagnostic(Diagnostic.error(`Value must be greater than or equal to ${min}`).addPrimarySpan(span));
    }
    if (Number(value) > max) {
      this.gcx.addDiagnostic(Diagnostic.error(`Value must be less than or equal to ${max}`).addPrimarySpan(span));
    }
    return Number(value);
  }
  parseNumber() {
    const negative = this.eat({ kind: "bin_op", op: "minus" });
    this.expect("i64");
    const value = normalizeNumberLiteral2(this.prev.value);
    const withNegative = negative ? `-${value}` : value;
    const long = Long2.fromString(withNegative);
    if (withNegative != long.toString()) {
      throw Diagnostic.error("Number exceeds 64-bit integer limit").addPrimarySpan(this.prev.span);
    }
    return long;
  }
  parseDouble() {
    const negative = this.eat({ kind: "bin_op", op: "minus" });
    if (this.token.kind !== "i64" && this.token.kind !== "f64") {
      throw Diagnostic.error("Expected number").addPrimarySpan(this.token.span);
    }
    this.next();
    const value = normalizeNumberLiteral2(this.prev.value);
    const withNegative = negative ? `-${value}` : value;
    const double = parseFloat(withNegative);
    return double;
  }
  parseDelimitedTokens(delim) {
    const tokens = [];
    this.expect({ kind: "open_delim", delim });
    let depth = 1;
    while (true) {
      if (this.check("eof")) {
        throw Diagnostic.error(`expected ${tokenToString2({ kind: "close_delim", delim })}`).addPrimarySpan(this.token.span);
      }
      if (this.check({ kind: "close_delim", delim })) {
        if (depth === 1)
          break;
        depth--;
      } else if (this.check({ kind: "open_delim", delim })) {
        depth++;
      }
      tokens.push(this.token);
      this.next();
    }
    this.next();
    return tokens;
  }
  parseDelimitedCommaSeq(delim, parser) {
    this.expect({ kind: "open_delim", delim });
    const seq = [];
    this.eatNewlines();
    const closeDelim = { kind: "close_delim", delim };
    while (!this.eat(closeDelim)) {
      if (this.token.kind === "eof") {
        throw Diagnostic.error(`Expected ${tokenToString2(closeDelim)}`).addPrimarySpan(this.token.span);
      }
      seq.push(parser.call(this, this));
      this.eatNewlines();
      if (!this.eat("comma")) {
        if (!this.eat(closeDelim)) {
          this.gcx.addDiagnostic(Diagnostic.error("expected ,").addPrimarySpan(this.token.span));
          this.recover([closeDelim]);
        } else
          break;
      }
      this.eatNewlines();
    }
    return seq;
  }
  parseRecovering(recoveryTokens, parser) {
    try {
      return parser.call(this, this);
    } catch (e) {
      if (e instanceof Diagnostic) {
        this.gcx.addDiagnostic(e);
        this.recover(recoveryTokens);
      } else
        throw e;
    }
  }
  checkEol() {
    return this.check("eol") || this.check("eof");
  }
  spanned(parser) {
    const lo = this.token.span.start;
    const value = parser.call(this, this);
    const hi = this.prev.span.end;
    return { value, span: new Span(lo, hi) };
  }
  eatString(value) {
    if (this.token.kind !== "str")
      return false;
    if (this.token.value.toLowerCase() == value.toLowerCase()) {
      this.next();
      return true;
    }
    return false;
  }
  eatIdent(value, caseInsensitive = false) {
    if (this.token.kind !== "ident")
      return false;
    if (caseInsensitive) {
      if (this.token.value.toLowerCase() == value.toLowerCase()) {
        this.next();
        return true;
      }
      return false;
    }
    return this.eat({ kind: "ident", value });
  }
  eatNewlines() {
    while (this.eat("eol")) {
    }
  }
  recover(recoveryTokens) {
    while (true) {
      if (recoveryTokens.find((token3) => this.check(token3)) || this.check("eof")) {
        return;
      }
      this.next();
    }
  }
  expect(tok) {
    if (!this.eat(tok)) {
      throw Diagnostic.error(`Expected ${tokenToString2(tok)}`).addPrimarySpan(this.token.span);
    }
  }
  eat(tok) {
    const matches = this.check(tok);
    if (matches)
      this.next();
    return matches;
  }
  check(tok) {
    return typeof tok === "string" ? this.token.kind === tok : partialEq(this.token, tok);
  }
  next() {
    this.prev = this.token;
    if (this.tokens.length === 0) {
      this.tokens.push(this.lexer.advanceToken());
    }
    this.token = this.tokens.shift();
  }
};

// dist/htsl/typecheck/state.js
function known(value) {
  return { isKnown: true, value };
}
function unknown() {
  return { isKnown: false };
}
function constant(value) {
  return { type: "constant", constant: value };
}
function range(start, end) {
  return { type: "range", start, end };
}
function knownConst(value) {
  return known(constant(value));
}
function knownRange(start, end) {
  return known(range(start, end));
}
function unknownNumericState() {
  return unknown();
}
function unknownStringState() {
  return unknown();
}
function longConst(value) {
  return { type: "long", ...knownConst(value) };
}
function longRange(start, end) {
  return { type: "long", ...knownRange(start, end) };
}
function doubleConst(value) {
  return { type: "double", ...knownConst(value) };
}
function doubleRange(start, end) {
  return { type: "double", ...knownRange(start, end) };
}
function string(value) {
  return { type: "string", ...known(value) };
}
function unknownLong() {
  return { type: "long", ...unknownNumericState() };
}
function unknownDouble() {
  return { type: "double", ...unknownNumericState() };
}
function unknownString() {
  return { type: "string", ...unknownStringState() };
}
function longMin(a, b) {
  return a.lt(b) ? a : b;
}
function longMax(a, b) {
  return a.gt(b) ? a : b;
}
function longArrayMin(arr) {
  let min = arr[0];
  for (let i = 1; i < arr.length; i++) {
    min = longMin(min, arr[i]);
  }
  return min;
}
function longArrayMax(arr) {
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    max = longMax(max, arr[i]);
  }
  return max;
}
function applyNumericOperation(lhs, rhs, op) {
  const isLongState = (state) => {
    const v = state.value;
    return v.type === "constant" && typeof v.constant === "object" && typeof v.constant.add === "function" || v.type === "range" && typeof v.start === "object" && typeof v.start.add === "function";
  };
  const isNumberState = (state) => {
    const v = state.value;
    return v.type === "constant" && typeof v.constant === "number" || v.type === "range" && typeof v.start === "number";
  };
  if (isLongState(lhs) && isLongState(rhs)) {
    switch (op) {
      case "Increment":
        return addLongStates(lhs, rhs);
      case "Decrement":
        return subLongStates(lhs, rhs);
      case "Multiply":
        return mulLongStates(lhs, rhs);
      case "Divide":
        return divLongStates(lhs, rhs);
      case "Shift Left":
        return shlLongStates(lhs, rhs);
      case "Shift Right":
        return shrLongStates(lhs, rhs);
      case "And Assign":
        return andLongStates(lhs, rhs);
      case "Or Assign":
        return orLongStates(lhs, rhs);
      case "Xor Assign":
        return xorLongStates(lhs, rhs);
      default:
        throw new Error("Invalid operation for type");
    }
  } else if (isNumberState(lhs) && isNumberState(rhs)) {
    switch (op) {
      case "Increment":
        return addDoubleStates(lhs, rhs);
      case "Decrement":
        return subDoubleStates(lhs, rhs);
      case "Multiply":
        return mulDoubleStates(lhs, rhs);
      case "Divide":
        return divDoubleStates(lhs, rhs);
      default:
        throw new Error("Invalid operation for type");
    }
  } else {
    throw new Error("Numerical operation type mismatch");
  }
}
function addLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.add(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    return knownRange(lval.start.add(rval.start), lval.end.add(rval.end));
  } else if (lval.type === "range" && rval.type === "constant") {
    return knownRange(lval.start.add(rval.constant), lval.end.add(rval.constant));
  } else if (lval.type === "constant" && rval.type === "range") {
    return knownRange(lval.constant.add(rval.start), lval.constant.add(rval.end));
  }
  throw Error("Unreachable");
}
function subLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.sub(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    return knownRange(lval.start.sub(rval.end), lval.end.sub(rval.start));
  } else if (lval.type === "range" && rval.type === "constant") {
    return knownRange(lval.start.sub(rval.constant), lval.end.sub(rval.constant));
  } else if (lval.type === "constant" && rval.type === "range") {
    return knownRange(lval.constant.sub(rval.end), lval.constant.sub(rval.end));
  }
  throw Error("Unreachable");
}
function mulLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.mul(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    return knownRange(lval.start.mul(rval.start), lval.end.mul(rval.end));
  } else if (lval.type === "range" && rval.type === "constant") {
    return knownRange(lval.start.mul(rval.constant), lval.end.mul(rval.constant));
  } else if (lval.type === "constant" && rval.type === "range") {
    return knownRange(lval.constant.mul(rval.start), lval.constant.mul(rval.end));
  }
  throw Error("Unreachable");
}
function divLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.div(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start.div(rval.start),
      lval.start.div(rval.end),
      lval.end.div(rval.start),
      lval.end.div(rval.end)
    ];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start.div(rval.constant), lval.end.div(rval.constant)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant.div(rval.start), lval.constant.div(rval.end)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  }
  throw Error("Unreachable");
}
function shlLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.shl(rval.constant.toNumber()));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start.shl(rval.start.toNumber()),
      lval.start.shl(rval.end.toNumber()),
      lval.end.shl(rval.start.toNumber()),
      lval.end.shl(rval.end.toNumber())
    ];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start.shl(rval.constant.toNumber()), lval.end.shl(rval.constant.toNumber())];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant.shl(rval.start.toNumber()), lval.constant.shl(rval.end.toNumber())];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  }
  throw Error("Unreachable");
}
function shrLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.shr(rval.constant.toNumber()));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start.shr(rval.start.toNumber()),
      lval.start.shr(rval.end.toNumber()),
      lval.end.shr(rval.start.toNumber()),
      lval.end.shr(rval.end.toNumber())
    ];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start.shr(rval.constant.toNumber()), lval.end.shr(rval.constant.toNumber())];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant.shr(rval.start.toNumber()), lval.constant.shr(rval.end.toNumber())];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  }
  throw Error("Unreachable");
}
function andLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.and(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start.and(rval.start),
      lval.start.and(rval.end),
      lval.end.and(rval.start),
      lval.end.and(rval.end)
    ];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start.and(rval.constant), lval.end.and(rval.constant)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant.and(rval.start), lval.constant.and(rval.end)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  }
  throw Error("Unreachable");
}
function orLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.or(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start.or(rval.start),
      lval.start.or(rval.end),
      lval.end.or(rval.start),
      lval.end.or(rval.end)
    ];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start.or(rval.constant), lval.end.or(rval.constant)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant.or(rval.start), lval.constant.or(rval.end)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  }
  throw Error("Unreachable");
}
function xorLongStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant.xor(rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start.xor(rval.start),
      lval.start.xor(rval.end),
      lval.end.xor(rval.start),
      lval.end.xor(rval.end)
    ];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start.xor(rval.constant), lval.end.xor(rval.constant)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant.xor(rval.start), lval.constant.xor(rval.end)];
    return knownRange(longArrayMin(candidates), longArrayMax(candidates));
  }
  throw Error("Unreachable");
}
function addDoubleStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant + rval.constant);
  } else if (lval.type === "range" && rval.type === "range") {
    return knownRange(lval.start + rval.start, lval.end + rval.end);
  } else if (lval.type === "range" && rval.type === "constant") {
    return knownRange(lval.start + rval.constant, lval.end + rval.constant);
  } else if (lval.type === "constant" && rval.type === "range") {
    return knownRange(lval.constant + rval.start, lval.constant + rval.end);
  }
  throw Error("Unreachable");
}
function subDoubleStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant - rval.constant);
  } else if (lval.type === "range" && rval.type === "range") {
    return knownRange(lval.start - rval.end, lval.end - rval.start);
  } else if (lval.type === "range" && rval.type === "constant") {
    return knownRange(lval.start - rval.constant, lval.end - rval.constant);
  } else if (lval.type === "constant" && rval.type === "range") {
    return knownRange(lval.constant - rval.end, lval.constant - rval.start);
  }
  throw Error("Unreachable");
}
function mulDoubleStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(lval.constant * rval.constant);
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      lval.start * rval.start,
      lval.start * rval.end,
      lval.end * rval.start,
      lval.end * rval.end
    ];
    return knownRange(Math.min(...candidates), Math.max(...candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [lval.start * rval.constant, lval.end * rval.constant];
    return knownRange(Math.min(...candidates), Math.max(...candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [lval.constant * rval.start, lval.constant * rval.end];
    return knownRange(Math.min(...candidates), Math.max(...candidates));
  }
  throw Error("Unreachable");
}
function divDoubleStates(lhs, rhs) {
  const lval = lhs.value;
  const rval = rhs.value;
  const safeDiv = (a, b) => b === 0 ? a / 1 : a / b;
  if (lval.type === "constant" && rval.type === "constant") {
    return knownConst(safeDiv(lval.constant, rval.constant));
  } else if (lval.type === "range" && rval.type === "range") {
    const candidates = [
      safeDiv(lval.start, rval.start),
      safeDiv(lval.start, rval.end),
      safeDiv(lval.end, rval.start),
      safeDiv(lval.end, rval.end)
    ];
    return knownRange(Math.min(...candidates), Math.max(...candidates));
  } else if (lval.type === "range" && rval.type === "constant") {
    const candidates = [safeDiv(lval.start, rval.constant), safeDiv(lval.end, rval.constant)];
    return knownRange(Math.min(...candidates), Math.max(...candidates));
  } else if (lval.type === "constant" && rval.type === "range") {
    const candidates = [safeDiv(lval.constant, rval.start), safeDiv(lval.constant, rval.end)];
    return knownRange(Math.min(...candidates), Math.max(...candidates));
  }
  throw Error("Unreachable");
}

// dist/htsl/typecheck/context.js
function varKeyToString(key) {
  if (key.holder.type === "Team") {
    return `${key.holder.type} ${key.holder.team} ${key.key}`;
  } else {
    return `${key.holder.type} ${key.key}`;
  }
}
function spanToString(span) {
  return `${span.start} ${span.end}`;
}
var TyCtxt = class _TyCtxt {
  gcx;
  states;
  emittedDiagnosticLocations;
  constructor(gcx, states, emittedDiagnosticLocations) {
    this.gcx = gcx;
    this.states = states;
    this.emittedDiagnosticLocations = emittedDiagnosticLocations;
  }
  static fromGlobalCtxt(gcx) {
    return new _TyCtxt(gcx, /* @__PURE__ */ new Map(), /* @__PURE__ */ new Set());
  }
  hasState(key) {
    return this.states.has(varKeyToString(key));
  }
  getState(key) {
    return this.states.get(varKeyToString(key));
  }
  setState(key, state) {
    this.states.set(varKeyToString(key), state);
  }
  removeState(key) {
    this.states.delete(varKeyToString(key));
  }
  clearState() {
    this.states.clear();
  }
  clone() {
    return new _TyCtxt(this.gcx, new Map(JSON.parse(JSON.stringify([...this.states]))), this.emittedDiagnosticLocations);
  }
  addDiagnostic(diag) {
    for (const ds of diag.spans) {
      if (this.emittedDiagnosticLocations.has(spanToString(ds.span)))
        return;
      this.emittedDiagnosticLocations.add(spanToString(ds.span));
    }
    this.gcx.addDiagnostic(diag);
  }
};

// dist/htsl/typecheck/values.js
function parseValue2(tcx, value) {
  if (!value) {
    throw Error("Value cannot be null or empty");
  }
  if (value.startsWith("%") && value.endsWith("%") && value.length > 2) {
    const content = value.substring(1, value.length - 1);
    return parsePlaceholder2(tcx, content);
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    const content = value.substring(1, value.length - 1);
    return parseString(tcx, content);
  }
  if (value.includes(".") && !isNaN(Number(value))) {
    return doubleConst(Number(value));
  }
  if (/^-?\d+$/.test(value)) {
    return longConst(Long2.fromString(value));
  }
  throw Error("Invalid value type");
}
var PLACEHOLDER_REGEX = /%([^%]+?)%/g;
var ONE_PLACEHOLDER_REGEX = /^%([^%]+?)%$/;
var OBVIOUS_CAST_REGEX = /^%([^%]+?)%(L|D)$/;
function parseString(tcx, value) {
  const placeholders = value.match(PLACEHOLDER_REGEX);
  if (!placeholders) {
    return string(value);
  }
  if (ONE_PLACEHOLDER_REGEX.test(value)) {
    const placeholder = value.slice(1, -1);
    return parsePlaceholder2(tcx, placeholder);
  }
  if (OBVIOUS_CAST_REGEX.test(value)) {
    const placeholder = value.slice(1, -2);
    const state = parsePlaceholder2(tcx, placeholder);
    if (!state)
      return;
    if (state.type !== "string") {
      if (value.charAt(value.length - 1) === "L") {
        return unknownLong();
      } else {
        return unknownDouble();
      }
    }
  }
}
function parsePlaceholder2(tcx, placeholder) {
  const pivotIndex = placeholder.indexOf("/");
  const name = (pivotIndex === -1 ? placeholder : placeholder.substring(0, pivotIndex)).toLowerCase();
  const argsString = pivotIndex === -1 ? "" : placeholder.substring(pivotIndex + 1);
  let args = [];
  if (argsString) {
    args = argsString.split(" ").filter((arg) => arg);
    if (args.length === 0)
      args = [""];
  }
  return runPlaceholder(tcx, name, ...args);
}
function runPlaceholder(tcx, name, ...args) {
  switch (name) {
    case "server.name":
      return unknownString();
    case "server.shortname":
      return unknownString();
    case "player.name":
      return unknownString();
    case "player.ping":
      return unknownLong();
    case "player.health":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(20));
    case "player.maxhealth":
      return unknownLong();
    case "player.hunger":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(20));
    case "player.experience":
      return unknownLong();
    case "player.level":
      return unknownLong();
    case "player.version":
      return unknownString();
    case "player.protocol":
      return unknownLong();
    case "player.gamemode":
      return unknownString();
    case "player.region.name":
      return unknownString();
    case "player.pos.x":
      return unknownDouble();
    case "player.pos.y":
      return unknownDouble();
    case "player.pos.z":
      return unknownDouble();
    case "player.pos.pitch":
      return doubleRange(-90, 90);
    case "player.pos.yaw":
      return doubleRange(-180, 180);
    case "player.block.x":
      return unknownLong();
    case "player.block.y":
      return unknownLong();
    case "player.block.z":
      return unknownLong();
    case "player.group.name":
      return unknownString();
    case "player.group.tag":
      return unknownString();
    case "player.group.priority":
      return longRange(Long2.fromNumber(1), Long2.fromNumber(20));
    case "player.group.color":
      return unknownString();
    case "player.team.name":
      return unknownString();
    case "player.team.tag":
      return unknownString();
    case "player.team.color":
      return unknownString();
    case "player.team.players":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(250));
    case "player.parkour.ticks":
      return unknownLong();
    case "player.parkour.formatted":
      return unknownString();
    case "house.name":
      return unknownString();
    case "house.guests":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(250));
    case "house.cookies":
      return unknownString();
    case "house.visitingrules":
      return unknownString();
    case "house.players":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(250));
    case "date.day":
      return longRange(Long2.fromNumber(1), Long2.fromNumber(31));
    case "date.month":
      return longRange(Long2.fromNumber(1), Long2.fromNumber(12));
    case "date.year":
      return unknownLong();
    case "date.hour":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(24));
    case "date.minute":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(60));
    case "date.seconds":
      return longRange(Long2.fromNumber(0), Long2.fromNumber(60));
    case "date.unix":
      return unknownLong();
    case "date.unix.ms":
      return unknownLong();
    case "random.int":
    case "random.whole":
      if (args.length === 0) {
        return longRange(Long2.fromNumber(0), Long2.fromNumber(1e5));
      }
      if (args.length !== 2)
        return longConst(Long2.fromNumber(0));
      if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) {
        return longConst(Long2.fromNumber(0));
      }
      return longRange(Long2.fromString(args[0]), Long2.fromString(args[1]));
    case "random.decimal":
      if (args.length === 0) {
        return doubleRange(0, 1);
      }
      if (args.length !== 2)
        return doubleConst(0);
      if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) {
        return doubleConst(0);
      }
      return doubleRange(Number(args[0]), Number(args[1]));
    case "var.player":
      const pkey = { holder: { type: "Player" }, key: args[0] };
      if (tcx.hasState(pkey)) {
        return tcx.getState(pkey);
      } else {
        return void 0;
      }
    case "var.global":
      const gkey = { holder: { type: "Global" }, key: args[0] };
      if (tcx.hasState(gkey)) {
        return tcx.getState(gkey);
      } else {
        return void 0;
      }
    case "var.team":
      const tkey = { holder: { type: "Team", team: args[1] }, key: args[0] };
      if (tcx.hasState(tkey)) {
        return tcx.getState(tkey);
      } else {
        return void 0;
      }
    default:
      return unknownString();
  }
}

// dist/htsl/typecheck/check.js
function check2(tcx, actions) {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.type === "CHANGE_VAR") {
      update(tcx, action);
    } else if (action.type === "CONDITIONAL") {
      if (!action.conditions || action.matchAny === void 0)
        continue;
      for (const subCtxt of narrow(tcx, action.conditions, action.matchAny)) {
        check2(subCtxt, action.ifActions);
        check2(subCtxt, actions.slice(i + 1));
      }
      for (const subCtxt of narrow(tcx, action.conditions, action.matchAny, true)) {
        check2(subCtxt, action.elseActions);
        check2(subCtxt, actions.slice(i + 1));
      }
      return;
    } else if (action.type === "RANDOM") {
      if (!action.actions)
        continue;
      for (const subAction of action.actions) {
        check2(tcx, [subAction, ...actions.slice(i + 1)]);
      }
      return;
    } else if (action.type === "PAUSE") {
      tcx.clearState();
    }
  }
}
var OPERATION_NAMES = {
  Set: "assigned",
  Increment: "incremented",
  Decrement: "decremented",
  Multiply: "multiplied",
  Divide: "divided",
  "Shift Left": "shifted left",
  "Shift Right": "shifted right",
  "And Assign": "used with logical and",
  "Or Assign": "used with logical or",
  "Xor Assign": "used with logical xor",
  Unset: "unset"
};
var DISALLOWED_DOUBLE_OPERATIONS = [
  "Shift Left",
  "Shift Right",
  "And Assign",
  "Or Assign",
  "Xor Assign"
];
function update(tcx, action) {
  if (!action.holder || !action.key || !action.op || !action.value)
    return;
  const key = { holder: action.holder, key: action.key };
  const lhs = tcx.getState(key);
  const rhs = parseValue2(tcx, action.value);
  const span = tcx.gcx.spans.get(action);
  const opSpan = tcx.gcx.spans.getField(action, "op");
  const keySpan = tcx.gcx.spans.getField(action, "key");
  const valueSpan = tcx.gcx.spans.getField(action, "value");
  if (!rhs)
    return;
  if (action.op === "Set") {
    tcx.setState(key, { ...rhs, declSpan: span });
    return;
  }
  if (action.op === "Unset") {
    tcx.removeState(key);
    return;
  }
  if (lhs && lhs.type === "string") {
    tcx.addDiagnostic(Diagnostic.warning(`Strings cannot be ${OPERATION_NAMES[action.op]}`).addPrimarySpan(opSpan, "Invalid operation").addSecondarySpan(keySpan, `Type inferred as ${lhs.type}`).addSecondarySpan(lhs.declSpan, "Type originates from this statement"));
    return;
  }
  if (lhs && lhs.type === "double" && DISALLOWED_DOUBLE_OPERATIONS.includes(action.op)) {
    tcx.addDiagnostic(Diagnostic.warning(`Doubles cannot be ${OPERATION_NAMES[action.op]}`).addPrimarySpan(opSpan, "Invalid operation").addSecondarySpan(keySpan, `Type inferred as ${lhs.type}`).addSecondarySpan(lhs.declSpan, "Type originates from this statement"));
    return;
  }
  if (!lhs) {
    tcx.setState(key, { type: rhs.type, isKnown: false, declSpan: span });
    return;
  }
  if (lhs.type !== rhs.type) {
    tcx.addDiagnostic(Diagnostic.warning("Mismatched types").addPrimarySpan(opSpan, "Mismatched types").addSecondarySpan(keySpan, `Type is ${lhs.type}`).addSecondarySpan(valueSpan, `Type is ${rhs.type}`).addSecondarySpan(lhs.declSpan, `Type of ${action.key} inferred here`));
    return;
  }
  if (!lhs.isKnown || !rhs.isKnown) {
    tcx.setState(key, { ...lhs, isKnown: false });
    return;
  }
  const newValue = applyNumericOperation(lhs, rhs, action.op);
  tcx.setState(key, { ...lhs, ...newValue });
}
function maybeInvert(value, inverted) {
  return inverted ? !value : value;
}
function narrow(tcx, conditions, matchAny, inverted = false) {
  if (conditions.length === 0) {
    return inverted ? [] : [tcx];
  }
  return inverted ? [] : [tcx];
  if (maybeInvert(matchAny, inverted)) {
    const res = [];
    for (const condition of conditions) {
      res.push(...narrow(tcx, [condition], inverted, inverted));
    }
    return res;
  }
  return [];
}

// dist/htsl/parse/index.js
var htslCache = /* @__PURE__ */ new Map();
function clearHtslCache() {
  htslCache.clear();
}
var mtimeProvider = null;
function setHtslCacheMtimeProvider(fn) {
  mtimeProvider = fn;
}
function parseHtsl(gcx, path2) {
  try {
    const timing = gcx.htslTiming;
    if (mtimeProvider !== null) {
      const t02 = timing ? Date.now() : 0;
      const mtime2 = mtimeProvider(path2);
      const cached = htslCache.get(path2);
      if (cached !== void 0 && mtime2 !== 0 && cached.mtime === mtime2) {
        if (timing) {
          timing.fileCount++;
          timing.cacheHits++;
          timing.fileReadMs += Date.now() - t02;
        }
        return cached.actions;
      }
    }
    const t0 = timing ? Date.now() : 0;
    const file = gcx.sourceMap.getFile(path2);
    const t1 = timing ? Date.now() : 0;
    const diagnosticsBefore = gcx.diagnostics.length;
    const lexer = new Lexer2(file);
    const parser = new Parser2(gcx, lexer);
    const actions = parser.parseCompletely();
    const t2 = timing ? Date.now() : 0;
    const tcx = TyCtxt.fromGlobalCtxt(gcx);
    check2(tcx, actions);
    const t3 = timing ? Date.now() : 0;
    const producedDiagnostics = gcx.diagnostics.length > diagnosticsBefore;
    const mtime = mtimeProvider !== null ? mtimeProvider(path2) : 0;
    if (producedDiagnostics) {
      htslCache.delete(path2);
    } else {
      htslCache.set(path2, { mtime, actions });
    }
    if (timing) {
      timing.fileCount++;
      timing.fileReadMs += t1 - t0;
      timing.lexParseMs += t2 - t1;
      timing.typeflowMs += t3 - t2;
    }
    return actions;
  } catch (e) {
    htslCache.delete(path2);
    if (e instanceof Error) {
      gcx.addDiagnostic(Diagnostic.bugFromError(e));
    } else {
      gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path2}`));
    }
    return [];
  }
}

// dist/htsl/print/index.js
var print_exports = {};
__export(print_exports, {
  DEFAULT_PRINT_STYLE: () => DEFAULT_PRINT_STYLE,
  printAction: () => printAction,
  printActions: () => printActions,
  printActionsWithDiagnostics: () => printActionsWithDiagnostics,
  printCondition: () => printCondition2
});

// dist/htsl/print/helpers.js
var PLACEHOLDER_RE = /^%[^%]+%$/;
var BARE_NAME_RE = /^[a-zA-Z_][a-zA-Z_/0-9.\-]*$/;
function isPlaceholderOnly(s) {
  return PLACEHOLDER_RE.test(s);
}
function isBareNameSafe(s) {
  if (s.length === 0)
    return false;
  return BARE_NAME_RE.test(s);
}
function quoteString(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function quoteName(s) {
  if (isBareNameSafe(s))
    return s;
  return quoteString(s);
}
function quoteStringOrPlaceholder(s) {
  if (isPlaceholderOnly(s))
    return s;
  return quoteString(s);
}
function normalizeNoteForEmit(note) {
  return note.replace(/\s*\r?\n\s*/g, " ").trim();
}
function indent(level, style) {
  return style.indent.repeat(level);
}

// dist/htsl/print/arguments.js
function printOption(option) {
  if (option === void 0 || option === null)
    return "<unset>";
  return option.split(" ").join("_");
}
function printValue(value) {
  return value;
}
function printLocation(loc) {
  if (loc.type === "Custom Coordinates") {
    return `${printOption(loc.type)} ${quoteString(loc.value)}`;
  }
  return printOption(loc.type);
}
function printInventorySlot(slot) {
  if (typeof slot === "number") {
    return String(slot);
  }
  return printOption(slot);
}
function printSound(sound) {
  const named = SOUNDS.find((s) => s.path === sound);
  if (named)
    return printOption(named.name);
  return quoteString(sound);
}
function printNumericalPlaceholder(p) {
  if (isPlaceholderOnly(p))
    return p;
  return quoteString(p);
}
function printBoolean(b) {
  return b ? "true" : "false";
}
function printNumber(n) {
  return String(n);
}

// dist/htsl/print/conditions.js
function printCondition(cond) {
  const prefix = cond.inverted ? "!" : "";
  return prefix + printConditionBody(cond);
}
function printConditionBody(cond) {
  switch (cond.type) {
    case "REQUIRE_GROUP": {
      const parts = ["hasGroup"];
      if (cond.group !== void 0)
        parts.push(quoteName(cond.group));
      if (cond.includeHigherGroups !== void 0)
        parts.push(printBoolean(cond.includeHigherGroups));
      return parts.join(" ");
    }
    case "COMPARE_VAR": {
      const holder = cond.holder ?? { type: "Player" };
      const kw = holder.type === "Global" ? "globalvar" : holder.type === "Team" ? "teamvar" : "var";
      const parts = [kw];
      if (cond.var !== void 0)
        parts.push(quoteName(cond.var));
      if (holder.type === "Team") {
        parts.push(quoteName(holder.team ?? ""));
      }
      if (cond.op !== void 0)
        parts.push(COMPARISON_SYMBOLS[cond.op]);
      if (cond.amount !== void 0)
        parts.push(printValue(cond.amount));
      if (cond.fallback !== void 0)
        parts.push(printValue(cond.fallback));
      return parts.join(" ");
    }
    case "REQUIRE_PERMISSION": {
      const parts = ["hasPermission"];
      if (cond.permission !== void 0)
        parts.push(printOption(cond.permission));
      return parts.join(" ");
    }
    case "IS_IN_REGION": {
      const parts = ["inRegion"];
      if (cond.region !== void 0)
        parts.push(quoteName(cond.region));
      return parts.join(" ");
    }
    case "REQUIRE_ITEM": {
      const parts = ["hasItem"];
      if (cond.itemName !== void 0)
        parts.push(quoteName(cond.itemName));
      if (cond.whatToCheck !== void 0)
        parts.push(printOption(cond.whatToCheck));
      if (cond.whereToCheck !== void 0)
        parts.push(printOption(cond.whereToCheck));
      if (cond.amount !== void 0)
        parts.push(printOption(cond.amount));
      return parts.join(" ");
    }
    case "IS_DOING_PARKOUR":
      return "doingParkour";
    case "REQUIRE_POTION_EFFECT": {
      const parts = ["hasPotion"];
      if (cond.effect !== void 0)
        parts.push(printOption(cond.effect));
      return parts.join(" ");
    }
    case "IS_SNEAKING":
      return "isSneaking";
    case "IS_FLYING":
      return "isFlying";
    case "COMPARE_HEALTH": {
      const parts = ["health"];
      if (cond.op !== void 0)
        parts.push(COMPARISON_SYMBOLS[cond.op]);
      if (cond.amount !== void 0)
        parts.push(printValue(cond.amount));
      return parts.join(" ");
    }
    case "COMPARE_MAX_HEALTH": {
      const parts = ["maxHealth"];
      if (cond.op !== void 0)
        parts.push(COMPARISON_SYMBOLS[cond.op]);
      if (cond.amount !== void 0)
        parts.push(printValue(cond.amount));
      return parts.join(" ");
    }
    case "COMPARE_HUNGER": {
      const parts = ["hunger"];
      if (cond.op !== void 0)
        parts.push(COMPARISON_SYMBOLS[cond.op]);
      if (cond.amount !== void 0)
        parts.push(printValue(cond.amount));
      return parts.join(" ");
    }
    case "REQUIRE_GAMEMODE": {
      const parts = ["gamemode"];
      if (cond.gamemode !== void 0)
        parts.push(printOption(cond.gamemode));
      return parts.join(" ");
    }
    case "COMPARE_PLACEHOLDER": {
      const parts = ["placeholder"];
      if (cond.placeholder !== void 0)
        parts.push(printNumericalPlaceholder(cond.placeholder));
      if (cond.op !== void 0)
        parts.push(COMPARISON_SYMBOLS[cond.op]);
      if (cond.amount !== void 0)
        parts.push(printValue(cond.amount));
      if (cond.fallback !== void 0)
        parts.push(printValue(cond.fallback));
      return parts.join(" ");
    }
    case "REQUIRE_TEAM": {
      const parts = ["hasTeam"];
      if (cond.team !== void 0)
        parts.push(quoteName(cond.team));
      return parts.join(" ");
    }
    case "DAMAGE_CAUSE": {
      const parts = ["damageCause"];
      if (cond.cause !== void 0)
        parts.push(printOption(cond.cause));
      return parts.join(" ");
    }
    case "PVP_ENABLED":
      return "canPvp";
    case "FISHING_ENVIRONMENT": {
      const parts = ["fishingEnv"];
      if (cond.environment !== void 0)
        parts.push(printOption(cond.environment));
      return parts.join(" ");
    }
    case "PORTAL_TYPE": {
      const parts = ["portal"];
      if (cond.portalType !== void 0)
        parts.push(printOption(cond.portalType));
      return parts.join(" ");
    }
    case "BLOCK_TYPE": {
      const parts = ["blockType"];
      if (cond.itemName !== void 0)
        parts.push(quoteName(cond.itemName));
      return parts.join(" ");
    }
    case "IS_ITEM": {
      const parts = ["isItem"];
      if (cond.itemName !== void 0)
        parts.push(quoteName(cond.itemName));
      return parts.join(" ");
    }
    case "COMPARE_DAMAGE": {
      const parts = ["damageAmount"];
      if (cond.op !== void 0)
        parts.push(COMPARISON_SYMBOLS[cond.op]);
      if (cond.amount !== void 0)
        parts.push(printValue(cond.amount));
      return parts.join(" ");
    }
    default: {
      const _exhaustive = cond;
      void _exhaustive;
      throw new Error(`printCondition: unhandled condition type ${cond.type}`);
    }
  }
}

// dist/htsl/print/actions.js
var ITEM_PLACEHOLDER = "<item-not-supported>";
function printActionList(actions, depth, ctx) {
  let out = "";
  for (const action of actions) {
    out += printActionAt(action, depth, ctx);
  }
  return out;
}
function printActionAt(action, depth, ctx) {
  const pad = indent(depth, ctx.style);
  const eol = ctx.style.lineEnding;
  let out = "";
  if (action.note !== void 0 && action.note.length > 0) {
    const note = normalizeNoteForEmit(action.note);
    if (note.length > 0) {
      out += `${pad}/// ${note}${eol}`;
    }
  }
  out += pad + printActionHead(action, depth, ctx) + eol;
  return out;
}
function printActionHead(action, depth, ctx) {
  switch (action.type) {
    case "ACTION_BAR":
      return `actionBar ${quoteStringOrPlaceholder(action.message)}`;
    case "APPLY_INVENTORY_LAYOUT":
      return `applyLayout ${quoteStringOrPlaceholder(action.layout)}`;
    case "APPLY_POTION_EFFECT": {
      const parts = [
        "applyPotion",
        printOption(action.effect),
        printNumber(action.duration)
      ];
      if (action.level !== void 0 || action.override !== void 0 || action.showIcon !== void 0) {
        parts.push(printNumber(action.level ?? 1));
        parts.push(printBoolean(action.override ?? false));
        if (action.showIcon !== void 0) {
          parts.push(printBoolean(action.showIcon));
        }
      }
      return parts.join(" ");
    }
    case "CANCEL_EVENT":
      return "cancelEvent";
    case "CHANGE_HEALTH":
      return `changeHealth ${printOption(action.op)} ${printValue(action.amount)}`;
    case "CHANGE_HUNGER":
      return `hungerLevel ${printOption(action.op)} ${printValue(action.amount)}`;
    case "CHANGE_MAX_HEALTH":
      return `maxHealth ${printOption(action.op)} ${printValue(action.amount)}`;
    case "CHANGE_VAR":
      return printActionChangeVar(action);
    case "CLEAR_POTION_EFFECTS":
      return "clearEffects";
    case "CLOSE_MENU":
      return "closeMenu";
    case "CONDITIONAL":
      return printActionConditional(action, depth, ctx);
    case "DROP_ITEM":
      return printActionDropItem(action, ctx);
    case "ENCHANT_HELD_ITEM":
      return `enchant ${printOption(action.enchant)} ${printNumber(action.level)}`;
    case "EXIT":
      return "exit";
    case "FAIL_PARKOUR": {
      return `failParkour ${quoteStringOrPlaceholder(action.message ?? "")}`;
    }
    case "PARKOUR_CHECKPOINT":
      return "parkCheck";
    case "FUNCTION": {
      const parts = ["function", quoteName(action.function)];
      if (action.global !== void 0)
        parts.push(printBoolean(action.global));
      return parts.join(" ");
    }
    case "GIVE_EXPERIENCE_LEVELS":
      return `xpLevel ${printValue(action.amount)}`;
    case "GIVE_ITEM": {
      ctx.diagnostics.push({
        level: "warning",
        message: "GIVE_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT."
      });
      const parts = ["giveItem", quoteName(action.itemName || ITEM_PLACEHOLDER)];
      const tail = [
        action.allowMultiple !== void 0 ? printBoolean(action.allowMultiple) : void 0,
        action.slot !== void 0 ? printInventorySlot(action.slot) : void 0,
        action.replaceExisting !== void 0 ? printBoolean(action.replaceExisting) : void 0
      ];
      const lastDefined = lastIndexDefined(tail);
      for (let i = 0; i <= lastDefined; i++) {
        parts.push(tail[i] ?? defaultTailFor("giveItem", i));
      }
      return parts.join(" ");
    }
    case "HEAL":
      return "fullHeal";
    case "KILL":
      return "kill";
    case "LAUNCH":
      return `launchTarget ${printLocation(action.location)} ${printNumber(action.strength)}`;
    case "MESSAGE":
      return `chat ${quoteStringOrPlaceholder(action.message)}`;
    case "PAUSE":
      return `pause ${printNumber(action.ticks)}`;
    case "PLAY_SOUND": {
      const parts = ["sound", printSound(action.sound)];
      const tail = [
        action.volume !== void 0 ? printNumber(action.volume) : void 0,
        action.pitch !== void 0 ? printNumber(action.pitch) : void 0,
        action.location !== void 0 ? printLocation(action.location) : void 0
      ];
      const lastDefined = lastIndexDefined(tail);
      for (let i = 0; i <= lastDefined; i++) {
        if (tail[i] !== void 0) {
          parts.push(tail[i]);
        } else if (i === 2) {
          parts.push("null");
        } else {
          parts.push(defaultTailFor("sound", i));
        }
      }
      return parts.join(" ");
    }
    case "RANDOM":
      return printActionRandom(action, depth, ctx);
    case "REMOVE_ITEM": {
      ctx.diagnostics.push({
        level: "warning",
        message: "REMOVE_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT."
      });
      return `removeItem ${quoteName(action.itemName || ITEM_PLACEHOLDER)}`;
    }
    case "RESET_INVENTORY":
      return "resetInventory";
    case "SEND_TO_LOBBY": {
      const parts = ["lobby"];
      if (action.lobby !== void 0)
        parts.push(printOption(action.lobby));
      return parts.join(" ");
    }
    case "SET_COMPASS_TARGET":
      return `compassTarget ${printLocation(action.location)}`;
    case "SET_GAMEMODE":
      return `gamemode ${printOption(action.gamemode)}`;
    case "SET_GROUP": {
      const parts = ["changePlayerGroup", quoteString(action.group)];
      if (action.demotionProtection !== void 0)
        parts.push(printBoolean(action.demotionProtection));
      return parts.join(" ");
    }
    case "SET_MENU":
      return `displayMenu ${quoteName(action.menu)}`;
    case "SET_PLAYER_TIME":
      return `playerTime ${quoteString(action.time)}`;
    case "SET_PLAYER_WEATHER":
      return `playerWeather ${quoteString(action.weather)}`;
    case "SET_TEAM":
      return `setTeam ${quoteName(action.team)}`;
    case "SET_VELOCITY":
      return "changeVelocity " + [printValue(action.x), printValue(action.y), printValue(action.z)].join(" ");
    case "TELEPORT": {
      const parts = ["tp", printLocation(action.location)];
      if (action.preventTeleportInsideBlocks !== void 0)
        parts.push(printBoolean(action.preventTeleportInsideBlocks));
      return parts.join(" ");
    }
    case "TITLE":
      return printActionTitle(action);
    case "TOGGLE_NAMETAG_DISPLAY":
      return `displayNametag ${printBoolean(action.displayNametag)}`;
    case "USE_HELD_ITEM":
      return "consumeItem";
    default: {
      const _exhaustive = action;
      void _exhaustive;
      throw new Error(`printAction: unhandled action type ${action.type}`);
    }
  }
}
function lastIndexDefined(arr) {
  let last = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== void 0)
      last = i;
  }
  return last;
}
function defaultTailFor(actionKw, index) {
  if (actionKw === "giveItem") {
    if (index === 0)
      return printBoolean(false);
    if (index === 1)
      return printInventorySlot("First Available Slot");
    if (index === 2)
      return printBoolean(false);
  }
  if (actionKw === "sound") {
    if (index === 0)
      return "1";
    if (index === 1)
      return "1";
  }
  return "0";
}
function printActionChangeVar(action) {
  const holder = action.holder;
  const kw = holder.type === "Global" ? "globalvar" : holder.type === "Team" ? "teamvar" : "var";
  const parts = [kw, quoteName(action.key)];
  if (holder.type === "Team") {
    parts.push(quoteName(holder.team ?? ""));
  }
  if (action.op === "Unset") {
    parts.push("unset");
    return parts.join(" ");
  }
  parts.push(OPERATION_SYMBOLS[action.op]);
  if (action.value !== void 0)
    parts.push(printValue(action.value));
  if (action.unset !== void 0)
    parts.push(printBoolean(action.unset));
  return parts.join(" ");
}
function printActionConditional(action, depth, ctx) {
  const mode = action.matchAny ? "or " : "";
  const hasAnyNote = action.conditions.some((c) => typeof c.note === "string" && c.note.length > 0);
  let head;
  if (!hasAnyNote) {
    const conds = action.conditions.map((c) => printCondition(c)).join(", ");
    head = `if ${mode}(${conds})`;
  } else {
    const eol = ctx.style.lineEnding;
    const innerPad = indent(depth + 1, ctx.style);
    const closePad = indent(depth, ctx.style);
    const lines = [];
    for (let i = 0; i < action.conditions.length; i++) {
      const cond = action.conditions[i];
      if (typeof cond.note === "string" && cond.note.length > 0) {
        lines.push(`${innerPad}/// ${normalizeNoteForEmit(cond.note)}`);
      }
      const tail = i < action.conditions.length - 1 ? "," : "";
      lines.push(`${innerPad}${printCondition(cond)}${tail}`);
    }
    head = `if ${mode}(${eol}${lines.join(eol)}${eol}${closePad})`;
  }
  const ifBody = printBlock(action.ifActions, depth, ctx);
  let out = `${head} ${ifBody}`;
  if (action.elseActions && action.elseActions.length > 0) {
    const elseBody = printBlock(action.elseActions, depth, ctx);
    out += ` else ${elseBody}`;
  }
  return out;
}
function printActionRandom(action, depth, ctx) {
  const body = printBlock(action.actions, depth, ctx);
  return `random ${body}`;
}
function printBlock(actions, depth, ctx) {
  const eol = ctx.style.lineEnding;
  const pad = indent(depth, ctx.style);
  if (actions.length === 0)
    return "{}";
  const inner = printActionList(actions, depth + 1, ctx);
  return `{${eol}${inner}${pad}}`;
}
function printActionDropItem(action, ctx) {
  ctx.diagnostics.push({
    level: "warning",
    message: "DROP_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT."
  });
  const parts = ["dropItem", quoteName(action.itemName || ITEM_PLACEHOLDER)];
  const tail = [
    action.location !== void 0 ? printLocation(action.location) : void 0,
    action.dropNaturally !== void 0 ? printBoolean(action.dropNaturally) : void 0,
    action.disableMerging !== void 0 ? printBoolean(action.disableMerging) : void 0,
    action.prioritizePlayer !== void 0 ? printBoolean(action.prioritizePlayer) : void 0,
    action.inventoryFallback !== void 0 ? printBoolean(action.inventoryFallback) : void 0,
    action.despawnDurationTicks !== void 0 ? printValue(action.despawnDurationTicks) : void 0,
    action.pickupDelayTicks !== void 0 ? printValue(action.pickupDelayTicks) : void 0
  ];
  const lastDefined = lastIndexDefined(tail);
  for (let i = 0; i <= lastDefined; i++) {
    if (tail[i] !== void 0) {
      parts.push(tail[i]);
    } else {
      switch (i) {
        case 0:
          parts.push("null");
          break;
        case 1:
          parts.push(printBoolean(true));
          break;
        case 2:
          parts.push(printBoolean(false));
          break;
        case 3:
          parts.push(printBoolean(false));
          break;
        case 4:
          parts.push(printBoolean(false));
          break;
        case 5:
          parts.push("0");
          break;
        case 6:
          parts.push("0");
          break;
      }
    }
  }
  return parts.join(" ");
}
function printActionTitle(action) {
  const parts = ["title", quoteStringOrPlaceholder(action.title)];
  const tail = [
    action.subtitle !== void 0 ? quoteStringOrPlaceholder(action.subtitle) : void 0,
    action.fadein !== void 0 ? printNumber(action.fadein) : void 0,
    action.stay !== void 0 ? printNumber(action.stay) : void 0,
    action.fadeout !== void 0 ? printNumber(action.fadeout) : void 0
  ];
  const lastDefined = lastIndexDefined(tail);
  if (lastDefined === -1)
    return parts.join(" ");
  parts.push(tail[0] ?? quoteString(""));
  if (lastDefined >= 1) {
    parts.push(tail[1] ?? "1");
    parts.push(tail[2] ?? "5");
    parts.push(tail[3] ?? "1");
  }
  return parts.join(" ");
}

// dist/htsl/print/style.js
var DEFAULT_PRINT_STYLE = {
  indent: "    ",
  lineEnding: "\n",
  trailingNewline: true
};
function resolveStyle(partial) {
  return { ...DEFAULT_PRINT_STYLE, ...partial ?? {} };
}

// dist/htsl/print/index.js
function printActions(actions, style) {
  return printActionsWithDiagnostics(actions, style).source;
}
function printActionsWithDiagnostics(actions, style) {
  const resolved = resolveStyle(style);
  const ctx = { style: resolved, diagnostics: [] };
  let source = printActionList(actions, 0, ctx);
  if (!resolved.trailingNewline && source.endsWith(resolved.lineEnding)) {
    source = source.slice(0, source.length - resolved.lineEnding.length);
  }
  return { source, diagnostics: ctx.diagnostics };
}
function printAction(action, style) {
  return printActions([action], style);
}
function printCondition2(cond) {
  return printCondition(cond);
}

// dist/importjson/parse/index.js
var json4 = __toESM(require("jsonc-parser"), 1);

// dist/importjson/parse/actions.js
var json2 = __toESM(require("jsonc-parser"), 1);

// dist/importjson/parse/helpers.js
var json = __toESM(require("jsonc-parser"), 1);
function nodeSpan(node) {
  return new Span(node.offset, node.offset + node.length);
}
function setSpan(gcx, value, node) {
  gcx.spans.set(value, nodeSpan(node));
}
function setFieldSpan(gcx, owner, key, node) {
  gcx.spans.setField(owner, key, nodeSpan(node));
}
function parseString2(gcx, node) {
  if (node.type !== "string") {
    throw Diagnostic.error(`Expected string`).addPrimarySpan(nodeSpan(node));
  }
  return node.value;
}
function parseNumber(gcx, node) {
  if (node.type !== "number") {
    throw Diagnostic.error(`Expected number`).addPrimarySpan(nodeSpan(node));
  }
  return node.value;
}
function parseBoundedNumber(min, max) {
  return (gcx, node) => {
    const value = parseNumber(gcx, node);
    if (value < min) {
      gcx.addDiagnostic(Diagnostic.error(`Value must be greater than or equal to ${min}`).addPrimarySpan(nodeSpan(node)));
    }
    if (value > max) {
      gcx.addDiagnostic(Diagnostic.error(`Value must be less than or equal to ${max}`).addPrimarySpan(nodeSpan(node)));
    }
    return value;
  };
}
function parseArray(gcx, node, parser) {
  const res = [];
  if (node.type !== "array" || !node.children) {
    throw Diagnostic.error("Expected array").addPrimarySpan(nodeSpan(node));
  }
  for (const child of node.children) {
    try {
      const value = parser(child);
      res.push(value);
    } catch (e) {
      if (e instanceof Diagnostic) {
        gcx.addDiagnostic(e);
        continue;
      }
      throw e;
    }
  }
  return res;
}
function parseOption(gcx, node, options, errorTerms) {
  const value = parseString2(gcx, node);
  for (const option of options) {
    if (value.toLowerCase() === option.toLowerCase())
      return option;
  }
  const err = Diagnostic.error(`Expected ${errorTerms?.singular ?? "option"}`).addPrimarySpan(nodeSpan(node));
  function addHelp(message) {
    err.addSubDiagnostic(Diagnostic.help(message));
  }
  addHelp(`Valid ${errorTerms?.plural ?? "options"} are:`);
  const optionsToDisplay = Math.min(5, options.length);
  for (let i = 0; i < optionsToDisplay; i++) {
    addHelp(`  ${options[i]}`);
  }
  if (options.length > 5) {
    addHelp(`And ${options.length - 5} others`);
  }
  throw err;
}
function parseObject(gcx, node, tree) {
  if (node.type !== "object" || !node.children) {
    gcx.addDiagnostic(Diagnostic.error("Expected object").addPrimarySpan(nodeSpan(node)));
    return;
  }
  const seenKeys = /* @__PURE__ */ new Map();
  const requiredKeys = new Set(Object.entries(tree).filter(([_, elem]) => elem.required).map(([key]) => key));
  for (const child of node.children) {
    if (child.type !== "property" || !child.children || child.children.length < 2) {
      gcx.addDiagnostic(Diagnostic.error("Invalid property node").addPrimarySpan(nodeSpan(child)));
      continue;
    }
    const keyNode = child.children[0];
    const valueNode = child.children[1];
    if (keyNode.type !== "string") {
      gcx.addDiagnostic(Diagnostic.error("Property key must be a string").addPrimarySpan(nodeSpan(keyNode)));
      continue;
    }
    const key = keyNode.value;
    if (seenKeys.has(key)) {
      gcx.addDiagnostic(Diagnostic.warning(`Duplicate key '${key}'`).addPrimarySpan(nodeSpan(keyNode)));
    } else {
      seenKeys.set(key, child);
    }
    const element = tree[key];
    if (element) {
      element.parser(valueNode);
      requiredKeys.delete(key);
    } else {
      const diag = Diagnostic.error(`Unknown key '${key}'`).addPrimarySpan(nodeSpan(keyNode));
      const validKeys = Object.keys(tree);
      if (validKeys.length > 0) {
        diag.addSubDiagnostic(Diagnostic.help(`Valid keys are: ${validKeys.join(", ")}`));
      }
      gcx.addDiagnostic(diag);
    }
  }
  for (const missingKey of requiredKeys) {
    const diag = Diagnostic.error(`Missing required key '${missingKey}'`).addPrimarySpan(nodeSpan(node).endSpan());
    const validKeys = Object.keys(tree);
    if (validKeys.length > 0) {
      diag.addSubDiagnostic(Diagnostic.help(`Allowed keys here: ${validKeys.join(", ")}`));
    }
    gcx.addDiagnostic(diag);
  }
}
function parseBoolean(gcx, node) {
  if (node.type !== "boolean") {
    throw Diagnostic.error("Expected boolean").addPrimarySpan(nodeSpan(node));
  }
  return node.value;
}
function parseBounds(gcx, node) {
  const bounds = {};
  setSpan(gcx, bounds, node);
  parseObject(gcx, node, {
    "from": {
      required: true,
      parser: (child) => {
        bounds.from = parsePos(gcx, child);
        setFieldSpan(gcx, bounds, "from", child);
      }
    },
    "to": {
      required: true,
      parser: (child) => {
        bounds.to = parsePos(gcx, child);
        setFieldSpan(gcx, bounds, "to", child);
      }
    }
  });
  return bounds;
}
function parsePos(gcx, node) {
  const pos = {};
  setSpan(gcx, pos, node);
  parseObject(gcx, node, {
    "x": {
      required: true,
      parser: (child) => {
        pos.x = parseNumber(gcx, child);
        setFieldSpan(gcx, pos, "x", child);
      }
    },
    "y": {
      required: true,
      parser: (child) => {
        pos.y = parseNumber(gcx, child);
        setFieldSpan(gcx, pos, "y", child);
      }
    },
    "z": {
      required: true,
      parser: (child) => {
        pos.z = parseNumber(gcx, child);
        setFieldSpan(gcx, pos, "z", child);
      }
    }
  });
  return pos;
}

// dist/importjson/parse/actions.js
function parseActions(gcx, node) {
  return parseActionsWithPath(gcx, node).actions;
}
function parseActionsWithPath(gcx, node) {
  const path2 = parseString2(gcx, node);
  if (!path2.endsWith(".htsl")) {
    throw Diagnostic.error("Expected HTSL file").addPrimarySpan(nodeSpan(node), "Invalid extension");
  }
  if (!gcx.fileExists(path2)) {
    throw Diagnostic.error("HTSL file does not exist").addPrimarySpan(nodeSpan(node), "Not found");
  }
  const resolvedPath = gcx.resolvePath(path2);
  return { actions: parseHtsl(gcx, resolvedPath), resolvedPath };
}

// dist/importjson/parse/nbt.js
var json3 = __toESM(require("jsonc-parser"), 1);
function parseNbt(gcx, node) {
  const filePath = parseString2(gcx, node);
  if (!filePath.endsWith(".snbt")) {
    throw Diagnostic.error("Expected SNBT file").addPrimarySpan(nodeSpan(node), "Invalid extension");
  }
  if (!gcx.fileExists(filePath)) {
    throw Diagnostic.error("SNBT file does not exist").addPrimarySpan(nodeSpan(node), "Not found");
  }
  const resolvedPath = gcx.resolvePath(filePath);
  const tag = parseSnbt(gcx, resolvedPath);
  if (tag === void 0) {
    if (!gcx.isFailed())
      throw Error("This should NEVER happen");
    return { "type": "compound", "value": {} };
  }
  return tag;
}

// dist/importjson/parse/index.js
var NPC_SKINS = ["Steve", "Alex", "Players Skin"];
function parseImportJson(gcx, path2, origin) {
  const resolvedPath = resolveImportJsonPath(gcx, path2);
  if (!prepareImportJsonParsing(gcx, resolvedPath, origin))
    return;
  gcx.activeImportJsonPaths.push(resolvedPath);
  try {
    const file = gcx.sourceMap.getFile(resolvedPath);
    const tree = json4.parseTree(file.src);
    if (!tree) {
      gcx.addDiagnostic(Diagnostic.error(`Couldn't parse file '${resolvedPath}'`));
      return;
    }
    parseImportJsonObject(gcx, tree, resolvedPath);
    gcx.loadedImportJsonPaths.add(resolvedPath);
  } catch (e) {
    if (e instanceof Diagnostic) {
      gcx.addDiagnostic(e);
    } else if (e instanceof Error) {
      gcx.addDiagnostic(Diagnostic.bugFromError(e));
    } else {
      gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${resolvedPath}`));
    }
  } finally {
    if (gcx.activeImportJsonPaths[gcx.activeImportJsonPaths.length - 1] === resolvedPath) {
      gcx.activeImportJsonPaths.pop();
    } else {
      const index = gcx.activeImportJsonPaths.indexOf(resolvedPath);
      if (index !== -1)
        gcx.activeImportJsonPaths.splice(index, 1);
    }
  }
}
function parseImportJsonObject(gcx, node, currentPath) {
  const seenIncludes = /* @__PURE__ */ new Set();
  parseObject(gcx, node, {
    "include": {
      required: false,
      parser: (includeNode) => parseIncludes(gcx, includeNode, currentPath, seenIncludes)
    },
    "functions": {
      required: false,
      parser: (functionsNode) => parseAndAppendImportables(gcx, functionsNode, currentPath, parseImportableFunction)
    },
    "events": {
      required: false,
      parser: (eventsNode) => parseAndAppendImportables(gcx, eventsNode, currentPath, parseImportableEvent)
    },
    "regions": {
      required: false,
      parser: (regionsNode) => parseAndAppendImportables(gcx, regionsNode, currentPath, parseImportableRegion)
    },
    "items": {
      required: false,
      parser: (itemsNode) => parseAndAppendImportables(gcx, itemsNode, currentPath, parseImportableItem)
    },
    "npcs": {
      required: false,
      parser: (npcsNode) => parseAndAppendImportables(gcx, npcsNode, currentPath, parseImportableNpc)
    },
    "menus": {
      required: false,
      parser: (menusNode) => parseAndAppendImportables(gcx, menusNode, currentPath, parseImportableMenu)
    }
  });
}
function parseIncludes(gcx, node, currentPath, seenIncludes) {
  parseArray(gcx, node, (child) => {
    const includePath = parseString2(gcx, child);
    if (!isImportJsonPath(includePath)) {
      const diag = Diagnostic.error("Expected include path to an import.json file").addPrimarySpan(nodeSpan(child), includePath);
      diag.addSubDiagnostic(Diagnostic.help("Include paths must end with 'import.json' or '.import.json'"));
      gcx.addDiagnostic(diag);
      return;
    }
    const resolvedIncludePath = resolveRelativeImportJsonPath(gcx, currentPath, includePath);
    if (seenIncludes.has(resolvedIncludePath)) {
      gcx.addDiagnostic(Diagnostic.warning(`Duplicate include path '${includePath}'`).addPrimarySpan(nodeSpan(child), `resolves to '${resolvedIncludePath}'`));
      return;
    }
    seenIncludes.add(resolvedIncludePath);
    parseImportJson(gcx.subContext(resolvedIncludePath), resolvedIncludePath, {
      includeNode: child,
      includePath,
      fromPath: currentPath
    });
  });
}
function parseAndAppendImportables(gcx, node, declaringPath, parser) {
  gcx.importables.push(...parseArray(gcx, node, (elementNode) => parser(gcx, elementNode, declaringPath)));
}
function prepareImportJsonParsing(gcx, resolvedPath, origin) {
  if (gcx.activeImportJsonPaths.includes(resolvedPath)) {
    const cyclePath = [...gcx.activeImportJsonPaths, resolvedPath].join(" -> ");
    const diag = Diagnostic.error("Circular import.json include").addSubDiagnostic(Diagnostic.note(cyclePath));
    if (origin) {
      diag.addPrimarySpan(nodeSpan(origin.includeNode), `include '${origin.includePath}' resolves to '${resolvedPath}'`);
      diag.addSubDiagnostic(Diagnostic.note(`included from '${origin.fromPath}'`));
    }
    gcx.addDiagnostic(diag);
    return false;
  }
  if (gcx.loadedImportJsonPaths.has(resolvedPath))
    return false;
  if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
    const diag = origin ? Diagnostic.error(`Included import.json not found: '${origin.includePath}'`).addPrimarySpan(nodeSpan(origin.includeNode), `resolved to '${resolvedPath}'`).addSubDiagnostic(Diagnostic.note(`included from '${origin.fromPath}'`)) : Diagnostic.error(`import.json file does not exist '${resolvedPath}'`);
    diag.addSubDiagnostic(Diagnostic.help("Check the include path and verify the target file exists"));
    gcx.addDiagnostic(diag);
    return false;
  }
  return true;
}
function isImportJsonPath(path2) {
  const normalizedPath = path2.toLowerCase();
  return normalizedPath.endsWith("import.json") || normalizedPath.endsWith(".import.json");
}
function resolveRelativeImportJsonPath(gcx, currentPath, includePath) {
  const parentPath = gcx.sourceMap.fileLoader.getParentPath(currentPath);
  return gcx.sourceMap.fileLoader.resolvePath(parentPath, includePath);
}
function resolveImportJsonPath(gcx, path2) {
  if (gcx.sourceMap.fileLoader.fileExists(path2)) {
    return path2;
  }
  return gcx.resolvePath(path2);
}
function parseImportableFunction(gcx, node, declaringPath) {
  const importable = { type: "FUNCTION" };
  setSpan(gcx, importable, node);
  setFieldSpan(gcx, importable, "type", node);
  gcx.sourceFiles.set(importable, declaringPath);
  parseObject(gcx, node, {
    "name": {
      required: true,
      parser: (child) => {
        importable.name = parseString2(gcx, child);
        setFieldSpan(gcx, importable, "name", child);
      }
    },
    "actions": {
      required: true,
      parser: (child) => {
        const parsed = parseActionsWithPath(gcx, child);
        importable.actions = parsed.actions;
        gcx.sourceFiles.set(importable, parsed.resolvedPath);
        setFieldSpan(gcx, importable, "actions", child);
      }
    },
    "repeatTicks": {
      required: false,
      parser: (child) => {
        importable.repeatTicks = parseBoundedNumber(4, 18e3)(gcx, child);
        setFieldSpan(gcx, importable, "repeatTicks", child);
      }
    },
    "icon": {
      required: false,
      parser: (child) => {
        importable.icon = parseFunctionIcon(gcx, child);
        setFieldSpan(gcx, importable, "icon", child);
      }
    }
  });
  return importable;
}
function parseFunctionIcon(gcx, node) {
  const icon = {};
  setSpan(gcx, icon, node);
  parseObject(gcx, node, {
    "item": {
      required: true,
      parser: (child) => {
        icon.item = parseMinecraftItemId(gcx, child);
        setFieldSpan(gcx, icon, "item", child);
      }
    },
    "count": {
      required: false,
      parser: (child) => {
        const count = parseBoundedNumber(1, 64)(gcx, child);
        if (!Number.isInteger(count)) {
          gcx.addDiagnostic(Diagnostic.error("Item count must be an integer").addPrimarySpan(nodeSpan(child)));
        }
        icon.count = count;
        setFieldSpan(gcx, icon, "count", child);
      }
    }
  });
  return icon;
}
function parseMinecraftItemId(gcx, node) {
  const raw = parseString2(gcx, node);
  const normalized = raw.toLowerCase();
  const itemName = normalized.startsWith("minecraft:") ? normalized.slice("minecraft:".length) : normalized;
  const match = MINECRAFT_ITEMS.find((item) => item.name === itemName);
  if (match === void 0) {
    gcx.addDiagnostic(Diagnostic.error(`Invalid item id '${raw}'`).addPrimarySpan(nodeSpan(node)));
    return normalized;
  }
  return `minecraft:${match.name}`;
}
function parseImportableEvent(gcx, node, declaringPath) {
  const importable = { type: "EVENT" };
  setSpan(gcx, importable, node);
  setFieldSpan(gcx, importable, "type", node);
  gcx.sourceFiles.set(importable, declaringPath);
  parseObject(gcx, node, {
    "event": {
      required: true,
      parser: (child) => {
        importable.event = parseOption(gcx, child, EVENTS, { singular: "event", plural: "events" });
        setFieldSpan(gcx, importable, "event", child);
      }
    },
    "actions": {
      required: true,
      parser: (child) => {
        const parsed = parseActionsWithPath(gcx, child);
        importable.actions = parsed.actions;
        gcx.sourceFiles.set(importable, parsed.resolvedPath);
        setFieldSpan(gcx, importable, "actions", child);
      }
    }
  });
  return importable;
}
function parseImportableRegion(gcx, node, declaringPath) {
  const importable = { type: "REGION" };
  setSpan(gcx, importable, node);
  setFieldSpan(gcx, importable, "type", node);
  gcx.sourceFiles.set(importable, declaringPath);
  parseObject(gcx, node, {
    "name": {
      required: true,
      parser: (child) => {
        importable.name = parseString2(gcx, child);
        setFieldSpan(gcx, importable, "name", child);
      }
    },
    "bounds": {
      required: false,
      parser: (child) => {
        importable.bounds = parseBounds(gcx, child);
        setFieldSpan(gcx, importable, "bounds", child);
      }
    },
    "onEnterActions": {
      required: false,
      parser: (child) => {
        importable.onEnterActions = parseActions(gcx, child);
        setFieldSpan(gcx, importable, "onEnterActions", child);
      }
    },
    "onExitActions": {
      required: false,
      parser: (child) => {
        importable.onExitActions = parseActions(gcx, child);
        setFieldSpan(gcx, importable, "onExitActions", child);
      }
    }
  });
  return importable;
}
function parseImportableNpc(gcx, node, declaringPath) {
  const importable = { type: "NPC" };
  setSpan(gcx, importable, node);
  setFieldSpan(gcx, importable, "type", node);
  gcx.sourceFiles.set(importable, declaringPath);
  parseObject(gcx, node, {
    "name": {
      required: true,
      parser: (child) => {
        importable.name = parseString2(gcx, child);
        setFieldSpan(gcx, importable, "name", child);
      }
    },
    "pos": {
      required: true,
      parser: (child) => {
        importable.pos = parsePos(gcx, child);
        setFieldSpan(gcx, importable, "pos", child);
      }
    },
    "leftClickActions": {
      required: false,
      parser: (child) => {
        importable.leftClickActions = parseActions(gcx, child);
        setFieldSpan(gcx, importable, "leftClickActions", child);
      }
    },
    "rightClickActions": {
      required: false,
      parser: (child) => {
        importable.rightClickActions = parseActions(gcx, child);
        setFieldSpan(gcx, importable, "rightClickActions", child);
      }
    },
    "lookAtPlayers": {
      required: false,
      parser: (child) => {
        importable.lookAtPlayers = parseBoolean(gcx, child);
        setFieldSpan(gcx, importable, "lookAtPlayers", child);
      }
    },
    "hideNameTag": {
      required: false,
      parser: (child) => {
        importable.hideNameTag = parseBoolean(gcx, child);
        setFieldSpan(gcx, importable, "hideNameTag", child);
      }
    },
    "skin": {
      required: false,
      parser: (child) => {
        importable.skin = parseOption(gcx, child, NPC_SKINS, { singular: "skin", plural: "skins" });
        setFieldSpan(gcx, importable, "skin", child);
      }
    },
    "equipment": {
      required: false,
      parser: (child) => {
        importable.equipment = parseNpcEquipment(gcx, child);
        setFieldSpan(gcx, importable, "equipment", child);
      }
    }
  });
  return importable;
}
function parseNpcEquipment(gcx, node) {
  const equipment = {};
  setSpan(gcx, equipment, node);
  parseObject(gcx, node, {
    "helmet": {
      required: false,
      parser: (child) => {
        equipment.helmet = parseString2(gcx, child);
        setFieldSpan(gcx, equipment, "helmet", child);
      }
    },
    "chestplate": {
      required: false,
      parser: (child) => {
        equipment.chestplate = parseString2(gcx, child);
        setFieldSpan(gcx, equipment, "chestplate", child);
      }
    },
    "leggings": {
      required: false,
      parser: (child) => {
        equipment.leggings = parseString2(gcx, child);
        setFieldSpan(gcx, equipment, "leggings", child);
      }
    },
    "boots": {
      required: false,
      parser: (child) => {
        equipment.boots = parseString2(gcx, child);
        setFieldSpan(gcx, equipment, "boots", child);
      }
    },
    "hand": {
      required: false,
      parser: (child) => {
        equipment.hand = parseString2(gcx, child);
        setFieldSpan(gcx, equipment, "hand", child);
      }
    }
  });
  return equipment;
}
function parseImportableItem(gcx, node, declaringPath) {
  const importable = { type: "ITEM" };
  setSpan(gcx, importable, node);
  setFieldSpan(gcx, importable, "type", node);
  gcx.sourceFiles.set(importable, declaringPath);
  parseObject(gcx, node, {
    "name": {
      required: true,
      parser: (child) => {
        importable.name = parseString2(gcx, child);
        setFieldSpan(gcx, importable, "name", child);
      }
    },
    "nbt": {
      required: true,
      parser: (child) => {
        importable.nbt = parseNbt(gcx, child);
        setFieldSpan(gcx, importable, "nbt", child);
      }
    },
    "leftClickActions": {
      required: false,
      parser: (child) => {
        importable.leftClickActions = parseActions(gcx, child);
        setFieldSpan(gcx, importable, "leftClickActions", child);
      }
    },
    "rightClickActions": {
      required: false,
      parser: (child) => {
        importable.rightClickActions = parseActions(gcx, child);
        setFieldSpan(gcx, importable, "rightClickActions", child);
      }
    }
  });
  return importable;
}
function parseImportableMenu(gcx, node, declaringPath) {
  const importable = { type: "MENU", slots: [] };
  setSpan(gcx, importable, node);
  setFieldSpan(gcx, importable, "type", node);
  gcx.sourceFiles.set(importable, declaringPath);
  parseObject(gcx, node, {
    "name": {
      required: true,
      parser: (child) => {
        importable.name = parseString2(gcx, child);
        setFieldSpan(gcx, importable, "name", child);
      }
    },
    "size": {
      required: false,
      parser: (child) => {
        const size = parseBoundedNumber(1, 6)(gcx, child);
        if (!Number.isInteger(size)) {
          gcx.addDiagnostic(Diagnostic.error("Menu size (in lines) must be an integer").addPrimarySpan(nodeSpan(child)));
        }
        importable.size = size;
        setFieldSpan(gcx, importable, "size", child);
      }
    },
    "slots": {
      required: true,
      parser: (child) => {
        importable.slots = parseArray(gcx, child, (slotNode) => parseMenuSlot(gcx, slotNode));
        setFieldSpan(gcx, importable, "slots", child);
      }
    }
  });
  return importable;
}
function parseMenuSlot(gcx, node) {
  const slot = {};
  setSpan(gcx, slot, node);
  parseObject(gcx, node, {
    "slot": {
      required: true,
      parser: (child) => {
        const slotIndex = parseBoundedNumber(0, 53)(gcx, child);
        if (!Number.isInteger(slotIndex)) {
          gcx.addDiagnostic(Diagnostic.error("Menu slot index must be an integer").addPrimarySpan(nodeSpan(child)));
        }
        slot.slot = slotIndex;
        setFieldSpan(gcx, slot, "slot", child);
      }
    },
    "nbt": {
      required: true,
      parser: (child) => {
        slot.nbt = parseNbt(gcx, child);
        setFieldSpan(gcx, slot, "nbt", child);
      }
    },
    "actions": {
      required: false,
      parser: (child) => {
        slot.actions = parseActions(gcx, child);
        setFieldSpan(gcx, slot, "actions", child);
      }
    }
  });
  return slot;
}

// dist/sourceMap.js
var SourceFile = class {
  path;
  src;
  startPos;
  constructor(path2, src) {
    this.path = path2;
    this.src = src;
    this.startPos = 0;
  }
  getPosition(pos) {
    const index = pos - this.startPos;
    if (index < 0 || index > this.src.length) {
      return { line: 1, column: 1 };
    }
    let line = 1;
    let lastLineBreak = -1;
    for (let i = 0; i < index; i++) {
      if (this.src.charAt(i) === "\n") {
        line++;
        lastLineBreak = i;
      }
    }
    const column = index - lastLineBreak;
    return { line, column };
  }
  getLine(lineNumber) {
    if (lineNumber < 1)
      return "";
    let currentLine = 1;
    let start = 0;
    for (let i = 0; i < this.src.length; i++) {
      if (this.src.charAt(i) === "\n") {
        if (currentLine === lineNumber) {
          return this.src.slice(start, i);
        }
        currentLine++;
        start = i + 1;
      }
    }
    if (currentLine === lineNumber) {
      return this.src.slice(start);
    }
    return "";
  }
  getLineStartPos(lineNumber) {
    if (lineNumber < 1)
      return 0;
    let currentLine = 1;
    let start = 0;
    for (let i = 0; i < this.src.length; i++) {
      if (this.src.charAt(i) === "\n") {
        if (currentLine === lineNumber) {
          return start + this.startPos;
        }
        currentLine++;
        start = i + 1;
      }
    }
    if (currentLine === lineNumber) {
      return start + this.startPos;
    }
    throw new Error("Position out of bounds");
  }
  endPos() {
    return this.startPos + this.src.length;
  }
};
var SourceMap = class {
  fileLoader;
  sourceFiles;
  constructor(fileLoader) {
    this.fileLoader = fileLoader;
    this.sourceFiles = [];
  }
  loadFile(path2) {
    if (!this.fileLoader.fileExists(path2)) {
      throw Error("Source file location does not exist");
    }
    let src;
    try {
      src = this.fileLoader.readFile(path2);
    } catch (e) {
      throw Diagnostic.error(`Failed to read file '${path2}'`);
    }
    const file = new SourceFile(path2, src);
    this.registerFile(file);
    return file;
  }
  registerFile(file) {
    if (this.sourceFiles.length > 0) {
      const last = this.sourceFiles[this.sourceFiles.length - 1];
      file.startPos = last.endPos();
    }
    this.sourceFiles.push(file);
  }
  getFile(path2) {
    for (const file of this.sourceFiles) {
      if (file.path === path2)
        return file;
    }
    return this.loadFile(path2);
  }
  getFileByPos(pos) {
    for (const file of this.sourceFiles) {
      const start = file.startPos;
      const end = file.endPos();
      if (pos >= start && pos < end) {
        return file;
      }
    }
    throw Error(`Source position lookup out of bounds ${pos}`);
  }
};

// dist/index.js
function parseImportablesResult(sm, path2) {
  const gcx = new GlobalCtxt(sm, path2);
  gcx.htslTiming = { fileCount: 0, cacheHits: 0, fileReadMs: 0, lexParseMs: 0, typeflowMs: 0 };
  const t0 = Date.now();
  parseImportJson(gcx, path2);
  const t1 = Date.now();
  let checkMs = 0;
  if (!gcx.isFailed()) {
    check(gcx);
    checkMs = Date.now() - t1;
  }
  const ht = gcx.htslTiming;
  return {
    value: gcx.importables,
    spans: gcx.spans,
    diagnostics: gcx.diagnostics,
    gcx,
    timingMs: {
      parseMs: t1 - t0,
      checkMs,
      fileCount: ht.fileCount,
      cacheHits: ht.cacheHits,
      fileReadMs: ht.fileReadMs,
      lexParseMs: ht.lexParseMs,
      typeflowMs: ht.typeflowMs,
      importJsonMs: t1 - t0 - ht.fileReadMs - ht.lexParseMs - ht.typeflowMs
    }
  };
}

// scripts/profileParse.mjs
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var NodeFileLoader = class {
  fileExists(p) {
    return import_node_fs.default.existsSync(p);
  }
  readFile(p) {
    return import_node_fs.default.readFileSync(p, "utf8");
  }
  getParentPath(b) {
    return import_node_path.default.dirname(b);
  }
  resolvePath(b, o) {
    return import_node_path.default.resolve(b, o);
  }
};
var importJson = process.argv[2];
var N = Number(process.argv[3] ?? 40);
if (!importJson) {
  console.error("usage: node profileParse.cjs <import.json> [iterations]");
  process.exit(1);
}
parseImportablesResult(new SourceMap(new NodeFileLoader()), importJson);
var t = Date.now();
for (let i = 0; i < N; i++) {
  htsl_exports.clearHtslCache();
  parseImportablesResult(new SourceMap(new NodeFileLoader()), importJson);
}
var ms = Date.now() - t;
console.error(`${N} cold parses in ${ms}ms \u2014 ${(ms / N).toFixed(1)}ms each`);
/*! Bundled license information:

long/index.js:
  (**
   * @license
   * Copyright 2009 The Closure Library Authors
   * Copyright 2020 Daniel Wirtz / The long.js Authors.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
