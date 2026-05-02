export const ALL_TYPES = ["import", "script", "item"] as const;

export type ResultType = typeof ALL_TYPES[number];
export type Result = { type: ResultType; name: string };

export const TYPE_COLORS: { [k in ResultType]: number } = {
    import: 0xff67a7e8 | 0,
    script: 0xff62d26f | 0,
    item: 0xffe5bc4b | 0,
};

export const DUMMY_RESULTS: Result[] = [
    { type: "import", name: "spawn_function" },
    { type: "import", name: "lobby_event" },
    { type: "script", name: "checkpoint_handler" },
    { type: "script", name: "scoreboard_update" },
    { type: "item", name: "starter_sword" },
    { type: "item", name: "compass" },
    { type: "import", name: "main_region" },
    { type: "script", name: "weather_cycle" },
    { type: "item", name: "potion_speed" },
    { type: "item", name: "ender_pearl" },
    { type: "import", name: "death_event" },
    { type: "script", name: "respawn_logic" },
    { type: "import", name: "join_event" },
    { type: "item", name: "leather_helmet" },
    { type: "script", name: "boss_phase_1" },
    { type: "script", name: "boss_phase_2" },
    { type: "import", name: "shop_keeper" },
];

export const ACTIVE_BG = 0xff2d4d2d | 0;
export const ACTIVE_HOVER_BG = 0xff3a5d3a | 0;
export const ROW_BG = 0xff2d333d | 0;
export const ROW_HOVER_BG = 0xff3a4350 | 0;
