// Test fixtures for TS006: Missing parameter property
import { db } from "./db";

interface UserParams { id: string; email: string; }
interface PartialParams { id: string; }

// --- Correct ---
const correctObject = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id}", { id: "123" } as UserParams);
const multipleProps = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id} AND email = ${email}", { id: "123", email: "test@example.com" } as UserParams);

// --- Missing properties ---

// @expect TS006 "email"
const missingEmail = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id} AND email = ${email}", { id: "123" } as PartialParams);

// @expect TS006 "id"
const missingId = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id}", {} as Record<string, never>);

// @expect TS006 @expect TS006
const missingMultiple = db.one<{ id: string }>("SELECT id FROM users WHERE id = ${id} AND email = ${email} AND name = ${name}", { email: "test@example.com" });
