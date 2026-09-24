// Fixtures for TS004 with variable params and TS010 with `unknown` declared types
import { db } from "../db";

declare const minAge: number;
declare const emailPattern: string;
declare const maybeName: string | null;
declare const maybeAge: number | undefined;
declare const ageAsText: string;
declare const untyped: unknown;
declare const anything: any;
declare const payload: string;
declare const published: "published";
declare const draftOrArchived: "draft" | "archived";
declare const anyStatus: string;

export const numberVariable = db.one<{ id: string }>("SELECT id FROM users WHERE age > $1", [minAge]);
export const stringVariable = db.one<{ id: string }>("SELECT id FROM users WHERE email LIKE $1", [emailPattern]);
export const nullableVariable = db.one<{ id: string }>("SELECT id FROM users WHERE name = $1", [maybeName]);
export const optionalVariable = db.one<{ id: string }>("SELECT id FROM users WHERE age > $1", [maybeAge]);
export const mixedVariableAndLiteral = db.one<{ id: string }>("SELECT id FROM users WHERE age > $1 AND email LIKE $2", [minAge, "%@example.com"]);
export const anyVariable = db.one<{ id: string }>("SELECT id FROM users WHERE age > $1", [anything]);
export const stringVariableForInt = db.one<{ id: string }>("SELECT id FROM users WHERE age = $1", [ageAsText]);
export const stringForJson = db.one<{ id: number }>("SELECT id FROM type_showcase WHERE jsonb_col = $1::jsonb", [payload]);
export const literalForEnum = db.one<{ id: number }>("SELECT id FROM orders WHERE status = $1", [published]);
export const literalUnionForEnum = db.one<{ id: number }>("SELECT id FROM orders WHERE status = $1", [draftOrArchived]);
export const inlineLiteralForEnum = db.one<{ id: number }>("SELECT id FROM orders WHERE status = $1", ["draft"]);
export const stringForEnum = db.one<{ id: number }>("SELECT id FROM orders WHERE status = $1", [anyStatus]);
export const unknownVariable = db.one<{ id: string }>("SELECT id FROM users WHERE age = $1", [untyped]);

export const nullableJsonAsUnknown = db.one<{ json_col: unknown }>("SELECT json_col FROM type_showcase WHERE id = $1", [1]);
export const nullableJsonAsUnknownOrNull = db.one<{ json_col: unknown | null }>("SELECT json_col FROM type_showcase WHERE id = $1", [1]);
export const nonNullJsonAsUnknown = db.one<{ jsonb_col: unknown }>("SELECT jsonb_col FROM type_showcase WHERE id = $1", [1]);
export const nullableJsonAsObject = db.one<{ json_col: Record<string, unknown> | null }>("SELECT json_col FROM type_showcase WHERE id = $1", [1]);
