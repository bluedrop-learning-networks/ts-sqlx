// Test fixtures for cross-file type resolution
// NOTE: Full cross-file resolution via LSP definition lookup is experimental.
// This fixture tests inline types and documents expected behavior for imported types.

import { db } from "../db";
import { User, Post, Comment } from "./shared-types";

// === TESTS FOR INLINE OBJECT TYPES (should work) ===

// Inline object type - should pass
const inlineType = db.one<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// Inline object type with extra field - should error
// @expect TS010 "extra"
const inlineTypeWrong = db.one<{ id: string; email: string; extra: number }>("SELECT id, email FROM users WHERE id = $1", ["123"]);

// === TESTS FOR IMPORTED TYPES (cross-file resolution - experimental) ===
// These document expected behavior when cross-file resolution is complete.
// Currently, types imported from other files may not resolve.

// Direct import - User has { id: string; email: string; name: string | null }
const directImport = db.one<User>("SELECT id, email, name FROM users WHERE id = $1", ["123"]);

// Type-only import - Comment has { id: number; post_id: number; user_id: string; content: string }
const typeOnlyImport = db.one<Comment>("SELECT id, post_id, user_id, content FROM comments WHERE id = $1", [1]);

// Post import
const relativeImport = db.one<Post>("SELECT id, author_id, title, body FROM posts WHERE id = $1", [1]);
