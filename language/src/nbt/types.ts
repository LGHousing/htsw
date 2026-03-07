import type Long from "long";

export type TagByte = { type: "byte"; value: number };
export type TagShort = { type: "short"; value: number };
export type TagInt = { type: "int"; value: number };
export type TagLong = { type: "long"; value: Long };
export type TagFloat = { type: "float"; value: number };
export type TagDouble = { type: "double"; value: number };
export type TagString = { type: "string"; value: string };
export type TagList = { type: "list", value: { type: Tag["type"]; value: Tag["value"][]; }; };
export type TagCompound = { type: "compound"; value: Record<string, Tag | undefined> };
export type TagByteArray = { type: "byte_array"; value: number[] };
export type TagShortArray = { type: "short_array"; value: number[] };
export type TagIntArray = { type: "int_array"; value: number[] };
export type TagLongArray = { type: "long_array"; value: Long[] };

export type Tag =
    | TagByte
    | TagShort
    | TagInt
    | TagLong
    | TagFloat
    | TagDouble
    | TagString
    | TagList
    | TagCompound
    | TagByteArray
    | TagShortArray
    | TagIntArray
    | TagLongArray;
