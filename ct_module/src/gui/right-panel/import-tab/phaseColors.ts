/**
 * Colors for the three import phases (reading → hydrating → applying), each an
 * alias of a theme accent. Kept next to the progress UI that consumes them
 * rather than in the global palette.
 */

import { ACCENT_INFO, ACCENT_PURPLE, ACCENT_SUCCESS } from "../../lib/theme";

export const PHASE_READING = ACCENT_INFO;
export const PHASE_HYDRATING = ACCENT_PURPLE;
export const PHASE_APPLYING = ACCENT_SUCCESS;

export const PHASE_SCANNING = (PHASE_READING & 0x00ffffff) | 0x66000000;
export const PHASE_HYDRATION_QUEUED =
    (PHASE_HYDRATING & 0x00ffffff) | 0x66000000;
