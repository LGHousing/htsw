import { type Bounds, type Importable, type Pos } from "htsw/types";
import { Simulator } from "./simulator";

export function registerRegionTriggers(): Trigger[] {
    return [register("tick", tick)];
}

type ImportableRegion = Extract<Importable, { type: "REGION" }>;

class RegionState {
    static currentRegion: ImportableRegion | undefined;
}

function tick() {
    const pos: Pos = {
        x: Math.floor(Player.getX()),
        y: Math.floor(Player.getY()),
        z: Math.floor(Player.getZ()),
    };

    const regions: ImportableRegion[] = [];
    for (const importable of Simulator.importables) {
        if (importable.type === "REGION") regions.push(importable);
    }

    const insideRegions = regions.filter(
        (r) => r.bounds && isInsideBounds(r.bounds, pos)
    );

    let selectedRegion: ImportableRegion | undefined;
    if (insideRegions.length > 0) {
        selectedRegion = insideRegions.reduce((a, b) => {
            const volA = computeBoundsVolume(a.bounds);
            const volB = computeBoundsVolume(b.bounds);
            return volA < volB ? a : b;
        });
    }

    const prev = RegionState.currentRegion;
    const next = selectedRegion;

    if (prev !== next) {
        if (prev && prev.onExitActions) {
            Simulator.runActions(prev.onExitActions);
        }

        if (next && next.onEnterActions) {
            Simulator.runActions(next.onEnterActions);
        }

        RegionState.currentRegion = next;
    }
}

function isInsideBounds(b: Bounds, pos: Pos): boolean {
    return (
        pos.x >= Math.min(b.from.x, b.to.x) &&
        pos.x <= Math.max(b.from.x, b.to.x) &&
        pos.y >= Math.min(b.from.y, b.to.y) &&
        pos.y <= Math.max(b.from.y, b.to.y) &&
        pos.z >= Math.min(b.from.z, b.to.z) &&
        pos.z <= Math.max(b.from.z, b.to.z)
    );
}

function computeBoundsVolume(bounds: Bounds): number {
    return (
        Math.abs(bounds.to.x - bounds.from.x) *
        Math.abs(bounds.to.y - bounds.from.y) *
        Math.abs(bounds.to.z - bounds.from.z)
    );
}
