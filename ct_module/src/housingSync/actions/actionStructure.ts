import type { Action } from "htsw/types";

export type ArrayFieldNames<TObject, TItem> = TObject extends unknown
    ? {
          [K in keyof TObject]-?: NonNullable<TObject[K]> extends readonly TItem[]
              ? K
              : never;
      }[keyof TObject]
    : never;

export type ActionListFieldName<TAction extends Action> = ArrayFieldNames<
    TAction,
    Action
>;

type ContainerMember<TAction extends Action> = TAction extends unknown
    ? ActionListFieldName<TAction> extends never
        ? never
        : TAction
    : never;

type ContainerAction = ContainerMember<Action>;
export type ChildAction = Exclude<Action, ContainerAction>;

type BoundedActionMember<TAction extends Action> = TAction extends unknown
    ? {
          [K in keyof TAction]: NonNullable<TAction[K]> extends readonly Action[]
              ? ChildAction[]
              : TAction[K];
      }
    : never;

export type RootAction = BoundedActionMember<Action>;
