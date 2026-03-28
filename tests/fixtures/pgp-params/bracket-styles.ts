// Test fixtures for pg-promise bracket styles
// All 5 bracket styles: ${}, $(), $<>, $[], $//
import { db } from "../db";

interface Params { id: string; name: string; }

// --- All bracket styles (valid) ---

const curlyBraces = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id}", { id: "123" } as Params);
const parentheses = db.one<{ id: string }>("SELECT id FROM users WHERE id = $(id)", { id: "123" } as Params);
const angleBrackets = db.one<{ id: string }>("SELECT id FROM users WHERE id = $<id>", { id: "123" } as Params);
const squareBrackets = db.one<{ id: string }>("SELECT id FROM users WHERE id = $[id]", { id: "123" } as Params);
const slashes = db.one<{ id: string }>("SELECT id FROM users WHERE id = $/id/", { id: "123" } as Params);

// Mixed styles in same query
const mixedStyles = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id} AND name = $(name)", { id: "123", name: "test" } as Params);

// --- Missing params with different styles ---

// @expect TS006 "missing"
const missingCurly = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${missing}", { id: "123" } as Params);

// @expect TS006 "missing"
const missingAngle = db.one<{ id: string }>("SELECT id FROM users WHERE id = $<missing>", { id: "123" } as Params);

// @expect TS006 "missing"
const missingSquare = db.one<{ id: string }>("SELECT id FROM users WHERE id = $[missing]", { id: "123" } as Params);

// @expect TS006 "missing"
const missingSlash = db.one<{ id: string }>("SELECT id FROM users WHERE id = $/missing/", { id: "123" } as Params);
