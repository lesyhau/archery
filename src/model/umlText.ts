// Textual UML member syntax used by the property panel (one member per line):
//   attribute:  [+|-|#|~] [static] [/]name [: Type] [[multiplicity]] [= default]
//   operation:  [+|-|#|~] [static] [abstract] name(param: Type, other) [: Return]
import type { Attribute, Operation } from './schema';

const VIS = /^([+\-#~])\s*/;

function take(re: RegExp, s: string): [string | undefined, string] {
  const m = re.exec(s);
  return m ? [m[1] ?? m[0], s.slice(m[0].length)] : [undefined, s];
}

export function parseAttribute(line: string): Attribute | undefined {
  let s = line.trim();
  if (!s) return undefined;
  const a: Attribute = { name: '' };
  let v: string | undefined;
  [v, s] = take(VIS, s);
  if (v) a.visibility = v as Attribute['visibility'];
  [v, s] = take(/^static\s+/, s);
  if (v) a.static = true;
  if (s.startsWith('/')) {
    a.derived = true;
    s = s.slice(1);
  }
  const eq = s.indexOf('=');
  if (eq >= 0) {
    a.default = s.slice(eq + 1).trim();
    s = s.slice(0, eq).trim();
  }
  const mult = /\[([^\]]*)\]\s*$/.exec(s);
  if (mult) {
    a.multiplicity = mult[1]!.trim();
    s = s.slice(0, mult.index).trim();
  }
  const colon = s.indexOf(':');
  if (colon >= 0) {
    a.type = s.slice(colon + 1).trim() || undefined;
    s = s.slice(0, colon).trim();
  }
  a.name = s.trim();
  if (!a.name) return undefined;
  return clean(a);
}

export function formatAttribute(a: Attribute): string {
  return `${a.visibility ?? ''}${a.static ? 'static ' : ''}${a.derived ? '/' : ''}${a.name}${a.type ? `: ${a.type}` : ''}${a.multiplicity ? ` [${a.multiplicity}]` : ''}${a.default ? ` = ${a.default}` : ''}`;
}

export function parseOperation(line: string): Operation | undefined {
  let s = line.trim();
  if (!s) return undefined;
  const o: Operation = { name: '' };
  let v: string | undefined;
  [v, s] = take(VIS, s);
  if (v) o.visibility = v as Operation['visibility'];
  for (;;) {
    const [mod, rest] = take(/^(static|abstract)\s+/, s);
    if (!mod) break;
    if (mod === 'static') o.static = true;
    else o.abstract = true;
    s = rest;
  }
  const open = s.indexOf('(');
  const close = s.lastIndexOf(')');
  if (open < 0) {
    const colon = s.indexOf(':');
    o.name = (colon >= 0 ? s.slice(0, colon) : s).trim();
    if (colon >= 0) o.returns = s.slice(colon + 1).trim() || undefined;
  } else {
    o.name = s.slice(0, open).trim();
    const inner = s.slice(open + 1, close >= 0 ? close : undefined).trim();
    if (inner) {
      o.params = splitParams(inner).map((p) => {
        const c = p.indexOf(':');
        return c >= 0 ? clean({ name: p.slice(0, c).trim(), type: p.slice(c + 1).trim() || undefined }) : { name: p.trim() };
      });
    }
    const after = close >= 0 ? s.slice(close + 1).trim() : '';
    if (after.startsWith(':')) o.returns = after.slice(1).trim() || undefined;
  }
  if (!o.name) return undefined;
  return clean(o);
}

/** Splits "a: Map<K, V>, b" at top-level commas only. */
function splitParams(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('<([{'.includes(ch)) depth++;
    if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.filter((p) => p.trim());
}

export function formatOperation(o: Operation): string {
  const params = (o.params ?? []).map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ');
  return `${o.visibility ?? ''}${o.static ? 'static ' : ''}${o.abstract ? 'abstract ' : ''}${o.name}(${params})${o.returns ? `: ${o.returns}` : ''}`;
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

export const parseLines = <T>(text: string, parse: (line: string) => T | undefined): T[] =>
  text.split('\n').map(parse).filter((x): x is T => x !== undefined);
