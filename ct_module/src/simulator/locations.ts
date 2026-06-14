import { Diagnostic, runtime } from "htsw";
import { Runtime, Var, VarDouble, VarLong } from "htsw/runtime";
import { Coordinates, Location } from "htsw/types";

export type ResolvedLocation = {
    x: number;
    y: number;
    z: number;
    yaw: number | undefined;
    pitch: number | undefined;
};

export function resolveLocation(
    rt: Runtime, location: Location
): ResolvedLocation {
    if (location.type === "Custom Coordinates") {
        return resolveLocationCoordinates(rt, location.coordinates!);
    }

    if (location.type === "House Spawn Location") {
        const warn = Diagnostic.warning(
            "House Spawn Location cannot be used in Simulator mode"
        ).addPrimarySpan(rt.spans.get(location))
            .addSubDiagnostic(Diagnostic.note("Defaulting to Invokers Location"));

        rt.emitDiagnostic(warn);
    }

    return {
        x: Player.getX(), y: Player.getY(), z: Player.getZ(),
        yaw: Player.getYaw(), pitch: Player.getPitch(),
    }
}

// Lord forgive me
function resolveLocationCoordinates(
    rt: Runtime, coordinates: Coordinates
): ResolvedLocation {
    const coords = [coordinates.x, coordinates.y, coordinates.z];
    const coordValues = coords.map(it => it.value);
    const coordVars = coordValues.map(it => runtime.parseValue(rt, it));
    
    for (let i = 0; i < 3; i++) {
        if (coordVars[i].type === "string") {
            throw Diagnostic.error("Expected numeric value")
                .addPrimarySpan(rt.spans.getField(coords[i], "value"), "Evaluates to string");
        }
    }

    const yawPitchFields = ["yaw", "pitch"] as const;
    const yawPitchValues = [coordinates.yaw, coordinates.pitch].filter(it => it !== undefined);
    const yawPitchVars = yawPitchValues.map(it => runtime.parseValue(rt, it));

    for (let i = 0; i < yawPitchValues.length; i++) {
        if (yawPitchVars[i].type === "string") {
            throw Diagnostic.error("Expected numeric value")
                .addPrimarySpan(rt.spans.getField(coordinates, yawPitchFields[i]), "Evaluates to string");
        }
    }

    const varToNumber = (v: Var<any>): number => {
        if (v instanceof VarLong) {
            return v.value.toNumber();
        }
        if (v instanceof VarDouble) {
            return v.value;
        }
        throw Error("???");
    };
    
    const numericCoords = coordVars.map(it => varToNumber(it));

    for (let i = 0; i < 3; i++) {
        const numericCoord = numericCoords[i];
        if (numericCoord > 190) {
            throw Diagnostic.error("Value must be less than or equal to 190")
                .addPrimarySpan(rt.spans.getField(coords[i], "value"));
        }
        if (numericCoord < -190) {
            throw Diagnostic.error("Value must be greater than or equal to -190")
                .addPrimarySpan(rt.spans.getField(coords[i], "value"));
        }
    }

    const numericYawPitch = yawPitchVars.map(it => varToNumber(it));
    let numericYaw: number | undefined = numericYawPitch[0];
    let numericPitch: number | undefined = numericYawPitch[1];
    
    if (numericYaw !== undefined) {
        if (numericYaw > 360) {
            rt.emitDiagnostic(
                Diagnostic.warning("Value must be less than or equal to 360")
                    .addPrimarySpan(rt.spans.getField(coordinates, "yaw"))
                    .addSubDiagnostic(Diagnostic.note("This setting will be ignored"))
            );
            numericYaw = undefined;
        }
        else if (numericYaw < -360) {
            rt.emitDiagnostic(
                Diagnostic.warning("Value must be greater than or equal to -360")
                    .addPrimarySpan(rt.spans.getField(coordinates, "yaw"))
                    .addSubDiagnostic(Diagnostic.note("This setting will be ignored"))
            );
            numericYaw = undefined;
        }
    }

    if (numericPitch !== undefined) {
        if (numericPitch > 90) {
            rt.emitDiagnostic(
                Diagnostic.warning("Value must be less than or equal to 90")
                    .addPrimarySpan(rt.spans.getField(coordinates, "pitch"))
                    .addSubDiagnostic(Diagnostic.note("This setting will be ignored"))
            );
            numericPitch = 0;
        }
        else if (numericPitch < -90) {
            rt.emitDiagnostic(
                Diagnostic.warning("Value must be greater than or equal to -90")
                    .addPrimarySpan(rt.spans.getField(coordinates, "pitch"))
                    .addSubDiagnostic(Diagnostic.note("This setting will be ignored"))
            );
            numericPitch = 0;
        }
    }

    if (coords[0].kind === "local") {
        const { x, y, z } = localToWorld(numericCoords[0], numericCoords[1], numericCoords[2])
        return {
            x, y, z,
            yaw: numericYaw,
            pitch: numericPitch,
        };
    }

    const realCoords = [Player.getX(), Player.getY(), Player.getZ()];
    for (let i = 0; i < 3; i++) {
        if (coords[i].kind === "relative") {
            numericCoords[i] += realCoords[i];
        }
    }
    
    return {
        x: numericCoords[0],
        y: numericCoords[1],
        z: numericCoords[2],
        yaw: numericYaw,
        pitch: numericPitch,
    };
}

function localToWorld(localX: number, localY: number, localZ: number) {
    const yaw = Player.getYaw() * Math.PI / 180;
    const pitch = Player.getPitch() * Math.PI / 180;

    const left = {
        x: Math.cos(yaw),
        y: 0,
        z: Math.sin(yaw),
    };

    const forward = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y: -Math.sin(pitch),
        z: Math.cos(yaw) * Math.cos(pitch),
    };

    const up = {
        x: -Math.sin(yaw) * Math.sin(pitch),
        y: Math.cos(pitch),
        z: Math.cos(yaw) * Math.sin(pitch),
    };

    return {
        x:
            Player.getX() +
            localX * left.x +
            localY * up.x +
            localZ * forward.x,

        y:
            Player.getY() +
            localX * left.y +
            localY * up.y +
            localZ * forward.y,

        z:
            Player.getZ() +
            localX * left.z +
            localY * up.z +
            localZ * forward.z,
    };
}