/** Stable failure marker consumed by the import engine's retry policy. */
export class IncompleteReadError extends Error {
    constructor(detail: string) {
        super(`HTSW_INCOMPLETE_READ: ${detail}`);
        this.name = "IncompleteReadError";
    }
}
