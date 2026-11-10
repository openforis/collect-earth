// The survey outline: each question of a survey, by the key the desktop app gives its
// answer in a record summary, with its label, kind, answer options and help text.
import { attr, childrenOf, elements, parseSurvey, tagOf, textOf, type CodeItem, type XmlNode } from './cep.js';

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
   * Never compared: key attributes (collect_text_id, the keys of entities), any root
   * attribute named round, the BOOKKEEPING_KEYS, and attributes filled from the plot file
   * (collectearth:fromcsv), which are the same for every round.
   */
  excluded: boolean;
  /** The attribute may hold several values; the summary joins them with "===". */
  multiple: boolean;
  /** Collect calculates the value from other answers (calculated="true"). */
  calculated: boolean;
  /**
   * An answer is needed whatever the other answers are: a root attribute with
   * required="true" (or minCount 1), no `relevant` and no `requiredIf` expression, not
   * calculated, not excluded. Relevance and conditions cannot be judged on the server, so
   * a question that is required only under one, or shown only under one, is not. Nor are
   * an entity's attributes: the desktop app leaves their blank answers out of the summary,
   * so an empty one cannot be told from an entity that is not there. Absent: false.
   */
  required?: boolean;
  /**
   * For a choice: each option's labels other than `options[].label` (its other languages,
   * a reporting label), by code; absent when the survey has none. Survey health matches
   * "other", "unknown"... in every language of the survey with them.
   */
  optionLabels?: Record<string, string[]>;
  /**
   * Shown or required only under a condition: the attribute, or the entity holding it, has
   * a `relevant` or `requiredIf` expression. The server cannot judge it, so an empty answer
   * may be expected (survey health does not count it against the question). Absent: false.
   */
  conditional?: boolean;
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
export function prefixOf(node: XmlNode): string | null {
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

/**
 * Summary keys the desktop app fills itself, never answers (EarthConstants and
 * SurveyFormController): who saved, whether and when it was saved (the date, and the
 * text form of older surveys), the plot file, and the plot's centre.
 */
export const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set([
  'collect_text_operator',
  'collect_boolean_actively_saved',
  'collect_date_actively_saved_on',
  'collect_text_actively_saved_on',
  'collect_text_plot_file',
  'collect_coord_location',
]);

/** The root attribute holding the round (EarthConstants.ROUND_ATTRIBUTE_NAME). */
const ROUND_NAME = 'round';

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
 * - an enumerable multiple entity (EntityDefinition.isEnumerable: its first key is a code
 *   whose list is not external, i.e. has no `lookup`; collect:enumerate plays no part):
 *   `collect_entity_<entity>[<key code>].<prefix><child>`, one entity per root item of
 *   its key's list (land_use[F], land_use[C]...). The key is Entity.getKeyValues()[0],
 *   the bare code: Code.toInternalString leaves out the qualifier;
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
  /** Each list's items' labels other than the one picked, by code (lists without any left out). */
  const listOtherLabels = new Map<string, Map<string, string[]>>();
  /** Lists whose items live in a lookup table (CodeList.isExternal). */
  const externalLists = new Set<string>();
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
          const labels = elements(itemChildren, 'label');
          const label = pickLabel(labels);
          const level = (levels[depth] ??= []);
          const value = textOf(code);
          if (!level.some((i) => i.code === value)) level.push({ code: value, label: label ? textOf(label) : '' });
          const others = labels.filter((l) => l !== label).map(textOf).filter((t) => t !== '');
          if (others.length > 0) {
            let byCode = listOtherLabels.get(name);
            if (!byCode) listOtherLabels.set(name, (byCode = new Map()));
            byCode.set(value, [...new Set([...(byCode.get(value) ?? []), ...others])]);
          }
          walk(elements(itemChildren, 'item'), depth + 1);
        }
      };
      for (const itemsNode of elements(childrenOf(list), 'items')) walk(elements(childrenOf(itemsNode), 'item'), 0);
      listLevels.set(name, levels);
      if (attr(list, 'lookup') !== undefined) externalLists.add(name);
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
  const hasCondition = (node: XmlNode) => attr(node, 'relevant') !== undefined || attr(node, 'requiredIf') !== undefined;
  const add = (key: string, node: XmlNode, siblings: XmlNode[], label: string, isKey: boolean, root = false, inConditional = false) => {
    const prefix = prefixOf(node)!;
    const kind = KIND_BY_PREFIX[prefix] ?? 'other';
    const excluded = isKey || attr(node, 'collectearth:fromcsv') === 'true' || BOOKKEEPING_KEYS.has(key);
    const calculated = attr(node, 'calculated') === 'true';
    const minCount = Number(attr(node, 'minCount') ?? '0');
    const required =
      root &&
      !excluded &&
      !calculated &&
      (attr(node, 'required') === 'true' || (Number.isFinite(minCount) && minCount >= 1)) &&
      attr(node, 'relevant') === undefined &&
      attr(node, 'requiredIf') === undefined;
    const options = prefix === 'code_' ? optionsOf(node, siblings) : prefix === 'boolean_' ? BOOLEAN_OPTIONS : null;
    const otherLabels = prefix === 'code_' ? listOtherLabels.get(attr(node, 'list') ?? '') : undefined;
    const optionLabels: Record<string, string[]> = {};
    for (const o of otherLabels ? options! : []) {
      const more = otherLabels!.get(o.code);
      if (more) optionLabels[o.code] = more;
    }
    outline.set(key, {
      key,
      label,
      kind,
      options,
      help: helpOf(node),
      excluded,
      multiple: attr(node, 'multiple') === 'true',
      calculated,
      required,
      ...(Object.keys(optionLabels).length > 0 ? { optionLabels } : {}),
      ...(inConditional || hasCondition(node) ? { conditional: true } : {}),
    });
  };

  const rootChildren = definitions(root);
  for (const node of rootChildren) {
    const name = attr(node, 'name')!;
    if (tagOf(node) !== 'entity') {
      const isKey = attr(node, 'key') === 'true' || name === ROUND_NAME;
      add(`collect_${prefixOf(node)}${name}`, node, rootChildren, labelOf(node), isKey, true);
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
          false,
          hasCondition(node),
        );
      }
    };
    if (attr(node, 'multiple') !== 'true') {
      addChildren(base, entityLabel);
      continue;
    }
    const firstKey = childrenOf(node).find((c) => attr(c, 'key') === 'true');
    const keyList = firstKey && tagOf(firstKey) === 'code' ? attr(firstKey, 'list') : undefined;
    if (keyList !== undefined && !externalLists.has(keyList)) {
      for (const item of listLevels.get(keyList)?.[0] ?? []) {
        addChildren(`${base}[${item.code}]`, `${entityLabel} (${item.label || item.code})`);
      }
    } else {
      for (let n = 1; n <= MAX_INDEXED_ENTITIES; n++) addChildren(`${base}[${n}]`, `${entityLabel} ${n}`);
    }
  }
  return outline;
}
