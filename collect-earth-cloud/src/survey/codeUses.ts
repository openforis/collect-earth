// Which questions use an answer of a list: a condition, rule or formula that names a question of the list and an
// answer's code (quoted, as Collect compares codes), or a formula that gives the code itself (unquoted, as
// <default value="FLAT"/> does). The designer lists them (design.ts) and refuses to delete a used answer (edit.ts).

import { attrValue, descendants, type XmlDocument, type XmlElement } from './xmlTree.js';

/** The attributes that hold an expression or a value of one */
const EXPRESSION_ATTRIBUTES = new Set(['relevant', 'requiredIf', 'expr', 'if', 'value', 'lt', 'lte', 'gt', 'gte']);
const NODE_TAGS = new Set(['entity', 'text', 'number', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'range', 'file']);
const QUOTED = /'([^']*)'|"([^"]*)"/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The node an element belongs to: itself, or the nearest node above it */
function ownerOf(e: XmlElement): XmlElement | undefined {
  for (let at: XmlElement | null | undefined = e; at; at = at.parent) if (NODE_TAGS.has(at.name)) return at;
  return undefined;
}

/** For each list, each used code and the names of the questions that use it */
export function codeUsers(doc: XmlDocument, schema: XmlElement): Map<string, Map<string, Set<string>>> {
  const listOf = new Map<string, string>();
  for (const e of descendants(schema)) {
    if (e.name !== 'code') continue;
    const name = attrValue(doc, e, 'name');
    const list = attrValue(doc, e, 'list');
    if (name && list) listOf.set(name, list);
  }
  const named = new Map<string, RegExp>([...listOf.keys()].map((n) => [n, new RegExp(`(^|[^\\w])${escape(n)}($|[^\\w(])`)]));
  const out = new Map<string, Map<string, Set<string>>>();
  const add = (list: string, code: string, user: string) => {
    const codes = out.get(list) ?? new Map<string, Set<string>>();
    out.set(list, codes);
    const users = codes.get(code) ?? new Set<string>();
    codes.set(code, users);
    users.add(user);
  };
  for (const e of descendants(schema)) {
    const owner = ownerOf(e);
    const ownerName = owner ? attrValue(doc, owner, 'name') : undefined;
    if (!owner || !ownerName) continue;
    for (const a of e.attrs) {
      if (!EXPRESSION_ATTRIBUTES.has(a.name)) continue;
      const text = attrValue(doc, e, a.name) ?? '';
      // A formula of a choice gives its code itself
      if (e.name === 'default' && a.name === 'value' && owner.name === 'code') {
        const list = attrValue(doc, owner, 'list');
        const code = text.trim().replace(/^['"]|['"]$/g, '');
        if (list && code) add(list, code, ownerName);
      }
      const quoted = [...text.matchAll(QUOTED)].map((m) => m[1] ?? m[2]);
      if (quoted.length === 0) continue;
      for (const [question, list] of listOf) {
        if (!named.get(question)!.test(text) && !(owner.name === 'code' && ownerName === question && a.name !== 'relevant')) continue;
        for (const code of quoted) add(list, code, ownerName);
      }
    }
  }
  return out;
}
