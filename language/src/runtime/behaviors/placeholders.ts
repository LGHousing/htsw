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
    const minArg = args.length === 1 ? "0" : args[0];
    const maxArg = args.length === 1 ? args[0] : args[1];

    if (!/^-?\d+$/.test(minArg) || !/^-?\d+$/.test(maxArg)) {
        return VarLong.fromNumber(0);
    }

    const min = Long.fromString(minArg);
    const max = Long.fromString(maxArg);
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

    const minArg = args.length === 1 ? "0" : args[0];
    const maxArg = args.length === 1 ? args[0] : args[1];

    if (isNaN(Number(minArg)) || isNaN(Number(maxArg))) {
        return new VarDouble(0);
    }

    const min = Number(minArg);
    const max = Number(maxArg);
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
