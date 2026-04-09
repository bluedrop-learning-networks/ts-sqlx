export type NullabilityHint = 'nullable' | 'not-null';

export interface HintExtractionResult {
  cleanedSql: string;
  hints: Map<string, NullabilityHint>;
}

const LEADING_BLOCK_COMMENT = /^\s*\/\*([\s\S]*?)\*\//;

export function extractNullabilityHints(sql: string): HintExtractionResult {
  const hints = new Map<string, NullabilityHint>();

  const match = LEADING_BLOCK_COMMENT.exec(sql);
  if (!match) return { cleanedSql: sql, hints };

  const commentBody = match[1];
  let foundHint = false;

  for (const m of commentBody.matchAll(/@(nullable|not-null)\s+([^@]*)/g)) {
    foundHint = true;
    const hint = m[1] as NullabilityHint;
    const names = m[2]
      .split(',')
      .map((n) => n.trim())
      .map((n) => (n.startsWith('"') && n.endsWith('"') ? n.slice(1, -1) : n))
      .filter((n) => n.length > 0 && /^[a-zA-Z_]\w*$/.test(n));
    for (const name of names) {
      hints.set(name, hint);
    }
  }

  if (!foundHint) return { cleanedSql: sql, hints };

  const cleanedSql = sql.slice(match[0].length).trim();
  return { cleanedSql, hints };
}
