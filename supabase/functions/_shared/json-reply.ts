// Reading the JSON object a model was asked to reply with.
//
// Models wrap it in prose or a code fence, and smaller ones slip on the
// closing brackets: Groq's gpt-oss-20b closed an array with "}" in two
// scoring replies out of three (subscription TODO, section 4). The strict
// parse is tried first; only when it fails are the closers put right. What
// comes out still has to pass the caller's own checks.

/**
 * `text` from its first "{" with every closing bracket matched to its opener:
 * a wrong closer becomes the right one, missing ones are added at the end,
 * and anything after the object closes is dropped. Null when there is no
 * object, or the text stops inside a string.
 */
export function repairJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const closerOf: Record<string, string> = { '{': '}', '[': ']' };
  const open: string[] = [];
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '{' || ch === '[') {
      open.push(ch);
      out += ch;
    } else if (ch === '}' || ch === ']') {
      // Whatever was written, this closes the innermost open bracket.
      out += closerOf[open.pop()!];
      if (!open.length) return out;
    } else out += ch;
  }
  if (inString) return null;
  while (open.length) out += closerOf[open.pop()!];
  return out;
}

/** The object in a model's reply, or null when there is none to be read. */
export function parseJsonObject(reply: string): Record<string, unknown> | null {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const m = reply.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o: unknown = JSON.parse(m[0]);
      if (isObject(o)) return o;
    } catch {
      // Not valid as written: try with the brackets put right.
    }
  }
  const repaired = repairJsonObject(reply);
  if (!repaired) return null;
  try {
    const o: unknown = JSON.parse(repaired);
    return isObject(o) ? o : null;
  } catch {
    return null;
  }
}
