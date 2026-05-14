import { Long } from "../../long";

import { Behaviors, type Behavior } from "./behaviors";
import { VarDouble, VarLong, type Var } from "../vars";

export type PlaceholderInvocation = {
    raw: string;
    type: string;
    args: string[];
};

export type PlaceholderBehavior = Behavior<PlaceholderInvocation, Var<any> | undefined>;

export class PlaceholderBehaviors extends Behaviors<PlaceholderInvocation, Var<any> | undefined> {
    static default(): PlaceholderBehaviors {
        return new PlaceholderBehaviors()
            .with("random.int", defaultBehaviorRandomWhole)
            .with("random.whole", defaultBehaviorRandomWhole)
            .with("random.decimal", defaultBehaviorRandomDecimal);
    }
}

const defaultBehaviorRandomWhole: PlaceholderBehavior = (_rt, invocation) => {
    const args = invocation.args;
    if (args.length === 0) {
        return VarLong.fromNumber(Math.floor(Math.random() * 100_000));
    }
    if (args.length !== 2) return VarLong.fromNumber(0);

    if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1])) {
        return VarLong.fromNumber(0);
    }

    const min = Long.fromString(args[0]);
    const max = Long.fromString(args[1]);
    if (max.lte(min)) {
        return VarLong.fromNumber(0);
    }

    const range = max.sub(min).add(1);
    let rand: Long;
    do {
        rand = randomLong().mod(range).add(min);
    } while (rand.lt(min) || rand.gt(max));

    return new VarLong(rand);
};

const defaultBehaviorRandomDecimal: PlaceholderBehavior = (_rt, invocation) => {
    const args = invocation.args;
    if (args.length === 0) return new VarDouble(Math.random());
    if (args.length !== 2) return new VarDouble(0);

    if (
        !(args[0].includes(".") && !isNaN(Number(args[0]))) ||
        !(args[1].includes(".") && !isNaN(Number(args[1])))
    ) {
        return new VarDouble(0);
    }

    const min = Number(args[0]);
    const max = Number(args[1]);
    if (max <= min) {
        return new VarDouble(0);
    }

    return new VarDouble(Math.random() * (max - min) + min);
};

function randomLong(): Long {
    const lo = Math.floor(Math.random() * 0x100000000);
    const hi = Math.floor(Math.random() * 0x100000000);
    return Long.fromBits(lo, hi);
}
