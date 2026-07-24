/**
 * Colors for the three import phases (reading → hydrating → applying), each an
 * alias of a theme accent. Kept next to the progress UI that consumes them
 * rather than in the global palette.
 */

import { ACCENT_INFO, ACCENT_PURPLE, ACCENT_SUCCESS } from "../../lib/theme";

export const PHASE_READING = ACCENT_INFO;
export const PHASE_HYDRATING = ACCENT_PURPLE;
export const PHASE_APPLYING = ACCENT_SUCCESS;

/**
 * Fill for an importable whose scan finished but whose real work hasn't
 * started: the reading accent at reduced alpha, so "scanned" reads as a
 * dimmer shade of the same phase.
 */
export const PHASE_SCANNED = (PHASE_READING & 0x00ffffff) | 0x66000000;
