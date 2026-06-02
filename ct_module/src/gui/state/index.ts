/**
 * Convenience barrel over the genuinely-global GUI state modules — all
 * side-effect-free. Import from here when a file pulls several, or from the
 * specific module directly. Does NOT re-export across folders: knowledge rows
 * (`gui/knowledge/rows`) and import-session progress
 * (`gui/right-panel/import-tab/importProgress`) are owned elsewhere — import
 * those from their own modules.
 */
export * from "./paths";
export * from "./parsed";
export * from "./housing";
export * from "./trust";
export * from "./selectionSet";
export * from "./autoTrack";
export * from "./flags";
