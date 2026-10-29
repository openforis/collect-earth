// The survey outline: each question of a survey, by the key the desktop app gives its
// answer in a record summary, with its label, kind, answer options and help text.
import { attr, childrenOf, elements, parseSurvey, tagOf, textOf, type CodeItem, type XmlNode } from './cep.js';
import { METADATA_KEY_PARTS } from './division.js';

export interface Question {
  /** The summary key, e.g. "collect_code_land_use" or "collect_entity_land_use[F].code_coverage". */
  key: string;
  label: string;
  kind: 'choice' | 'number' | 'text' | 'other';
  /** For a choice: the codes the answer can take (empty when the list is unknown). Else null. */
  options: CodeItem[] | null;
  /** The <description>, in the survey's default language. */
  help: string | null;
  /**
   * Never compared: key attributes (collect_text_id, collect_code_round, the key of an
   * enumerated entity), metadata (METADATA_KEY_PARTS) and attributes filled from the plot
   * file (collectearth:fromcsv), which are the same for every round.
   */
  excluded: boolean;
  /** The attribute may hold several values; the summary joins them with "===". */
  multiple: boolean;
  /** Collect calculates the value from other answers (calculated="true"). */
  calculated: boolean;
}

/** Between the values of a multiple attribute in a summary (BalloonInputFieldsUtils.PARAMETER_SEPARATOR). */
export const SUMMARY_VALUES_SEPARATOR = '===';
/** Between a code and its qualifier ("other::Eucalyptus", CodeAttributeHandler.QUALIFIER_SEPARATOR). */
export const QUALIFIER_SEPARATOR = '::';
/** How many entities of a multiple, not enumerated, entity get questions (MAX_MULTIPLE_ENTITIES_COUNT). */
export const MAX_INDEXED_ENTITIES = 10;

/**
 * The summary key prefix of each IDML element, as the handlers of the desktop app's
 * BalloonInputFieldsUtils give it (getPrefix). Elements without a handler (taxon, file)
 * are not in summaries: the desktop app cannot summarize a record holding them.
 */
function prefixOf(node: XmlNode): string | null {
  const type = attr(node, 'type');
  switch (tagOf(node)) {
    case 'boolean':
      return 'boolean_';
    case 'code':
      return 'code_';
    case 'coordinate':
      return 'coord_';
    case 'date':
      return 'date_';
    case 'time':
      return 'time_';
    case 'text':
      return 'text_';
    case 'entity':
      return 'entity_';
    // Collect reads <number> and <range> without a type as real.
    case 'number':
      return type === 'integer' ? 'integer_' : 'real_';
    case 'range':
      return type === 'integer' ? 'integer_range_' : 'real_range_';
    default:
      return null;
  }
}

const KIND_BY_PREFIX: Record<string, Question['kind']> = {
  code_: 'choice',
  boolean_: 'choice',
  integer_: 'number',
  real_: 'number',
  text_: 'text',
};

const BOOLEAN_OPTIONS: CodeItem[] = [
  { code: 'true', label: 'Yes' },
  { code: 'false', label: 'No' },
];

const isMetadataKey = (key: string) => {
  const k = key.toLowerCase();
  return METADATA_KEY_PARTS.some((part) => k.includes(part));
};

/**
 * Every question of a survey (placemark.idm.xml), by summary key, in the survey's order.
 *
 * Summary keys are built as BalloonInputFieldsUtils.getValuesByHtmlParameters builds them
 * from a record's root entity, in the desktop app (collect-earth-core):
 * - an attribute of the root entity: `collect_<prefix><name>`, the prefix being
 *   `text_`, `code_`, `boolean_`, `integer_` or `real_` (a <number> by its type, real
 *   when it has none), `integer_range_` or `real_range_` (a <range>, likewise),
 *   `coord_`, `date_` or `time_`;
 * - a multiple attribute: the same key, its values joined by "===";
 * - a code with a qualifier: the same key, the value "code::qualifier";
 * - a single entity: `collect_entity_<entity>.<prefix><child>`;
 * - a multiple entity marked collect:enumerate="true":
 *   `collect_entity_<entity>[<key code>].<prefix><child>`, one entity per root item of
 *   its key's list (land_use[F], land_use[C]...);
 * - another multiple entity: `collect_entity_<entity>[<n>].<prefix><child>`, n from 1;
 *   the outline has n = 1 to 10;
 * - inside an entity, a blank answer is left out of the summary;
 * - taxon and file attributes have no handler, nor do entities inside an entity (the
 *   desktop app fails on them), so they get no question.
 */
