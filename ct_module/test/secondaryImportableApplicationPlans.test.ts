import { describe, expect, test } from "vitest";

import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import { COST } from "../src/housingSync/progress/costs";
import {
    groupApplicationPlan,
    groupPlanApplicationUnits,
    planImportableGroup,
    type GroupImportPlan,
} from "../src/importables/groups/import";
import {
    itemApplicationPlan,
    itemPlanApplicationUnits,
    type ItemImportPlan,
} from "../src/importables/items/import";
import {
    npcApplicationPlan,
    npcPlanApplicationUnits,
    type NpcImportPlan,
} from "../src/importables/npcs/import";
import { validateSupportedNpcFields } from "../src/importables/npcs/housing";
import {
    planImportableTeam,
    teamApplicationPlan,
    teamPlanApplicationUnits,
    type TeamImportPlan,
} from "../src/importables/teams/import";

import { message } from "./utils";

function actionPlan(messageText: string) {
    return createKnownActionListPlan([message(messageText)], [], {
        sync: { trust: { trustMode: false } } as never,
    });
}

describe("secondary importable application plans", () => {
    test("NPC live import rejects equipment but accepts the other settings", () => {
        expect(() =>
            validateSupportedNpcFields({
                type: "NPC",
                name: "supported",
                pos: { x: 1, y: 2, z: 3 },
                lookAtPlayers: true,
                hideNameTag: false,
                skin: "Players Skin",
            })
        ).not.toThrow();

        expect(() =>
            validateSupportedNpcFields({
                type: "NPC",
                name: "unsupported",
                pos: { x: 1, y: 2, z: 3 },
                equipment: { helmet: "items/helmet.snbt" },
            })
        ).toThrow("NPC equipment import is not currently supported.");
    });

    test("item application keeps left and right action lists as ordered steps", () => {
        const leftPlan = actionPlan("left");
        const rightPlan = actionPlan("right");
        const plan: ItemImportPlan = {
            kind: "ITEM",
            importable: {
                type: "ITEM",
                name: "planned",
                nbt: {} as never,
                leftClickActions: leftPlan.desired,
                rightClickActions: rightPlan.desired,
            },
            housingUuid: "house",
            item: null as never,
            leftPlan,
            rightPlan,
            usesCachedInteractData: false,
        };

        const application = itemApplicationPlan(plan);

        expect(application.steps.map((step) => step.key)).toEqual([
            "placeItem",
            "openItemEditor",
            "openActionsEditor",
            "openLeftActions",
            "leftActions",
            "leaveLeftActions",
            "openRightActions",
            "rightActions",
            "captureInteractData",
            "interactDataCache",
            "cache",
        ]);
        expect(application.steps.filter((step) => step.kind === "actionList")).toEqual([
            {
                key: "leftActions",
                kind: "actionList",
                units: leftPlan.phaseUnits.applying,
            },
            {
                key: "rightActions",
                kind: "actionList",
                units: rightPlan.phaseUnits.applying,
            },
        ]);
        expect(itemPlanApplicationUnits(plan)).toBe(application.totalUnits);
    });

    test("NPC action-list openers include the click into the list", () => {
        const leftPlan = actionPlan("left");
        const rightPlan = actionPlan("right");
        const plan: NpcImportPlan = {
            kind: "NPC",
            importable: {
                type: "NPC",
                name: "planned",
                pos: { x: 1, y: 2, z: 3 },
                leftClickRedirect: true,
                lookAtPlayers: true,
                leftClickActions: leftPlan.desired,
                rightClickActions: rightPlan.desired,
            },
            liveNpc: {
                index: 0,
                name: "old",
                pos: { x: 1, y: 2, z: 3 },
            },
            nameHandled: false,
            settings: {
                lookAtPlayers: null,
                hideNameTag: null,
            },
            settingsHandled: false,
            leftClickRedirectHandled: false,
            leftPlan,
            rightPlan,
        };

        const application = npcApplicationPlan(plan);
        const openUnits =
            COST.commandInterval + COST.commandMenuWait + COST.menuClickWait * 4;

        expect(application.steps.map((step) => step.key)).toEqual([
            "rename",
            "settings",
            "openLeftActions",
            "leftClickRedirect",
            "leftActions",
            "openRightActions",
            "rightActions",
            "cache",
        ]);
        expect(
            application.steps.find((step) => step.key === "openLeftActions")?.units
        ).toBeCloseTo(openUnits);
        expect(
            application.steps.find((step) => step.key === "openRightActions")?.units
        ).toBeCloseTo(openUnits);
        expect(npcPlanApplicationUnits(plan)).toBe(application.totalUnits);
    });

    test("team plan names every outer mutation before the cache step", () => {
        const plan: TeamImportPlan = {
            kind: "TEAM",
            importable: {
                type: "TEAM",
                name: "planned",
                tag: "TAG",
                color: "Red",
                friendlyFire: true,
            },
            exists: false,
            tagHandled: false,
            colorHandled: false,
            friendlyFireHandled: false,
        };

        const application = teamApplicationPlan(plan);

        expect(application.steps.map((step) => step.key)).toEqual([
            "create",
            "openManage",
            "tag",
            "color",
            "friendlyFire",
            "cache",
        ]);
        expect(teamPlanApplicationUnits(plan)).toBe(application.totalUnits);
    });

    test("missing team does not plan omitted optional settings", () => {
        const plan = planImportableTeam({
            kind: "TEAM",
            importable: { type: "TEAM", name: "defaults" },
            settings: null,
        });

        expect(teamApplicationPlan(plan).steps.map((step) => step.key)).toEqual([
            "create",
            "openManage",
            "cache",
        ]);
    });

    test("group plan owns settings and permission-menu work before cache", () => {
        const plan: GroupImportPlan = {
            kind: "GROUP",
            importable: {
                type: "GROUP",
                name: "planned",
                tag: "TAG",
                tagShownInChat: true,
                color: "Red",
                priority: 10,
                permissions: { Build: true } as never,
                chatSpeed: "Slow 3s",
                defaultGameMode: "CREATIVE",
            },
            exists: true,
            tagHandled: false,
            tagShownInChatHandled: false,
            colorHandled: false,
            priorityHandled: false,
            permissionsHandled: false,
            chatSpeedHandled: false,
            defaultGameModeHandled: false,
            permissions: {
                permissions: { Build: false },
                chatSpeed: "Off",
                defaultGameMode: "ADVENTURE",
            },
        };

        const application = groupApplicationPlan(plan);

        expect(application.steps.map((step) => step.key)).toEqual([
            "openEdit",
            "tag",
            "tagShownInChat",
            "color",
            "priority",
            "permissions",
            "cache",
        ]);
        expect(groupPlanApplicationUnits(plan)).toBe(application.totalUnits);
    });

    test("missing group does not plan omitted optional settings", () => {
        const plan = planImportableGroup({
            kind: "GROUP",
            importable: { type: "GROUP", name: "defaults" },
            settings: null,
            permissions: null,
        });

        expect(groupApplicationPlan(plan).steps.map((step) => step.key)).toEqual([
            "create",
            "openEdit",
            "cache",
        ]);
    });
});
