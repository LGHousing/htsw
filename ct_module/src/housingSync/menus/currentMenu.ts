import type TaskContext from "../../tasks/context";

// "Am I already at menu X?" by title, so a list/browser opener can skip its
// `/hmenu` -> submenu walk when we're already sitting there (e.g. the list
// phase just left us in it). A Housing paginated menu prefixes its title with
// "(page/total) " — e.g. "(2/3) NPCs" — so strip that before comparing: the
// page-turn navigation reads the live page from the title and self-corrects
// from whatever page a skipped re-open leaves us on.
export function baseMenuTitle(title: string): string {
    return title.replace(/^\(\d+\/\d+\)\s+/, "").trim();
}

export function isAtMenuTitle(ctx: TaskContext, expectedTitle: string): boolean {
    const title = ctx.getOpenContainerTitle();
    if (title === null) return false;
    return baseMenuTitle(title) === expectedTitle;
}