export function surveyOutline(idmXml: string): Map<string, Question> {
  const { surveyChildren, root, pickLabel } = parseSurvey(idmXml);

  // Each list's items by level: [0] the root items, [1] their children...
  const listLevels = new Map<string, CodeItem[][]>();
  for (const codeListsNode of elements(surveyChildren, 'codeLists')) {
    for (const list of elements(childrenOf(codeListsNode), 'list')) {
      const name = attr(list, 'name');
      if (!name) continue;
      const levels: CodeItem[][] = [];
      const walk = (items: XmlNode[], depth: number) => {
        for (const item of items) {
          const itemChildren = childrenOf(item);
          const code = elements(itemChildren, 'code')[0];
          if (!code) continue;
          const label = pickLabel(elements(itemChildren, 'label'));
          const level = (levels[depth] ??= []);
          const value = textOf(code);
          if (!level.some((i) => i.code === value)) level.push({ code: value, label: label ? textOf(label) : '' });
          walk(elements(itemChildren, 'item'), depth + 1);
        }
      };
      for (const itemsNode of elements(childrenOf(list), 'items')) walk(elements(childrenOf(itemsNode), 'item'), 0);
      listLevels.set(name, levels);
    }
  }

  const labelOf = (node: XmlNode): string => {
    const labels = elements(childrenOf(node), 'label');
    const instance = pickLabel(labels.filter((l) => (attr(l, 'type') ?? 'instance') === 'instance'));
    const reporting = pickLabel(labels.filter((l) => attr(l, 'type') === 'reporting'));
    const text = (instance && textOf(instance)) || (reporting && textOf(reporting));
    return text || attr(node, 'name') || '';
  };
  const helpOf = (node: XmlNode): string | null => {
    const description = pickLabel(elements(childrenOf(node), 'description'));
    return (description && textOf(description)) || null;
  };

  /** The named children of an entity that are attributes or entities. */
  const definitions = (entity: XmlNode) =>
    childrenOf(entity).filter((c) => attr(c, 'name') !== undefined && prefixOf(c) !== null);

  /** A code attribute's options: the items of its list at its level (one per parent code above it). */
  const optionsOf = (node: XmlNode, siblings: XmlNode[]): CodeItem[] => {
    let depth = 0;
    const seen = new Set<string>();
    let current: XmlNode | undefined = node;
    while (current) {
      const parent = attr(current, 'parent');
      if (!parent) break;
      const parentName = parent.split('/').pop()!;
      if (seen.has(parentName)) break;
      seen.add(parentName);
      current = siblings.find((s) => tagOf(s) === 'code' && attr(s, 'name') === parentName);
      if (current) depth++;
    }
    return listLevels.get(attr(node, 'list') ?? '')?.[depth] ?? [];
  };

  const outline = new Map<string, Question>();
  const add = (key: string, node: XmlNode, siblings: XmlNode[], label: string, isKey: boolean) => {
    const prefix = prefixOf(node)!;
    const kind = KIND_BY_PREFIX[prefix] ?? 'other';
    outline.set(key, {
      key,
      label,
      kind,
      options: prefix === 'code_' ? optionsOf(node, siblings) : prefix === 'boolean_' ? BOOLEAN_OPTIONS : null,
      help: helpOf(node),
      excluded: isKey || attr(node, 'collectearth:fromcsv') === 'true' || isMetadataKey(key),
      multiple: attr(node, 'multiple') === 'true',
      calculated: attr(node, 'calculated') === 'true',
    });
  };

  const rootChildren = definitions(root);
  for (const node of rootChildren) {
    const name = attr(node, 'name')!;
    if (tagOf(node) !== 'entity') {
      add(`collect_${prefixOf(node)}${name}`, node, rootChildren, labelOf(node), attr(node, 'key') === 'true');
      continue;
    }
    const base = `collect_entity_${name}`;
    const entityLabel = labelOf(node);
    // Entities inside an entity are left out: the desktop app cannot summarize them.
    const children = definitions(node).filter((c) => tagOf(c) !== 'entity');
    const addChildren = (path: string, label: string) => {
      for (const child of children) {
        add(
          `${path}.${prefixOf(child)}${attr(child, 'name')}`,
          child,
          children,
          `${label}: ${labelOf(child)}`,
          attr(child, 'key') === 'true',
        );
      }
    };
    if (attr(node, 'multiple') !== 'true') {
      addChildren(base, entityLabel);
      continue;
    }
    const enumeratingKey = children.find((c) => tagOf(c) === 'code' && attr(c, 'key') === 'true');
    if (attr(node, 'collect:enumerate') === 'true' && enumeratingKey) {
      for (const item of listLevels.get(attr(enumeratingKey, 'list') ?? '')?.[0] ?? []) {
        addChildren(`${base}[${item.code}]`, `${entityLabel} (${item.label || item.code})`);
      }
    } else {
      for (let n = 1; n <= MAX_INDEXED_ENTITIES; n++) addChildren(`${base}[${n}]`, `${entityLabel} ${n}`);
    }
  }
  return outline;
}
