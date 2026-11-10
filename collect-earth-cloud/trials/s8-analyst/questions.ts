// Trial S8: twenty questions a coordinator would ask of the demo survey, in English, Spanish and French, each with the
// view a person who knows the survey would build to answer it (the hand-written answer). The model's view is judged by
// the figures it gives on the same data, not by its wording: rows and columns may be swapped, extra measures are
// allowed, but every expected measure must come out with the same numbers.
import type { ProposedFilter } from '../../src/ai/analysisViews.ts';

export interface Expected {
  rows: string[];
  columns: string[];
  measures: string[];
  filters: ProposedFilter[];
}

export interface Question {
  id: string;
  en: string;
  es: string;
  fr: string;
  expected: Expected;
  /** What the question tests, for the report. */
  tests: string;
}

const F = (column: string, op: ProposedFilter['op'], codes?: string[], value?: number | string): ProposedFilter => ({ column, op, ...(codes ? { codes } : {}), ...(value !== undefined ? { value } : {}) });

export const QUESTIONS: Question[] = [
  {
    id: 'q01',
    tests: 'a plain count by one question',
    en: 'How many plots are there in each land use category?',
    es: '¿Cuántas parcelas hay en cada categoría de uso de la tierra?',
    fr: "Combien de parcelles y a-t-il dans chaque catégorie d'utilisation des terres ?",
    expected: { rows: ['land_use_category'], columns: [], measures: ['plots'], filters: [] },
  },
  {
    id: 'q02',
    tests: 'area as a share, with a filter on a code',
    en: 'What share of the total forest area is in each province?',
    es: '¿Qué proporción de la superficie total de bosque está en cada provincia?',
    fr: 'Quelle part de la superficie forestière totale se trouve dans chaque province ?',
    expected: { rows: ['province'], columns: [], measures: ['areaPct'], filters: [F('land_use_category', 'is', ['F'])] },
  },
  {
    id: 'q03',
    tests: 'a land use change matrix (two questions on one list), by area',
    en: 'Show me the land use change matrix: the previous land use against the land use in 2025, by area.',
    es: 'Muéstreme la matriz de cambio de uso de la tierra: el uso anterior frente al uso de la tierra en 2025, por superficie.',
    fr: "Montrez-moi la matrice de changement d'utilisation des terres : l'utilisation précédente face à celle de 2025, en superficie.",
    expected: { rows: ['land_use_initial_subdivision'], columns: ['land_use_category'], measures: ['area'], filters: [] },
  },
  {
    id: 'q04',
    tests: 'a year question, counted only where it was asked (askedWhenYes)',
    en: 'In which years did the land use changes happen?',
    es: '¿En qué años ocurrieron los cambios de uso de la tierra?',
    fr: "En quelles années les changements d'utilisation des terres ont-ils eu lieu ?",
    expected: { rows: ['land_use_subcategory_year_of_change'], columns: [], measures: ['plots'], filters: [F('land_use_category_has_changed', 'yes')] },
  },
  {
    id: 'q05',
    tests: 'the work: collectors over months',
    en: 'How many plots has each collector saved each month?',
    es: '¿Cuántas parcelas ha guardado cada recolector cada mes?',
    fr: 'Combien de parcelles chaque collecteur a-t-il enregistrées chaque mois ?',
    expected: { rows: ['_operator'], columns: ['_saved_month'], measures: ['plots'], filters: [] },
  },
  {
    id: 'q06',
    tests: 'an average of a number from the plot file',
    en: 'What is the average elevation of each land use?',
    es: '¿Cuál es la elevación media de cada uso de la tierra?',
    fr: "Quelle est l'altitude moyenne de chaque utilisation des terres ?",
    expected: { rows: ['land_use_category'], columns: [], measures: ['avg:elevation'], filters: [] },
  },
  {
    id: 'q07',
    tests: 'a question within one land use',
    en: 'What forest dynamics were found in the forest plots?',
    es: '¿Qué dinámicas forestales se encontraron en las parcelas de bosque?',
    fr: 'Quelles dynamiques forestières ont été observées dans les parcelles de forêt ?',
    expected: { rows: ['forest_dynamics'], columns: [], measures: ['plots'], filters: [F('land_use_category', 'is', ['F'])] },
  },
  {
    id: 'q08',
    tests: 'a filter on a yes/no answer being no',
    en: 'In which land uses were the interpreters not confident of their answer?',
    es: '¿En qué usos de la tierra los intérpretes no estaban seguros de su respuesta?',
    fr: "Pour quelles utilisations des terres les interprètes n'étaient-ils pas sûrs de leur réponse ?",
    expected: { rows: ['land_use_category'], columns: [], measures: ['plots'], filters: [F('land_use_assessment_confidence', 'no')] },
  },
  {
    id: 'q09',
    tests: 'two questions side by side',
    en: 'Which deforestation drivers were recorded in each province?',
    es: '¿Qué causas de deforestación se registraron en cada provincia?',
    fr: 'Quelles causes de déforestation ont été relevées dans chaque province ?',
    expected: { rows: ['deforestation_driver'], columns: ['province'], measures: ['plots'], filters: [] },
  },
  {
    id: 'q10',
    tests: 'area within one land use, by a plot file code',
    en: 'How much cropland area is there in each climate zone?',
    es: '¿Cuánta superficie de tierras de cultivo hay en cada zona climática?',
    fr: 'Quelle superficie de terres cultivées y a-t-il dans chaque zone climatique ?',
    expected: { rows: ['climate'], columns: [], measures: ['area'], filters: [F('land_use_category', 'is', ['C'])] },
  },
  {
    id: 'q11',
    tests: 'a share within a group (two fields in the rows)',
    en: 'Within each province, what share of the plots does each land use have?',
    es: 'Dentro de cada provincia, ¿qué proporción de las parcelas tiene cada uso de la tierra?',
    fr: 'Dans chaque province, quelle part des parcelles revient à chaque utilisation des terres ?',
    expected: { rows: ['province', 'land_use_category'], columns: [], measures: ['plotsPctParent'], filters: [] },
  },
  {
    id: 'q12',
    tests: 'a year question under a code filter',
    en: 'In which years did the forest degradation happen?',
    es: '¿En qué años ocurrió la degradación forestal?',
    fr: 'En quelles années la dégradation forestière a-t-elle eu lieu ?',
    expected: { rows: ['degradation_year'], columns: [], measures: ['plots'], filters: [F('forest_dynamics', 'is', ['degradation'])] },
  },
  {
    id: 'q13',
    tests: 'area by two coded questions',
    en: 'What is the area of each land use on each slope class?',
    es: '¿Cuál es la superficie de cada uso de la tierra en cada clase de pendiente?',
    fr: "Quelle est la superficie de chaque utilisation des terres pour chaque classe de pente ?",
    expected: { rows: ['land_use_category'], columns: ['calculated_slope'], measures: ['area'], filters: [] },
  },
  {
    id: 'q14',
    tests: 'a yes/no question in the rows',
    en: 'How many plots had a previous land use before the current one?',
    es: '¿Cuántas parcelas tuvieron un uso de la tierra anterior al actual?',
    fr: "Combien de parcelles avaient une utilisation des terres antérieure à l'actuelle ?",
    expected: { rows: ['second_lu_change'], columns: [], measures: ['plots'], filters: [] },
  },
  {
    id: 'q15',
    tests: 'an average of a numeric answer by a plot file text field',
    en: 'What is the average forest cover percentage in each province?',
    es: '¿Cuál es el porcentaje medio de cobertura forestal en cada provincia?',
    fr: 'Quel est le pourcentage moyen de couverture forestière dans chaque province ?',
    expected: { rows: ['province'], columns: [], measures: ['avg:forest_percentage'], filters: [] },
  },
  {
    id: 'q16',
    tests: "the collection's own codes (quality checks)",
    en: 'How many quality check plots has each collector done?',
    es: '¿Cuántas parcelas de control de calidad ha hecho cada recolector?',
    fr: 'Combien de parcelles de contrôle qualité chaque collecteur a-t-il faites ?',
    expected: { rows: ['_operator'], columns: [], measures: ['plots'], filters: [F('_assessment', 'is', ['check'])] },
  },
  {
    id: 'q17',
    tests: 'subdivisions of one category (a hierarchical list), by area',
    en: 'How is the grassland area split between its subdivisions?',
    es: '¿Cómo se reparte la superficie de pastizales entre sus subdivisiones?',
    fr: 'Comment la superficie des prairies se répartit-elle entre ses subdivisions ?',
    expected: { rows: ['land_use_subdivision'], columns: [], measures: ['area'], filters: [F('land_use_category', 'is', ['G'])] },
  },
  {
    id: 'q18',
    tests: 'the work over time',
    en: 'How many plots were saved each week?',
    es: '¿Cuántas parcelas se guardaron cada semana?',
    fr: 'Combien de parcelles ont été enregistrées chaque semaine ?',
    expected: { rows: ['_saved_week'], columns: [], measures: ['plots'], filters: [] },
  },
  {
    id: 'q19',
    tests: 'a coded range question within one land use',
    en: 'At what elevation ranges are the settlement plots?',
    es: '¿En qué rangos de elevación están las parcelas de asentamientos?',
    fr: "À quelles tranches d'altitude se trouvent les parcelles d'établissements ?",
    expected: { rows: ['calculated_elevation_range'], columns: [], measures: ['plots'], filters: [F('land_use_category', 'is', ['S'])] },
  },
  {
    id: 'q20',
    tests: 'a numeric threshold filter',
    en: 'How many plots above 1,000 metres are there in each land use?',
    es: '¿Cuántas parcelas por encima de 1.000 metros hay en cada uso de la tierra?',
    fr: "Combien de parcelles au-dessus de 1 000 mètres y a-t-il pour chaque utilisation des terres ?",
    expected: { rows: ['land_use_category'], columns: [], measures: ['plots'], filters: [F('elevation', 'atLeast', undefined, 1000)] },
  },
];

export const LANGUAGES = ['en', 'es', 'fr'] as const;
export type TrialLanguage = (typeof LANGUAGES)[number];
