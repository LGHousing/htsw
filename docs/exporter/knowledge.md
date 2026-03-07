# Exporter V1 Knowledge

## Scope
- Functions only.
- Binary confidence only: `confident | unsure`.
- Sidecar persistence at `<houseRoot>/knowledge.json`.

## Schema
```ts
export type KnowledgeStatus = "confident" | "unsure";

export type FunctionKnowledge = {
  status: KnowledgeStatus;
  hash?: string;
  watermarkUpdatedAt?: string;
  lastScannedAt?: string;
  source?: "scan" | "import";
};

export type HouseKnowledge = {
  version: 1;
  updatedAt: string;
  functions: {
    status: KnowledgeStatus;
    values: Record<string, FunctionKnowledge>;
  };
};
```

## Export modes
1. `strict` (default):
- Discovers all functions from `/functions`.
- Attempts a fresh scan/export for all discovered functions.
- Updates all discovered function entries in `knowledge.json`.

2. `incremental`:
- Discovers all functions from `/functions`.
- Reuses local file path for `confident` entries when watermark hash matches stored hash.
- Scans entries that are `unsure`, missing, or mismatched.
- Mismatch downgrades to `unsure` before rescanning.

## Watermark
Note block format:
```text
[HTSW-WM:v1]
hash=<sha256-hex>
updatedAt=<iso8601>
[/HTSW-WM]
```

- Written on import for functions.
- Existing user note text is preserved.
- Parse failures are treated as malformed/missing watermark.

## Current limitation
- Full in-house function action scraping is not implemented yet in runtime.
- Export currently writes placeholder `.htsl` stubs when action scraping is unavailable and marks entries `unsure`.
