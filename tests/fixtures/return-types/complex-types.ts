// Test fixtures for return type inference: complex types
// Arrays, enums, composites
import { db } from "../db";

// --- Array types ---

interface CorrectIntArray { int_array: number[]; }
const intArrayCorrect = db.one<CorrectIntArray>("SELECT int_array FROM type_showcase WHERE id = $1", [1]);

interface CorrectTextArray { text_array: string[]; }
const textArrayCorrect = db.one<CorrectTextArray>("SELECT text_array FROM type_showcase WHERE id = $1", [1]);

interface CorrectTags { tags: string[]; }
const tagsCorrect = db.one<CorrectTags>("SELECT tags FROM posts WHERE id = $1", [1]);

// @expect TS010 "int_array"
interface WrongIntArray { int_array: string[]; }  // Should be number[]
const intArrayWrong = db.one<WrongIntArray>("SELECT int_array FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "text_array"
interface WrongTextArray { text_array: number[]; }  // Should be string[]
const textArrayWrong = db.one<WrongTextArray>("SELECT text_array FROM type_showcase WHERE id = $1", [1]);

// --- Enum types ---

type StatusEnum = 'draft' | 'published' | 'archived';
interface CorrectEnum { status: StatusEnum; }
const enumCorrect = db.one<CorrectEnum>("SELECT status FROM type_showcase WHERE id = $1", [1]);

// Enum as string (acceptable)
interface EnumAsString { status: string; }
const enumString = db.one<EnumAsString>("SELECT status FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "status"
interface WrongEnum { status: number; }  // Should be string
const enumWrong = db.one<WrongEnum>("SELECT status FROM type_showcase WHERE id = $1", [1]);

// --- Composite types ---

interface Address { street: string; city: string; zip: string; }
interface CorrectComposite { address: Address; }
const compositeCorrect = db.one<CorrectComposite>("SELECT address FROM type_showcase WHERE id = $1", [1]);

// Composite as unknown (acceptable)
interface CompositeAsUnknown { address: unknown; }
const compositeUnknown = db.one<CompositeAsUnknown>("SELECT address FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "address"
interface WrongComposite { address: string; }  // Should be object
const compositeWrong = db.one<WrongComposite>("SELECT address FROM type_showcase WHERE id = $1", [1]);

// --- Network types ---

interface CorrectNetwork { inet_col: string; cidr_col: string; macaddr_col: string; }
const networkCorrect = db.one<CorrectNetwork>("SELECT inet_col, cidr_col, macaddr_col FROM type_showcase WHERE id = $1", [1]);

// --- Full-text search ---

interface CorrectTsVector { search_vector: string; }
const tsvectorCorrect = db.one<CorrectTsVector>("SELECT search_vector FROM type_showcase WHERE id = $1", [1]);

// --- Interval type ---

interface CorrectInterval { interval_col: string; }  // Interval returns as string
const intervalCorrect = db.one<CorrectInterval>("SELECT interval_col FROM type_showcase WHERE id = $1", [1]);
