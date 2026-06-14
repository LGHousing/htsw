// HTSL syntax highlighting for highlight.js
hljs.registerLanguage("htsl", function (hljs) {
  const KEYWORDS = {
    keyword: [
      "if", "else", "or", "and",
      "var", "globalvar", "teamvar",
      "random", "function",
    ],
    built_in: [
      "chat",
      "kill",
      "fullHeal",
      "title",
      "actionBar",
      "resetInventory",
      "maxHealth",
      "parkCheck",
      "giveItem",
      "removeItem",
      "clearEffects",
      "xpLevel",
      "tp",
      "failParkour",
      "compassTarget",
      "gamemode",
      "changeHealth",
      "hungerLevel",
      "applyLayout",
      "pause",
      "setTeam",
      "displayMenu",
      "dropItem",
      "changeVelocity",
      "launchTarget",
      "playerTime",
      "displayNametag",
      "changePlayerGroup",
    ],
    literal: ["true", "false"],
  };

  const STRING = hljs.QUOTE_STRING_MODE;

  const COMMENT = {
    scope: "comment",
    variants: [
      hljs.C_LINE_COMMENT_MODE, // //
      hljs.C_BLOCK_COMMENT_MODE, // /* */
    ],
  };

  const NUMBER = {
    scope: "number",
    match: /\b\d+(\.\d+)?\b/,
  };

  const OPERATOR = {
    scope: "operator",
    match: />>=|<<=|>>|<<|[+\-*/%&|^]=?|[><!=]=?|=/,
  };

  return {
    name: "HTSL",
    keywords: KEYWORDS,
    contains: [
      COMMENT,
      STRING,
      NUMBER,
      OPERATOR,
    ],
  };
});
