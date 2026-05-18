/**
 * Centralized colors / sizes for the in-game GUI overlay.
 *
 * Every panel paints from these constants so a theme tweak is a one-file
 * edit. Colors are ARGB ints (`| 0` for the sign bit) since CT's
 * `Renderer.drawRect` reads them as Java ints.
 *
 * Naming convention:
 *   COLOR_<role>            — flat fills
 *   COLOR_<role>_HOVER      — hover variant
 *   COLOR_<role>_BORDER     — border accent for the same role
 *   ACCENT_<color>          — semantic accents (success/warn/danger/info)
 */

// ── Surfaces ────────────────────────────────────────────────────────────
export const COLOR_PANEL = 0xff1b1f25 | 0;            // dark slate, primary panel bg
export const COLOR_PANEL_BORDER = 0xff2c323b | 0;     // 1px panel edge
export const COLOR_PANEL_RAISED = 0xff242931 | 0;     // slightly lighter sub-panel bg
export const COLOR_DIVIDER = 0xff2c323b | 0;          // hairline rule
export const COLOR_OVERLAY_DIM = 0xc0000000 | 0;      // modal scrim

// ── Rows / list items ───────────────────────────────────────────────────
export const COLOR_ROW = 0xff242931 | 0;
export const COLOR_ROW_HOVER = 0xff303743 | 0;
export const COLOR_ROW_SELECTED = 0xff34495e | 0;
export const COLOR_ROW_SELECTED_HOVER = 0xff426280 | 0;

// ── Buttons ─────────────────────────────────────────────────────────────
export const COLOR_BUTTON = 0xff2d333d | 0;
export const COLOR_BUTTON_HOVER = 0xff3a4350 | 0;
export const COLOR_BUTTON_PRIMARY = 0xff3370c0 | 0;
export const COLOR_BUTTON_PRIMARY_HOVER = 0xff4080d8 | 0;
export const COLOR_BUTTON_DANGER = 0xff8e3838 | 0;
export const COLOR_BUTTON_DANGER_HOVER = 0xffa84444 | 0;

// ── Tabs ────────────────────────────────────────────────────────────────
export const COLOR_TAB = 0xff2c323b | 0;
export const COLOR_TAB_HOVER = 0xff3a4350 | 0;
export const COLOR_TAB_ACTIVE = 0xff3370c0 | 0;
export const COLOR_TAB_ACTIVE_HOVER = 0xff4080d8 | 0;
export const COLOR_TAB_ACCENT = 0xff67a7e8 | 0; // 1px accent bar under the active tab

// ── Inputs ──────────────────────────────────────────────────────────────
export const COLOR_INPUT_BG = 0xff15181d | 0;

// ── Text ────────────────────────────────────────────────────────────────
export const COLOR_TEXT = 0xffe5e5e5 | 0;
export const COLOR_TEXT_DIM = 0xff8a92a3 | 0;
export const COLOR_TEXT_FAINT = 0xff5c6371 | 0;

// ── Semantic accents ────────────────────────────────────────────────────
export const ACCENT_SUCCESS = 0xff5cb85c | 0;
export const ACCENT_WARN = 0xffe5bc4b | 0;
export const ACCENT_DANGER = 0xffe85c5c | 0;
export const ACCENT_INFO = 0xff67a7e8 | 0;
export const ACCENT_PURPLE = 0xffce7be0 | 0;
export const ACCENT_TEAL = 0xff7be0c0 | 0;
export const ACCENT_ORANGE = 0xffe87a4b | 0;

// ── Importer phase colors (queue-row mini bars + future overall-bar
// segmentation). Distinct hues so reading vs hydrating vs applying are
// instantly distinguishable; matched in chroma so they read as siblings.
export const PHASE_READING = ACCENT_INFO;     // blue — paginated reads
export const PHASE_HYDRATING = ACCENT_PURPLE; // purple — nested-action opens
export const PHASE_APPLYING = ACCENT_SUCCESS; // green — actual edits

// ── Sizes ───────────────────────────────────────────────────────────────
export const SIZE_TAB_H = 18;
export const SIZE_ROW_H = 18;

// ── Glyphs (Minecraft default font) ─────────────────────────────────────
// MC's font has limited unicode support; these all render in the default
// font without falling back to a missing-glyph box.
export const GLYPH_FOLDER = "▣";  // U+25A3 — squared box, used for directories
export const GLYPH_JSON = "{ }";  // import.json marker
export const GLYPH_HTSL = "▶";    // U+25B6 — play, denotes executable function
export const GLYPH_SNBT = "◆";    // U+25C6 — diamond, item/snbt
export const GLYPH_CHEVRON_DOWN = "▼";
export const GLYPH_DOT = "●";
export const GLYPH_X = "✕";
