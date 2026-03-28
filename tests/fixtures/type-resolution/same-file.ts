// Test fixtures for type resolution within the same file
// Ordering, namespaces, local types
import { db } from "../db";

// --- Type defined before use ---
interface UserBefore { id: string; email: string; }
const beforeUse = db.one<UserBefore>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// --- Type defined after use (should still resolve) ---
const afterUse = db.one<UserAfter>("SELECT id, email FROM users WHERE id = $1", ["123"]);
interface UserAfter { id: string; email: string; }

// --- Type alias vs interface ---
type UserType = { id: string; email: string; };
interface UserInterface { id: string; email: string; }

const withTypeAlias = db.one<UserType>("SELECT id, email FROM users WHERE id = $1", ["123"]);
const withInterface = db.one<UserInterface>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// --- Namespaced types ---
namespace Models {
    export interface User { id: string; email: string; }
    export interface Post { id: number; title: string; }
}

const namespacedUser = db.one<Models.User>("SELECT id, email FROM users WHERE id = $1", ["123"]);
const namespacedPost = db.one<Models.Post>("SELECT id, title FROM posts WHERE id = $1", [1]);

// --- Local shadowing ---
interface Email { id: string; email: string; }  // 'Email' shadows any global
const localShadow = db.one<Email>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// --- Wrong types (should error) ---

interface MissingEmail { id: string; }
// @expect TS010 "email"
const missingField = db.one<MissingEmail>("SELECT id, email FROM users WHERE id = $1", ["123"]);

interface ExtraField { id: string; email: string; extra: string; }
// @expect TS010 "extra"
const extraField = db.one<ExtraField>("SELECT id, email FROM users WHERE id = $1", ["123"]);
