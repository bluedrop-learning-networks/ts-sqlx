// Test fixtures for return type inference: scalar types
// int, text, bool, uuid, date, json, etc.
import { db } from "../db";

// --- Numeric types ---

// @expect TS010 "small_int"
interface WrongSmallInt { small_int: string; }  // Should be number
const smallIntWrong = db.one<WrongSmallInt>("SELECT small_int FROM type_showcase WHERE id = $1", [1]);

interface CorrectInt { regular_int: number; }
const intCorrect = db.one<CorrectInt>("SELECT regular_int FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "big_int"
interface WrongBigInt { big_int: number; }  // Should be string (bigint)
const bigIntWrong = db.one<WrongBigInt>("SELECT big_int FROM type_showcase WHERE id = $1", [1]);

interface CorrectBigInt { big_int: string; }
const bigIntCorrect = db.one<CorrectBigInt>("SELECT big_int FROM type_showcase WHERE id = $1", [1]);

interface CorrectFloat { real_num: number; double_num: number; }
const floatCorrect = db.one<CorrectFloat>("SELECT real_num, double_num FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "numeric_val"
interface WrongNumeric { numeric_val: number; }  // Should be string (NUMERIC)
const numericWrong = db.one<WrongNumeric>("SELECT numeric_val FROM type_showcase WHERE id = $1", [1]);

// --- Text types ---

interface CorrectText { char_col: string; varchar_col: string; text_col: string; }
const textCorrect = db.one<CorrectText>("SELECT char_col, varchar_col, text_col FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "text_col"
interface WrongText { text_col: number; }
const textWrong = db.one<WrongText>("SELECT text_col FROM type_showcase WHERE id = $1", [1]);

// --- Boolean type ---

interface CorrectBool { bool_col: boolean; }
const boolCorrect = db.one<CorrectBool>("SELECT bool_col FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "bool_col"
interface WrongBool { bool_col: number; }
const boolWrong = db.one<WrongBool>("SELECT bool_col FROM type_showcase WHERE id = $1", [1]);

// --- UUID type ---

interface CorrectUuid { uuid_col: string; }
const uuidCorrect = db.one<CorrectUuid>("SELECT uuid_col FROM type_showcase WHERE id = $1", [1]);

interface CorrectUserId { id: string; }
const userIdCorrect = db.one<CorrectUserId>("SELECT id FROM users WHERE email = $1", ["test@example.com"]);

// --- Date/time types ---

interface CorrectDate { date_col: Date; }
const dateCorrect = db.one<CorrectDate>("SELECT date_col FROM type_showcase WHERE id = $1", [1]);

interface CorrectTimestamp { timestamp_col: Date; timestamptz_col: Date; }
const timestampCorrect = db.one<CorrectTimestamp>("SELECT timestamp_col, timestamptz_col FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "date_col"
interface WrongDate { date_col: string; }
const dateWrong = db.one<WrongDate>("SELECT date_col FROM type_showcase WHERE id = $1", [1]);

// --- JSON types ---

interface CorrectJson { json_col: unknown; jsonb_col: unknown; }
const jsonCorrect = db.one<CorrectJson>("SELECT json_col, jsonb_col FROM type_showcase WHERE id = $1", [1]);

// JSON with specific type (valid - unknown is compatible)
interface JsonWithType { jsonb_col: { key: string }; }
const jsonTyped = db.one<JsonWithType>("SELECT jsonb_col FROM type_showcase WHERE id = $1", [1]);

// --- Binary type ---

interface CorrectBytea { bytes: Buffer; }
const byteaCorrect = db.one<CorrectBytea>("SELECT bytes FROM type_showcase WHERE id = $1", [1]);

// @expect TS010 "bytes"
interface WrongBytea { bytes: string; }
const byteaWrong = db.one<WrongBytea>("SELECT bytes FROM type_showcase WHERE id = $1", [1]);
