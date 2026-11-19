import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import ExpandMore from "@mui/icons-material/ExpandMore";
import EditOutlined from "@mui/icons-material/EditOutlined";
import Translate from "@mui/icons-material/Translate";
import Add from "@mui/icons-material/Add";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import DriveFileMoveOutlined from "@mui/icons-material/DriveFileMoveOutlined";
import Download from "@mui/icons-material/Download";
import Upload from "@mui/icons-material/Upload";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import SubdirectoryArrowRight from "@mui/icons-material/SubdirectoryArrowRight";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlined";
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ApiError,
  checkSurveyExpression,
  getProjectAi,
  getSurveyDesign,
  getSurveyOlder,
  getSurveyHelp,
  getSurveyImpact,
  listSurveyVersions,
  restoreSurveyVersion,
  saveSurveyChanges,
  type DesignItem,
  type DesignList,
  type DesignListItem,
  type DesignPage,
  type DesignQuestion,
  type DesignTable,
  type SurveyDesign,
  type SurveyDesignAnswer,
  type ExpressionCheckInput,
  type SurveyEffect,
  type SurveyImpactAnswer,
  type SurveyOperation,
  type NewQuestionType,
  type SurveyProblem,
  type WordTarget,
} from "../api";
import { formatDate } from "../format";
import { queryClient } from "../queryClient";
import {
  changedTexts,
  COMMON_LANGUAGES,
  Drafts,
  editKey,
  isItemCode,
  isLanguageCode,
  itemMoveTarget,
  itemsFromLines,
  languagesUsed,
  MAX_TEXT,
  moveTarget,
  namesEmptied,
  operationsOf,
  pageMoveTarget,
  PendingTexts,
  rebaseChange,
  ruleAnchor,
  ruleIndexOf,
  sameSurvey,
  slugName,
  subListParents,
  uniqueName,
  withPendingTexts,
  type PendingText,
  type WordPart,
} from "./surveyEditView";
import { useApp } from "../appContext";
import { navigate, setLeaveGuard } from "../router";
import { setUnsaved, useUnsaved } from "../unsavedChanges";
import { ToolButton } from "./ToolButton";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FoldingCard } from "../components/FoldingCard";
import { Loading } from "../components/Loading";
import { useT, type MessageKey } from "../i18n";
import { useLoad } from "../useLoad";
import {
  conditionWords,
  checkWords,
  firstLanguage,
  languageNames,
  questionUsers,
  refusalWords,
  requiredWords,
  ruleWords,
  tableWords,
  textIn,
  TYPE_KEYS,
  untranslated,
  usersOfQuestion,
  usersOfTable,
  words,
  type Words,
} from "./surveyDesignView";
import { ConditionDialog, ExpressionCheckContext, FormulasDialog, RequiredControl, RuleDialog } from "./SurveyLogic";
import { decodeTexts, importTexts, textsCsv } from "./surveyTextsView";
import { csvBlob } from "../csv";
import { ExplainButton, HelpContext, SuggestRulesDialog, TranslateDialog, type SurveyHelp } from "./SurveyHelp";
import { DraftContext, useDraft, useSubmit, type AddResult } from "./surveyDialogs";
import { NewSurvey } from "./SurveyNew";
import { SurveyPreview } from "./SurveyPreview";
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import { builderRule, conditionQuestions, listOptions, ruleKinds } from "./surveyLogicView";

/** The most answers a question shows inline; the list's card has them all */
const INLINE_ANSWERS = 12;

/** The words being changed (stage 2): what the fields show and where what is typed goes */
interface Editing {
  language: string;
  /** The language's name, said in the dialogs that add something: their texts are written in it */
  languageName: string;
  /** The survey has more than one language: the dialogs say the others are written afterwards */
  manyLanguages: boolean;
  /** The survey's first language, whose text a field in another language shows under it */
  firstLanguage: string;
  firstLanguageName: string;
  set: (target: WordTarget, part: WordPart, text: string, current: string, anchor?: string) => void;
  /**
   * A change of the questions, pages or lists (stage 3) from a button: saved at once on its own (the texts typed stay
   * to be saved or discarded), after what it does to the plots collected is shown (and always asked about when `what`
   * names something deleted); how it went is said in the bar
   */
  change: (ops: SurveyOperation[], what?: string) => void;
  /** The same from a dialog: it hears back whether it was saved, and what to show in it when it was not */
  submit: (ops: SurveyOperation[], what?: string) => Promise<AddResult>;
  /** A change is being saved */
  busy: boolean;
  /** The pages a question can move to */
  pages: Array<{ name: string; label: string }>;
  /** Opens the dialog adding a question to a page, or a column to a table */
  addQuestion: (where: { page?: string; table?: number }) => void;
  /** Opens the dialog adding a table to a page */
  addTable: (page: string) => void;
  /** For each name, the questions and tables naming it: those cannot be deleted */
  users: ReadonlyMap<string, readonly string[]>;
}

/** A change waiting for the coordinator's yes: what it does to the plots collected, what it deletes */
interface PendingChange {
  ops: SurveyOperation[];
  impact: SurveyImpactAnswer;
  what?: string;
  /** The coordinator's answer: true to save */
  answer: (yes: boolean) => void;
}

/** How a save or a change ended */
type Outcome =
  | { kind: "saved" }
  /** Not asked to the server: the coordinator cancelled, another change was on its way, or nothing to save */
  | { kind: "cancelled" }
  | { kind: "stale" }
  | { kind: "refused"; problems: SurveyProblem[] }
  | { kind: "error"; error: unknown };

/** A change the server refused because the survey changed meanwhile: offered again once it is read again */
interface Retry {
  ops: SurveyOperation[];
  what?: string;
  /** The survey it was made on: what it names is found again in the survey read */
  design: SurveyDesign | null;
}

/** After the survey was read again: the change refused, as it can be made now; or null ops when it cannot safely be */
interface Offer {
  ops: SurveyOperation[] | null;
  what?: string;
}

const EditContext = createContext<Editing | null>(null);
/** The texts typed and not saved yet, the same store for the whole survey designer */
const PendingContext = createContext<PendingTexts | null>(null);

const noSubscribe = () => () => {};

/** The text typed into a field and not saved yet: only this field re-renders when it changes */
function usePendingText(key: string | null): PendingText | undefined {
  const store = useContext(PendingContext);
  const subscribe = useCallback((listener: () => void) => (store && key ? store.subscribeKey(key, listener) : () => {}), [store, key]);
  return useSyncExternalStore(subscribe, () => (store && key ? store.get(key) : undefined));
}

/** Whether texts are typed and not saved */
function useHasPendingTexts(store: PendingTexts): boolean {
  return useSyncExternalStore(store.subscribe, () => changedTexts(store.all()).length > 0);
}

/**
 * Where the keyboard was before a change from a button (moved, deleted, cancelled): put back once the change ends if
 * it was lost meanwhile (the item re-placed, deleted, a dialog closed). The same button when it is still there, else
 * another tool of the same item, else the first control of the page, list or question around it.
 */
function keepFocus(): () => void {
  const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!el || el === document.body || el.closest("[role=dialog]")) return () => {};
  const label = el.getAttribute("aria-label");
  const homes: HTMLElement[] = [];
  for (let h = el.parentElement?.closest<HTMLElement>("[data-focus-home]") ?? null; h; h = h.parentElement?.closest<HTMLElement>("[data-focus-home]") ?? null) homes.push(h);
  // Once the dialogs the change opened have gone (the keyboard is then on nothing), and for two seconds at most
  const restore = (tries: number) => {
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) {
      if (now.closest("[role=dialog]") && tries > 0) window.setTimeout(() => restore(tries - 1), 50);
      return;
    }
    if (document.querySelector("#root[aria-hidden=true]") && tries > 0) {
      window.setTimeout(() => restore(tries - 1), 50);
      return;
    }
    {
      const byLabel = (pick: (l: string) => boolean) =>
        [...document.querySelectorAll<HTMLElement>("[aria-label]")].find((e) => pick(e.getAttribute("aria-label") ?? "") && !e.closest("[aria-hidden=true]"));
      const name = label && label.includes(": ") ? label.slice(label.indexOf(": ") + 2) : null;
      const target =
        (label ? byLabel((l) => l === label) : undefined) ??
        (name ? byLabel((l) => l.endsWith(`: ${name}`)) : undefined) ??
        homes
          .find((h) => h.isConnected)
          ?.querySelector<HTMLElement>("button:not([disabled]), input:not([type=file]):not([disabled]), textarea:not([aria-hidden])");
      target?.focus();
    }
  };
  return () => window.setTimeout(() => restore(40), 30);
}

/** Why a change was not made, when the server says why: in the dashboard's words, the server's own reason after it */
function ChangeError({ error }: { error: unknown }) {
  const t = useT();
  // A refusal the server gives a code: in the dashboard's words only
  const words = error instanceof ApiError && error.status === 400 ? refusalWords(t, error.details.code, (error.details.values ?? {}) as Record<string, string>) : null;
  if (words) {
    return (
      <Alert severity="error" role="alert">
        {t("survey.edit.notMade")}
        <Box component="span" sx={{ display: "block", mt: 0.5 }}>
          {words}
        </Box>
      </Alert>
    );
  }
  if (error instanceof ApiError && error.status === 400 && error.reason) {
    return (
      <Alert severity="error" role="alert">
        {t("survey.edit.notMade")}
        <Box component="span" sx={{ display: "block", mt: 0.5 }}>
          {t("survey.edit.serverReason", { reason: error.reason })}
        </Box>
      </Alert>
    );
  }
  return <ErrorAlert error={error} />;
}

/**
 * Setup › Survey form: the project's survey as the people collecting meet it, page by page, read from the project
 * file (docs/plans/2026-11-18-survey-designer.md, stages 1 and 2); its words changed here, in any of its languages.
 */
export function SurveyDesignCards({ projectId }: { projectId: string }) {
  const t = useT();
  const { language: uiLanguage } = useApp();
  const [editing, setEditing] = useState(false);
  // While the survey is edited it is read again only when the coordinator says (a connection back is no reason)
  const loaded = useLoad(["project", projectId, "getSurveyDesign"], () => getSurveyDesign(projectId), { refetchOnReconnect: !editing });
  const answer = loaded.data;
  const [store] = useState(() => new PendingTexts());
  const [drafts] = useState(() => new Drafts());
  const [added, setAdded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<SurveyProblem[] | null>(null);
  /** The survey changed meanwhile: the change refused with it, to offer again */
  const [stale, setStale] = useState<Retry | null>(null);
  const [retry, setRetry] = useState<Offer | null>(null);
  const [saved, setSaved] = useState(false);
  /** The survey was replaced under the editor (a new project file): the changes not saved were dropped */
  const [replaced, setReplaced] = useState(false);
  /** Someone else saved the survey meanwhile, read without asking (the texts typed kept): how many texts were dropped */
  const [othersSaved, setOthersSaved] = useState<number | null>(null);
  /** Texts typed for what is no longer there, dropped (it was deleted here or by someone else) */
  const [droppedTexts, setDroppedTexts] = useState(0);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<PendingChange | null>(null);
  const [questionFor, setQuestionFor] = useState<{ page?: string; table?: number } | null>(null);
  const [tableFor, setTableFor] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [preview, setPreview] = useState<Words | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [textsRead, setTextsRead] = useState<
    | { count: number; languages: string[]; unknown: number; samples: Array<{ before: string; after: string }>; windows: boolean }
    | { unreadable: true }
    | null
  >(null);
  // The plots of an earlier survey: read apart (every record's answers), again for each revision of the survey
  const older = useLoad(["project", projectId, "getSurveyOlder", answer?.revision ?? null], () =>
    answer?.design ? getSurveyOlder(projectId).catch(() => null) : Promise.resolve(null),
  );
  const check = useMemo(() => (answer?.design ? (input: ExpressionCheckInput) => checkSurveyExpression(projectId, input) : null), [answer?.design, projectId]);
  // The AI assistant's help, when it is switched on for the project (never in the dashboard inside Collect Earth)
  const ai = useLoad(["project", projectId, "SurveyDesign.ai", answer?.editable === true], () =>
    answer?.editable ? getProjectAi(projectId).catch(() => null) : Promise.resolve(null),
  );
  const help = useMemo<SurveyHelp | null>(
    () => (ai.data?.enabled && ai.data.available ? { ask: (input) => getSurveyHelp(projectId, input), language: uiLanguage } : null),
    [ai.data, projectId, uiLanguage],
  );
  // The languages added and not saved yet are shown as the survey's, for their texts to be written
  const design = useMemo<SurveyDesign | null>(() => {
    const d = answer?.design ?? null;
    return d && added.length > 0 ? { ...d, languages: [...d.languages, ...added.filter((l) => !d.languages.includes(l))] } : d;
  }, [answer, added]);
  // The survey's language shown, the same in every card: the dashboard's when the survey has it, else its first
  const [chosen, setChosen] = useState<string | null>(null);
  const language = design ? (chosen && design.languages.includes(chosen) ? chosen : firstLanguage(design, uiLanguage)) : "";
  const w = useMemo(() => (design ? words(design, language, t) : null), [design, language, t]);
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
  const users = useMemo(() => (design ? questionUsers(design) : new Map<string, string[]>()), [design]);
  const textsTyped = useHasPendingTexts(store);
  const draftsOpen = useSyncExternalStore(drafts.subscribe, drafts.size);
  const unsaved = editing && (textsTyped || added.length > 0 || draftsOpen > 0);

  // What the callbacks below read when they run, not when they were made (the fields keep the same ones)
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const addedRef = useRef(added);
  addedRef.current = added;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const busyRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  /** "Edit the survey" pressed: the keyboard goes to the first field once it shows */
  const focusFirst = useRef(false);

  // The survey the changes are made on: a revision this page did not save itself is someone else's save, or a new file
  const knownRevision = useRef<string | null | undefined>(undefined);
  const knownDesign = useRef<SurveyDesign | null>(null);
  /** After "Read it again": the survey read next is taken, the changes kept, from this revision */
  const acceptFrom = useRef<string | null | undefined>(undefined);
  /** The change refused as stale, offered again once the survey is read again */
  const retryAfterRead = useRef<Retry | null>(null);

  /** The texts and languages typed, settled on the survey as it is now: what is no longer there dropped, and said */
  const settleOn = (d: SurveyDesign, dropped = 0) => {
    const gone = dropped + store.settle(d);
    setAdded((before) => before.filter((l) => !d.languages.includes(l)));
    if (gone > 0) setDroppedTexts((n) => n + gone);
    return gone;
  };

  /** Everything not saved dropped: the survey it was typed on is no longer the project's */
  const dropAll = () => {
    const dropped = changedTexts(store.all()).length > 0 || addedRef.current.length > 0;
    store.clear();
    setAdded([]);
    setEditing(false);
    setStale(null);
    setRetry(null);
    setRefused(null);
    setError(null);
    setSaved(false);
    setOthersSaved(null);
    setDroppedTexts(0);
    if (dropped) setReplaced(true);
  };

  useEffect(() => {
    if (!answer) return;
    const known = knownRevision.current;
    const before = knownDesign.current;
    knownRevision.current = answer.revision;
    knownDesign.current = answer.design;
    if (known === undefined || known === answer.revision) return;
    if (acceptFrom.current !== undefined && acceptFrom.current === known) {
      // Read again on purpose: the texts typed stay; the change refused is offered again as it can be made now
      acceptFrom.current = undefined;
      if (answer.design) settleOn(answer.design);
      const r = retryAfterRead.current;
      retryAfterRead.current = null;
      if (r) setRetry({ ops: r.design && answer.design ? rebaseChange(r.ops, r.design, answer.design) : null, what: r.what });
      return;
    }
    // Read without asking (the page opened again, a connection back): someone else's save, or another survey
    const typed = changedTexts(store.all()).length > 0 || addedRef.current.length > 0;
    if (!editingRef.current || !typed) return;
    const next = answer.design;
    // The server says who wrote the survey: another coordinator's save keeps the texts typed (those whose question is
    // gone are dropped); a new project file (or the server's change) replaces the survey under them
    const other = !next || !before || answer.writtenBy !== "designer" || !sameSurvey(before, next);
    if (other || !next) dropAll();
    else setOthersSaved(settleOn(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, store, projectId]);

  // Changes not saved: the browser asks before closing or reloading the page, the dashboard before moving elsewhere
  useUnsaved("survey-design", t("survey.title"), unsaved);
  useEffect(() => {
    if (!unsaved) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    setLeaveGuard((path) => {
      setLeaving(path);
      return false;
    });
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      setLeaveGuard(null);
    };
  }, [unsaved]);

  // "Saved" shows a moment in the bar while editing
  useEffect(() => {
    if (!saved || !editing) return;
    const timer = setTimeout(() => setSaved(false), 6000);
    return () => clearTimeout(timer);
  }, [saved, editing]);

  // "Edit the survey" goes away when pressed: the keyboard goes on to the survey's first field
  useEffect(() => {
    if (!editing || !focusFirst.current) return;
    focusFirst.current = false;
    sectionRef.current?.querySelector<HTMLElement>("input[type=text]:not([disabled]), textarea:not([aria-hidden])")?.focus();
  }, [editing]);

  /** The texts as a spreadsheet, in the survey's languages */
  const downloadTexts = (d: SurveyDesign) => {
    const url = URL.createObjectURL(csvBlob(textsCsv(d, t)));
    const a = document.createElement("a");
    a.href = url;
    a.download = "survey-texts.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** A spreadsheet of texts read back: its changes pending as if typed, its new languages added */
  const readTexts = (d: SurveyDesign, bytes: Uint8Array) => {
    const decoded = decodeTexts(bytes);
    if (!decoded) {
      setTextsRead({ unreadable: true });
      return;
    }
    const result = importTexts(d, decoded.text);
    if (result.newLanguages.length > 0) setAdded((before) => [...before, ...result.newLanguages.filter((l) => !before.includes(l))]);
    store.set(...result.changes);
    setSaved(false);
    setTextsRead({
      count: result.changes.length,
      languages: result.newLanguages,
      unknown: result.unknown,
      samples: result.changes.slice(0, 3).map((c) => ({ before: c.current, after: c.text })),
      windows: decoded.encoding === "windows-1252",
    });
  };

  const discard = () => {
    store.clear();
    setAdded([]);
    setRefused(null);
    setStale(null);
    setRetry(null);
    setError(null);
    setOthersSaved(null);
    setDroppedTexts(0);
    setTextsRead(null);
    setEditing(false);
  };

  const afterChange = (next: SurveyDesignAnswer) => {
    knownRevision.current = next.revision;
    knownDesign.current = next.design;
    loaded.setData(next);
    void queryClient.invalidateQueries({ queryKey: ["project", projectId, "listSurveyVersions"] });
  };

  /** Shows in the bar how a change ended; `retryWith`, a change of the questions refused as stale, to offer again */
  const report = (outcome: Outcome, retryWith?: Retry) => {
    if (outcome.kind === "stale") setStale(retryWith ?? { ops: [], design: null });
    else if (outcome.kind === "refused") setRefused(outcome.problems);
    else if (outcome.kind === "error") setError(outcome.error);
  };

  const outcomeOf = (err: unknown): Outcome =>
    err instanceof ApiError && err.code === "stale"
      ? { kind: "stale" }
      : err instanceof ApiError && err.code === "survey_problems"
        ? { kind: "refused", problems: (err.details.problems as SurveyProblem[] | undefined) ?? [] }
        : { kind: "error", error: err };

  /** Before a save: the bar says it is on its way, and what it said of the last one goes */
  const starting = () => {
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setRefused(null);
    setStale(null);
    setRetry(null);
    setSaved(false);
  };

  /**
   * Saves the texts typed so far (Save). Only the texts sent leave the pending ones, when they still read as sent: one
   * typed while the save was on its way stays.
   */
  const saveTexts = async (): Promise<Outcome> => {
    const current = answerRef.current;
    const languages = addedRef.current;
    const texts = changedTexts(store.all());
    const all = operationsOf(store.all(), languages);
    if (!current?.revision || all.length === 0 || busyRef.current) return { kind: "cancelled" };
    starting();
    try {
      const next = await saveSurveyChanges(projectId, { revision: current.revision, operations: all });
      afterChange(next);
      if (next.design) {
        const gone = store.settle(next.design, texts);
        if (gone > 0) setDroppedTexts((n) => n + gone);
      }
      setAdded((before) => before.filter((l) => !languages.includes(l)));
      setSaved(true);
      setTextsRead(null);
      setOthersSaved(null);
      return { kind: "saved" };
    } catch (err) {
      return outcomeOf(err);
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  /**
   * Saves a change of the questions on its own: the texts typed stay pending (Discard still undoes them). A language
   * added and not saved goes with it only when the change writes a text in it.
   */
  const saveChange = async (ops: SurveyOperation[]): Promise<Outcome> => {
    const current = answerRef.current;
    if (!current?.revision || ops.length === 0 || busyRef.current) return { kind: "cancelled" };
    const used = languagesUsed(ops);
    const languages = addedRef.current.filter((l) => used.has(l));
    starting();
    try {
      const next = await saveSurveyChanges(projectId, { revision: current.revision, operations: [...operationsOf(new Map(), languages), ...ops] });
      afterChange(next);
      // A rule deleted takes its texts typed; those of the rules after it follow them
      const moved = store.afterOps(ops);
      if (next.design) settleOn(next.design, moved);
      setAdded((before) => before.filter((l) => !languages.includes(l)));
      setSaved(true);
      return { kind: "saved" };
    } catch (err) {
      return outcomeOf(err);
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  /** A change of the questions: what it does to the plots collected first, asked about when it touches them */
  const change = async (ops: SurveyOperation[], what?: string): Promise<Outcome> => {
    if (busyRef.current) return { kind: "cancelled" };
    starting();
    let impact: SurveyImpactAnswer;
    try {
      // The languages added and not saved yet come first: the new texts may be in them
      impact = await getSurveyImpact(projectId, [...operationsOf(new Map(), addedRef.current), ...ops]);
    } catch (err) {
      return { kind: "error", error: err };
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
    if (impact.effects.length > 0 || what !== undefined) {
      const yes = await new Promise<boolean>((resolve) => setConfirm({ ops, impact, what, answer: resolve }));
      if (!yes) return { kind: "cancelled" };
    }
    return saveChange(ops);
  };

  /** A change made from the survey's tools: how it ended shown in the bar, a stale one offered again */
  const changeHere = async (ops: SurveyOperation[], what?: string) => {
    const restore = keepFocus();
    const made = answerRef.current?.design ?? null;
    report(await change(ops, what), { ops, what, design: made });
    restore();
  };

  /** What a dialog shows when its change was not saved (it stays open with what was typed) */
  const problemOf = (outcome: Outcome): ReactNode =>
    outcome.kind === "stale" ? (
      <StaleAlert onReadAgain={readAgain} dialog />
    ) : outcome.kind === "refused" && w ? (
      <Problems w={w} problems={outcome.problems} title={t("survey.edit.refused")} />
    ) : outcome.kind === "error" ? (
      <ChangeError error={outcome.error} />
    ) : null;
  const addResult = async (outcome: Promise<Outcome>): Promise<AddResult> => {
    const o = await outcome;
    return { saved: o.kind === "saved", problem: problemOf(o) };
  };

  /** The survey read again after someone else's change: the texts typed stay, to be saved on top of it */
  const readAgain = () => {
    acceptFrom.current = answerRef.current?.revision ?? null;
    retryAfterRead.current = stale && stale.ops.length > 0 ? stale : null;
    setStale(null);
    setOthersSaved(null);
    loaded.reload();
  };

  // The actions the fields call, the same ones from render to render (they read the refs above)
  const actions = useRef({ changeHere, change, setQuestionFor, setTableFor, addResult });
  actions.current = { changeHere, change, setQuestionFor, setTableFor, addResult };
  const edit = useMemo<Editing | null>(
    () =>
      editing && design
        ? {
            language,
            languageName: names(language),
            manyLanguages: design.languages.length > 1,
            firstLanguage: design.languages[0],
            firstLanguageName: names(design.languages[0]),
            set: (target, part, text, current, anchor) => store.set({ target, part, language, text, current, ...(anchor !== undefined ? { anchor } : {}) }),
            change: (ops, what) => void actions.current.changeHere(ops, what),
            submit: (ops, what) => actions.current.addResult(actions.current.change(ops, what)),
            busy: saving,
            pages: design.pageOrder
              .map((name) => design.pages.find((p) => p.name === name) ?? design.emptyPages.find((p) => p.name === name))
              .filter((p) => p !== undefined)
              .map((p) => ({ name: p.name, label: textIn(p.label, language, design.languages) || t("survey.noLabel") })),
            addQuestion: (where) => actions.current.setQuestionFor(where),
            addTable: (page) => actions.current.setTableFor(page),
            users,
          }
        : null,
    [editing, design, language, names, saving, store, t, users],
  );
  const addLanguage = useCallback(() => setAdding(true), []);

  const reach =
    answer && answer.peopleWithFile > 0 ? t("survey.edit.reach", { count: answer.peopleWithFile }) : t("survey.edit.reachNone");

  return (
    <ExpressionCheckContext.Provider value={check}>
    <HelpContext.Provider value={help}>
    <PendingContext.Provider value={store}>
    <DraftContext.Provider value={drafts}>
    <EditContext.Provider value={edit}>
      <Paper ref={sectionRef} variant="outlined" component="section" aria-labelledby="survey-design-title" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h2" id="survey-design-title" gutterBottom>
            {t("survey.title")}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            {w && w.design.pages.length > 0 && (
              <Button
                variant="outlined"
                startIcon={<VisibilityOutlined />}
                // The form as it reads with the texts typed and not saved yet
                onClick={() => setPreview(words(withPendingTexts(w.design, changedTexts(store.all())), w.language, t))}
              >
                {t("survey.preview.open")}
              </Button>
            )}
            {answer?.editable && design && !editing && (
              <Button
                variant="outlined"
                startIcon={<EditOutlined />}
                onClick={() => {
                  setReplaced(false);
                  focusFirst.current = true;
                  setEditing(true);
                }}
              >
                {t("survey.edit.start")}
              </Button>
            )}
          </Stack>
        </Stack>
        <Explain sx={{ mb: 2 }} text={t("survey.explain.short")} more={t("survey.explain")} />
        {loaded.error ? (
          <ErrorAlert error={loaded.error} onRetry={loaded.reload} />
        ) : !answer ? (
          <Loading />
        ) : answer.unreadable ? (
          <Alert severity="warning">{t("survey.unreadable")}</Alert>
        ) : !w && answer.editable ? (
          <NewSurvey
            projectId={projectId}
            language={uiLanguage}
            names={names}
            onMade={(made) => {
              knownRevision.current = made.revision;
              knownDesign.current = made.design;
              loaded.setData(made);
              // The project's other screens (setup, plots, round) read the new project file
              void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
              setEditing(true);
            }}
          />
        ) : !w ? (
          <Alert severity="info">{t("survey.none")}</Alert>
        ) : (
          <Stack spacing={2}>
            {answer.problems.length > 0 && <Problems w={w} problems={answer.problems} />}
            {replaced && (
              <Alert severity="warning" role="alert" onClose={() => setReplaced(false)}>
                {t("survey.edit.replaced")}
              </Alert>
            )}
            {(older.data?.plots ?? 0) > 0 && (
              <Alert severity="info">{t("survey.olderSurveyPlots", { count: older.data!.plots })}</Alert>
            )}
            {editing && (
              <Alert severity="info" icon={<EditOutlined />}>
                {t("survey.edit.explain")}
                <Box sx={{ mt: 1 }}>{reach}</Box>
                <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: "wrap" }}>
                  {help && (
                    <Button size="small" variant="outlined" startIcon={<AutoAwesome />} disabled={saving} onClick={() => setSuggesting(true)}>
                      {t("survey.help.suggest")}
                    </Button>
                  )}
                  <Button size="small" variant="outlined" startIcon={<Download />} onClick={() => design && downloadTexts(design)}>
                    {t("survey.texts.download")}
                  </Button>
                  <Button size="small" variant="outlined" component="label" startIcon={<Upload />} disabled={saving}>
                    {t("survey.texts.upload")}
                    <input
                      hidden
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file && design) void file.arrayBuffer().then((bytes) => readTexts(design, new Uint8Array(bytes)));
                      }}
                    />
                  </Button>
                </Stack>
                {textsRead && "unreadable" in textsRead ? (
                  <Alert severity="error" sx={{ mt: 1 }} onClose={() => setTextsRead(null)}>
                    {t("survey.texts.unreadable")}
                  </Alert>
                ) : textsRead ? (
                  <Alert severity={textsRead.count > 0 ? "success" : "info"} sx={{ mt: 1 }} onClose={() => setTextsRead(null)}>
                    {textsRead.count > 0 ? t("survey.texts.read", { count: textsRead.count }) : t("survey.texts.none")}
                    {textsRead.samples.length > 0 && (
                      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                        {textsRead.samples.map((s, i) => (
                          <Typography component="li" variant="body2" key={i} sx={{ overflowWrap: "anywhere" }}>
                            {t("survey.texts.sample", { before: s.before || "—", after: s.after })}
                          </Typography>
                        ))}
                      </Box>
                    )}
                    {textsRead.windows && textsRead.count > 0 && <Box>{t("survey.texts.windows")}</Box>}
                    {textsRead.languages.length > 0 && <Box>{t("survey.texts.added", { languages: textsRead.languages.map(names).join(", ") })}</Box>}
                    {textsRead.unknown > 0 && <Box>{t("survey.texts.unknown", { count: textsRead.unknown })}</Box>}
                  </Alert>
                ) : null}
              </Alert>
            )}
            {saved && !editing && (
              <Alert severity="success" role="status" onClose={() => setSaved(false)}>
                {t("survey.edit.saved")}
              </Alert>
            )}
            <DesignView w={w} onLanguage={setChosen} addLanguage={editing ? addLanguage : undefined} />
            {editing && (
              <ChangeBar
                design={w.design}
                added={added}
                saving={saving}
                saved={saved}
                onSave={() =>
                  void (async () => {
                    const restore = keepFocus();
                    report(await saveTexts());
                    restore();
                  })()
                }
                onDiscard={discard}
              >
                {stale && (
                  <Box sx={{ flexBasis: "100%" }}>
                    <StaleAlert onReadAgain={readAgain} change={stale.ops.length > 0} />
                  </Box>
                )}
                {retry && retry.ops !== null && (
                  <Alert
                    severity="info"
                    sx={{ flexBasis: "100%" }}
                    action={
                      <Stack direction="row" spacing={1}>
                        <Button
                          color="inherit"
                          size="small"
                          disabled={saving}
                          onClick={() => {
                            const again = retry;
                            setRetry(null);
                            if (again.ops) void changeHere(again.ops, again.what);
                          }}
                        >
                          {t("survey.edit.retryDo")}
                        </Button>
                        <Button color="inherit" size="small" onClick={() => setRetry(null)}>
                          {t("survey.edit.retryForget")}
                        </Button>
                      </Stack>
                    }
                  >
                    {t("survey.edit.retry")}
                  </Alert>
                )}
                {retry && retry.ops === null && (
                  <Alert severity="info" sx={{ flexBasis: "100%" }} onClose={() => setRetry(null)}>
                    {t("survey.edit.retryCannot")}
                  </Alert>
                )}
                {othersSaved !== null && (
                  <Alert severity="info" sx={{ flexBasis: "100%" }} onClose={() => setOthersSaved(null)}>
                    {t("survey.edit.othersSaved")}
                  </Alert>
                )}
                {droppedTexts > 0 && (
                  <Alert severity="warning" sx={{ flexBasis: "100%" }} onClose={() => setDroppedTexts(0)}>
                    {t("survey.edit.droppedTexts", { count: droppedTexts })}
                  </Alert>
                )}
                {refused && (
                  <Box sx={{ flexBasis: "100%" }}>
                    <Problems w={w} problems={refused} title={t("survey.edit.refused")} />
                  </Box>
                )}
                {error !== null && (
                  <Box sx={{ flexBasis: "100%" }}>
                    <ChangeError error={error} />
                  </Box>
                )}
              </ChangeBar>
            )}
          </Stack>
        )}
      </Paper>
      {w && <DesignCards w={w} />}
      {answer?.editable && answer.design && (
        <VersionsCard
          projectId={projectId}
          revision={answer.revision}
          disabled={unsaved}
          onRestored={afterChange}
          onStale={() => {
            // Nothing typed (bringing back waits for that): the survey read again as someone else left it
            acceptFrom.current = answerRef.current?.revision ?? null;
            loaded.reload();
          }}
        />
      )}
      {w && questionFor !== null && (
        // A new dialog each time: nothing of the last question stays in it
        <AddQuestionDialog
          key={JSON.stringify(questionFor)}
          w={w}
          where={questionFor}
          onClose={() => setQuestionFor(null)}
          onAdd={(ops) => addResult(change(ops))}
        />
      )}
      {preview && <SurveyPreview w={preview} onClose={() => setPreview(null)} />}
      {w && suggesting && (
        <SuggestRulesDialog
          w={w}
          onClose={() => setSuggesting(false)}
          // Each was tried on the plots collected already: saved without asking again
          onAdd={(ops) => addResult(saveChange(ops))}
        />
      )}
      {w && tableFor !== null && (
        <AddTableDialog key={tableFor} w={w} page={tableFor} onClose={() => setTableFor(null)} onAdd={(ops) => addResult(change(ops))} />
      )}
      {w && (
        <ConfirmChangeDialog
          w={w}
          pending={confirm}
          busy={saving}
          onCancel={() => {
            confirm?.answer(false);
            setConfirm(null);
          }}
          onConfirm={() => {
            confirm?.answer(true);
            setConfirm(null);
          }}
        />
      )}
      {design && (
        <AddLanguageDialog
          open={adding}
          present={design.languages}
          names={names}
          onClose={() => setAdding(false)}
          onAdd={(code) => {
            setAdding(false);
            setAdded((before) => [...before, code]);
            setChosen(code);
          }}
        />
      )}
      <Dialog open={leaving !== null} onClose={() => setLeaving(null)} aria-labelledby="survey-leave-title">
        <DialogTitle id="survey-leave-title">{t("server.leaveTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("survey.edit.leaveText")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaving(null)} autoFocus>{t("server.leaveStay")}</Button>
          <Button
            color="error"
            onClick={() => {
              const path = leaving;
              setLeaving(null);
              discard();
              setUnsaved("survey-design", t("survey.title"), false);
              setLeaveGuard(null);
              if (path) navigate(path);
            }}
          >
            {t("server.leaveGo")}
          </Button>
        </DialogActions>
      </Dialog>
    </EditContext.Provider>
    </DraftContext.Provider>
    </PendingContext.Provider>
    </HelpContext.Provider>
    </ExpressionCheckContext.Provider>
  );
}

/** "Someone else changed the survey": read it again, the texts typed staying */
function StaleAlert({ onReadAgain, change = false, dialog = false }: { onReadAgain: () => void; change?: boolean; dialog?: boolean }) {
  const t = useT();
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onReadAgain}>
          {t("survey.edit.readAgain")}
        </Button>
      }
    >
      {t("survey.edit.stale")}
      {change && <Box>{t("survey.edit.staleChange")}</Box>}
      {dialog && <Box>{t("survey.edit.staleDialog")}</Box>}
    </Alert>
  );
}

/**
 * The bar under the survey while it is edited: the changes not saved, Discard (asked first) or Done, Save, and how
 * the last save went. It follows the texts typed itself, so typing re-renders it and the field only.
 */
function ChangeBar({ design, added, saving, saved, onSave, onDiscard, children }: {
  design: SurveyDesign;
  added: readonly string[];
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onDiscard: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const store = useContext(PendingContext);
  const texts = useSyncExternalStore(store ? store.subscribe : noSubscribe, () => store?.all() ?? EMPTY);
  const count = useMemo(() => operationsOf(texts, added).length, [texts, added]);
  const tooLong = useMemo(() => changedTexts(texts).filter((p) => p.text.trim().length > MAX_TEXT).length, [texts]);
  const nameless = useMemo(() => namesEmptied(texts, design), [texts, design]);
  const [asking, setAsking] = useState(false);
  return (
    <Paper
      elevation={3}
      sx={{ position: "sticky", bottom: { xs: 8, sm: 16 }, zIndex: 2, p: { xs: 1, sm: 2 }, display: "flex", flexWrap: "wrap", alignItems: "center", gap: { xs: 1, sm: 1.5 } }}
    >
      {/* On a phone one short line: what is not saved, then the two buttons */}
      <Typography sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1, typography: { xs: "body2", sm: "body1" } }} role="status">
        {saving ? (
          <>
            <CircularProgress size={16} aria-hidden />
            {t("survey.edit.saving")}
          </>
        ) : count > 0 ? (
          t("survey.edit.pending", { count })
        ) : saved ? (
          <>
            <CheckCircleOutline color="success" fontSize="small" aria-hidden />
            {t("survey.edit.savedShort")}
          </>
        ) : (
          t("survey.edit.none")
        )}
      </Typography>
      <Button size="small" onClick={() => (count > 0 ? setAsking(true) : onDiscard())} disabled={saving} sx={{ minWidth: 0 }}>
        {count > 0 ? t("survey.edit.discard") : t("survey.edit.done")}
      </Button>
      <Button size="small" variant="contained" onClick={onSave} disabled={saving || count === 0 || tooLong > 0 || nameless > 0}>
        {t("survey.edit.save")}
      </Button>
      {nameless > 0 && (
        <Typography variant="body2" color="error" sx={{ flexBasis: "100%" }}>
          {t("survey.edit.pageNameNeeded")}
        </Typography>
      )}
      {tooLong > 0 && (
        <Typography variant="body2" color="error" sx={{ flexBasis: "100%" }}>
          {t("survey.edit.tooLong", { count: tooLong, max: MAX_TEXT.toLocaleString() })}
        </Typography>
      )}
      {children}
      <Dialog open={asking} onClose={() => setAsking(false)} aria-labelledby="survey-discard-title" maxWidth="xs" fullWidth>
        <DialogTitle id="survey-discard-title">{t("survey.edit.discardTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("survey.edit.discardText", { count })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(false)} autoFocus>{t("common.cancel")}</Button>
          <Button color="error" variant="contained" onClick={() => { setAsking(false); onDiscard(); }}>
            {t("survey.edit.discard")}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

const EMPTY: ReadonlyMap<string, PendingText> = new Map();

/**
 * A text of the survey: as it reads, or, while the words are changed, a field with it in the language chosen (the
 * survey's first language's under it when this is another)
 */
function Words({ target, part, value, label, multiline = false, anchor, keepOne = false, children }: {
  target: WordTarget;
  part: WordPart;
  /** The text in each language */
  value: Record<string, string>;
  label: string;
  multiline?: boolean;
  /** A rule's message: the rule (ruleAnchor), for the text to follow it */
  anchor?: string;
  /** A page's name: it keeps one in at least one language */
  keepOne?: boolean;
  children: ReactNode;
}) {
  const edit = useContext(EditContext);
  const t = useT();
  const kept = usePendingText(edit ? editKey(target, part, edit.language) : null);
  if (!edit) return <>{children}</>;
  const current = value[edit.language] ?? "";
  const first = edit.language !== edit.firstLanguage ? (value[edit.firstLanguage] ?? "") : "";
  const text = kept ? kept.text : current;
  // Longer than the survey takes: said (not cut, a paste would lose its end without a word), and Save waits
  const tooLong = text.trim().length > MAX_TEXT;
  const nameless = keepOne && text.trim() === "" && Object.entries(value).every(([l, v]) => l === edit.language || v.trim() === "");
  return (
    <TextField
      size="small"
      fullWidth
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      label={label}
      value={text}
      onChange={(e) => edit.set(target, part, e.target.value, current, anchor)}
      error={tooLong || nameless}
      helperText={
        nameless
          ? t("survey.edit.pageNameNeeded")
          : tooLong
          ? t("survey.edit.textTooLong", { count: text.trim().length.toLocaleString(), max: MAX_TEXT.toLocaleString() })
          : first
            ? t("survey.edit.inFirst", { language: edit.firstLanguageName, text: first })
            : undefined
      }
      slotProps={{ htmlInput: { lang: edit.language }, formHelperText: { sx: { whiteSpace: "pre-line" } } }}
      sx={{ my: 0.5 }}
    />
  );
}

/** The survey's title, its languages and its pages (memo: typing re-renders the field, not the survey around it) */
const DesignView = memo(function DesignView({ w, onLanguage, addLanguage }: { w: Words; onLanguage: (language: string) => void; addLanguage?: () => void }) {
  const { design, language, t } = w;
  const { language: uiLanguage } = useApp();
  const missing = useMemo(() => untranslated(design, language), [design, language]);
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
  const edit = useContext(EditContext);
  const [addingPage, setAddingPage] = useState(false);
  const questions = design.pages.reduce((n, p) => n + p.items.reduce((m, i) => m + (i.kind === "table" ? i.columns.length : 1), 0), 0);

  return (
    <Stack spacing={2}>
      <Box>
        <Words target={{ kind: "title" }} part="label" value={design.title} label={t("survey.edit.title")}>
          <Typography sx={{ fontWeight: 600 }}>{textIn(design.title, language, design.languages) || t("survey.noLabel")}</Typography>
        </Words>
        <Typography color="text.secondary">{t("survey.counts", { pages: design.pages.length, questions, lists: design.lists.length })}</Typography>
      </Box>
      {(design.languages.length > 1 || addLanguage) && (
        <Box>
          <Typography variant="body2" id="survey-language" sx={{ mb: 0.5 }}>
            {t("survey.language")}
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={language}
            onChange={(_, v: string | null) => v && onLanguage(v)}
            aria-labelledby="survey-language"
            sx={{ flexWrap: "wrap" }}
          >
            {design.languages.map((l) => (
              <ToggleButton key={l} value={l} lang={l}>
                {names(l)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {addLanguage && (
            <Button size="small" startIcon={<Translate />} onClick={addLanguage} sx={{ ml: 1, verticalAlign: "top" }}>
              {t("survey.edit.addLanguage")}
            </Button>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} role="status">
            {missing > 0 ? t("survey.untranslated", { count: missing }) : t("survey.allTranslated")}
          </Typography>
        </Box>
      )}
      <Stack spacing={1.5} lang={language}>
        {shownPages(design, edit !== null).map((page, i, all) => (
          <PageView key={page.name} w={w} page={page} defaultOpen={i === 0 || page.empty === true} order={all.map((p) => p.name)} />
        ))}
      </Stack>
      {edit && (
        <Box>
          <Button startIcon={<Add />} onClick={() => setAddingPage(true)} disabled={edit.busy}>
            {t("survey.edit.addPage")}
          </Button>
          {addingPage && (
            <NameDialog
              title={t("survey.edit.addPage")}
              label={t("survey.edit.page")}
              onClose={() => setAddingPage(false)}
              onDone={(text) => edit.submit([{ op: "addPage", label: { [language]: text } }])}
            />
          )}
        </Box>
      )}
    </Stack>
  );
});

/** The pages shown: those with questions, and while the survey is edited the empty ones too, in the form's order */
function shownPages(design: SurveyDesign, editing: boolean): Array<DesignPage & { empty?: boolean; deletable?: boolean }> {
  if (!editing) return design.pages;
  return design.pageOrder
    .map((name) => {
      const empty = design.emptyPages.find((p) => p.name === name);
      return design.pages.find((p) => p.name === name) ?? (empty ? { ...empty, items: [], empty: true } : undefined);
    })
    .filter((p): p is DesignPage & { empty?: boolean; deletable?: boolean } => p !== undefined);
}

/** What the form fills itself, the hidden fields and the lists: folded cards under the survey */
const DesignCards = memo(function DesignCards({ w }: { w: Words }) {
  const { design, language, t } = w;
  const edit = useContext(EditContext);
  const [addingList, setAddingList] = useState(false);
  return (
    <>
      {design.fromPlotFile.length > 0 && (
        <FoldingCard keepFolded lazy title={t("survey.fromPlotFile.title")} summary={t("survey.fromPlotFile.summary", { count: design.fromPlotFile.length })}>
          <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.fromPlotFile.explain")} />
          <QuestionList w={w} questions={design.fromPlotFile} />
        </FoldingCard>
      )}
      {design.calculated.length > 0 && (
        <FoldingCard
          keepFolded
          lazy
          title={t("survey.calculated.title")}
          summary={t("survey.calculated.summary", { count: design.calculated.length, formulas: design.counts.formulas })}
        >
          <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.calculated.explain")} />
          <QuestionList w={w} questions={design.calculated} />
        </FoldingCard>
      )}
      <FoldingCard keepFolded lazy title={t("survey.hidden.title")} summary={t("survey.hidden.summary", { count: design.hidden.length })}>
        <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.hidden.explain")} />
        <QuestionList w={w} questions={design.hidden} />
      </FoldingCard>
      <FoldingCard keepFolded lazy title={t("survey.lists.title")} summary={t("survey.lists.summary", { count: design.lists.length })}>
        <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.lists.explain")} />
        {edit && (
          <Box sx={{ mb: 2 }}>
            <Button startIcon={<Add />} variant="outlined" disabled={edit.busy} onClick={() => setAddingList(true)}>
              {t("survey.list.add")}
            </Button>
            {addingList && <AddListDialog w={w} onClose={() => setAddingList(false)} onAdd={(op) => edit.submit([op])} />}
          </Box>
        )}
        <Stack spacing={2} lang={language} data-focus-home>
          {design.lists.map((l) => (
            <ListView key={l.name} w={w} list={l} />
          ))}
        </Stack>
      </FoldingCard>
    </>
  );
});

/**
 * What Collect or Collect Earth would refuse in the survey (the server's survey check): for a project file made in
 * Collect's designer, which the people collecting would then fail to open
 */
function Problems({ w, problems, title }: { w: Words; problems: SurveyProblem[]; title?: string }) {
  const { t } = w;
  return (
    <Alert severity="warning" role="alert">
      <Typography sx={{ fontWeight: 600 }}>{title ?? t("survey.problems.title")}</Typography>
      {!title && <Typography variant="body2" sx={{ mb: 1 }}>{t("survey.problems.explain")}</Typography>}
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {problems.map((p, i) => {
          const name = p.node?.split("/").pop() ?? "";
          const question = w.questions.get(name);
          const label = (question && textIn(question.label, w.language, w.design.languages)) || name;
          return (
            <Typography component="li" variant="body2" key={i} sx={{ overflowWrap: "anywhere" }}>
              {p.node && p.node !== "plot" && <>{t("survey.problems.where", { question: label, name })} </>}
              {checkWords(t, p.code, p.values)}
              {p.expression && (
                <Box component="code" sx={{ display: "block", fontSize: "0.8125rem", color: "text.secondary" }}>
                  {p.expression}
                </Box>
              )}
              {p.beyondCollect && (
                <Typography component="span" variant="caption" sx={{ display: "block" }}>
                  {t("survey.problems.beyondCollect")}
                </Typography>
              )}
            </Typography>
          );
        })}
      </Box>
    </Alert>
  );
}

/** A page of the form, folding under its name */
function PageView({ w, page, defaultOpen, order }: { w: Words; page: DesignPage & { empty?: boolean; deletable?: boolean }; defaultOpen: boolean; order: string[] }) {
  const edit = useContext(EditContext);
  const [open, setOpen] = useState(defaultOpen);
  // Its questions are made once it is first opened: a long survey shows, and changes language, sooner
  const [opened, setOpened] = useState(defaultOpen);
  const id = useId();
  const label = textIn(page.label, w.language, w.design.languages) || w.t("survey.noLabel");
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }} data-focus-home>
      {/* The heading holds the button (not the other way round): a heading inside a button is no heading to a screen reader */}
      <Typography variant="h3" sx={{ m: 0 }}>
        <ButtonBase
          onClick={() => {
            setOpen(!open);
            setOpened(true);
          }}
          aria-expanded={open}
          aria-controls={`${id}-page`}
          sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", px: 2, py: 1.5, gap: 2, borderRadius: 1, font: "inherit" }}
        >
          <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
            {label}
          </Box>
          <ExpandMore aria-hidden sx={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none", color: "action.active" }} />
        </ButtonBase>
      </Typography>
      <Collapse in={open} id={`${id}-page`}>
        {(open || opened) && (
        <Stack spacing={2} sx={{ px: 2, pb: 2 }}>
          <Words target={{ kind: "page", name: page.name }} part="label" value={page.label} label={w.t("survey.edit.page")} keepOne>
            {null}
          </Words>
          {edit && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Button size="small" variant="outlined" startIcon={<Add />} disabled={edit.busy} onClick={() => edit.addQuestion({ page: page.name })}>
                {w.t("survey.edit.addQuestion")}
              </Button>
              <Button size="small" variant="outlined" startIcon={<Add />} disabled={edit.busy} onClick={() => edit.addTable(page.name)}>
                {w.t("survey.table.add")}
              </Button>
              <MoveButtons
                label={label}
                up={pageMoveTarget(order, page.name, -1)}
                down={pageMoveTarget(order, page.name, 1)}
                onMove={(to) => edit.change([{ op: "movePage", name: page.name, ...(to.before !== undefined ? { before: to.before as string } : {}) }])}
              />
              {page.empty && page.deletable && (
                <Button size="small" color="error" startIcon={<DeleteOutline />} disabled={edit.busy} onClick={() => edit.change([{ op: "deletePage", name: page.name }], label)}>
                  {w.t("survey.edit.deletePage")}
                </Button>
              )}
            </Stack>
          )}
          {page.empty && <Typography color="text.secondary">{w.t("survey.edit.emptyPage")}</Typography>}
          {page.items.map((item) =>
            item.kind === "table" ? (
              <TableView key={item.name} w={w} table={item} siblings={page.items} page={page.name} />
            ) : (
              <QuestionView key={item.name} w={w} q={item} siblings={page.items} page={page.name} />
            ),
          )}
        </Stack>
        )}
      </Collapse>
    </Box>
  );
}

function QuestionList({ w, questions }: { w: Words; questions: DesignQuestion[] }) {
  return (
    <Stack spacing={2} lang={w.language}>
      {questions.map((q) => (
        <QuestionView key={q.name} w={w} q={q} />
      ))}
    </Stack>
  );
}

/** A line under a question: what decides when it is shown, required, its rules */
function Detail({ children, tone }: { children: ReactNode; tone?: "warning" }) {
  return (
    <Typography variant="body2" color={tone === "warning" ? "warning.main" : "text.secondary"} sx={{ overflowWrap: "anywhere" }}>
      {children}
    </Typography>
  );
}

function QuestionView({ w, q, inTable, table, siblings, page }: {
  w: Words;
  q: DesignQuestion;
  inTable?: boolean;
  /** The table it is a column of */
  table?: DesignTable;
  /** The items of its page or table, for moving it among them; none for the lists of hidden fields */
  siblings?: readonly DesignItem[];
  page?: string;
}) {
  const { t } = w;
  const help = textIn(q.help, w.language, w.design.languages);
  const required = requiredWords(w, q);
  const list = q.list ? w.lists.get(q.list) : undefined;
  const edit = useContext(EditContext);
  // While editing, the Required choice of the tools says it already
  const requiredBox = edit !== null && siblings !== undefined && canRequire(q);
  const kinds = edit && siblings ? ruleKinds(q, table ?? null) : [];
  /** The rule dialog: a new rule, or the rule changed (found again by what it is when it is applied) */
  const [ruleOpen, setRuleOpen] = useState<{ index: number | null; anchor?: string } | null>(null);
  const [translating, setTranslating] = useState<{ index: number; anchor: string } | null>(null);
  const [editingFormulas, setEditingFormulas] = useState(false);
  const assistant = useContext(HelpContext);
  const candidates = useMemo(() => (ruleOpen ? conditionQuestions(w.design, table ?? null, null) : []), [ruleOpen, w.design, table]);
  const label = textIn(q.label, w.language, w.design.languages) || q.name;
  return (
    <Box data-question={q.name} data-focus-home
      sx={{ pl: 1.5, borderLeft: 3, borderColor: q.hidden || q.formulas ? "divider" : "primary.light", contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}>
      <Words target={{ kind: "node", id: q.id }} part="label" value={q.label} label={t("survey.edit.label")} multiline>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{label}</Typography>
      </Words>
      {siblings && <ItemTools w={w} item={q} siblings={siblings} page={page} table={table} />}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", my: 0.5 }}>
        <Chip size="small" label={t(TYPE_KEYS[q.type])} />
        {required && q.required === "always" && !requiredBox && <Chip size="small" color="primary" variant="outlined" label={required} />}
        {/* A table's key column gives its rows, said on the table already */}
        {q.key && !inTable && <Chip size="small" variant="outlined" label={t("survey.key")} />}
        {q.hidden && <Chip size="small" variant="outlined" label={t("survey.notShown")} />}
        {q.formulas && <Chip size="small" variant="outlined" label={t("survey.isCalculated")} />}
        {q.layout && <Chip size="small" variant="outlined" label={t(q.layout === "buttons" ? "survey.layout.buttons" : "survey.layout.dropdown")} />}
        {q.notExported && <Chip size="small" variant="outlined" label={t("survey.notExported")} />}
      </Stack>
      <Words target={{ kind: "node", id: q.id }} part="help" value={q.help} label={t("survey.edit.help")} multiline>
        {help && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere", mb: 0.5 }}>
            {help}
          </Typography>
        )}
      </Words>
      {q.shownWhen && q.shownWhen.kind !== "never" && <Detail>{t("survey.shownWhen", { condition: conditionWords(w, q.shownWhen) })}</Detail>}
      {q.shownWhen?.kind === "advanced" && <ExplainButton w={w} question={q.id} which="shownWhen" />}
      {required && q.required !== "always" && <Detail>{required}</Detail>}
      {typeof q.required === "object" && q.required.when.kind === "advanced" && <ExplainButton w={w} question={q.id} which="required" />}
      {q.parentQuestion && <Detail>{t("survey.subList", { question: textIn(w.questions.get(q.parentQuestion)?.label ?? {}, w.language, w.design.languages) || q.parentQuestion })}</Detail>}
      {list && !q.formulas && <Detail>{t("survey.answers", { items: answersText(w, list.items) })}</Detail>}
      {q.rules.map((r, i) => (
        <Box key={i}>
          <Detail tone={r.flag === "warning" ? "warning" : undefined}>
            {ruleWords(w, r)}
            {edit && siblings && kinds.length + q.rules.length > 0 && (
              <>
                {builderRule(r) && kinds.length > 0 && (
                  <ToolButton title={t("survey.logic.editRule")} label={`${t("survey.logic.editRule")}: ${ruleWords(w, r)}`} disabled={edit.busy} onClick={() => setRuleOpen({ index: i, anchor: ruleAnchor(r) })}>
                    <EditOutlined fontSize="small" />
                  </ToolButton>
                )}
                {assistant && w.design.languages.length > 1 && Object.values(r.message).some((m) => m) && (
                  <ToolButton title={t("survey.help.translate")} label={`${t("survey.help.translate")}: ${ruleWords(w, r)}`} disabled={edit.busy} onClick={() => setTranslating({ index: i, anchor: ruleAnchor(r) })}>
                    <Translate fontSize="small" />
                  </ToolButton>
                )}
                <ToolButton title={t("survey.logic.deleteRule")} label={`${t("survey.logic.deleteRule")}: ${ruleWords(w, r)}`} color="error" disabled={edit.busy}
                  onClick={() => edit.change([{ op: "deleteRule", id: q.id, index: i }], t("survey.logic.ruleWhat", { rule: `“${ruleWords(w, r)}”` }))}>
                  <DeleteOutline fontSize="small" />
                </ToolButton>
              </>
            )}
            <Words target={{ kind: "rule", node: q.id, index: i }} part="message" value={r.message} label={t("survey.edit.message")} multiline anchor={ruleAnchor(r)}>
              {textIn(r.message, w.language, w.design.languages) && ` — ${t("survey.rule.message", { message: textIn(r.message, w.language, w.design.languages) })}`}
            </Words>
          </Detail>
          {r.kind === "advanced" && <ExplainButton w={w} question={q.id} which="rule" index={i} />}
        </Box>
      ))}
      {edit && kinds.length > 0 && (
        <Box sx={{ my: 0.5 }}>
          <Button size="small" startIcon={<Add />} disabled={edit.busy} onClick={() => setRuleOpen({ index: null })}>
            {t("survey.logic.addRule")}
          </Button>
        </Box>
      )}
      {edit && translating !== null && q.rules[translating.index] && (
        <TranslateDialog
          w={w}
          message={q.rules[translating.index].message}
          onClose={() => setTranslating(null)}
          onApply={(texts) => {
            // The rule where it is now (someone else may have changed the rules meanwhile)
            const index = ruleIndexOf(q.rules, translating.anchor);
            if (index === null) return Promise.resolve({ saved: false, problem: <Alert severity="warning">{t("survey.logic.ruleGone")}</Alert> });
            const ops: SurveyOperation[] = Object.entries(texts).map(([language, text]) => ({ op: "setText", target: { kind: "rule", node: q.id, index }, part: "message", language, text }));
            return edit.submit(ops);
          }}
        />
      )}
      {edit && ruleOpen && (
        <RuleDialog
          w={w}
          q={q}
          rule={ruleOpen.index === null ? null : (q.rules[ruleOpen.index] ?? null)}
          kinds={kinds}
          candidates={candidates}
          onClose={() => setRuleOpen(null)}
          onApply={(rule) => {
            if (ruleOpen.anchor === undefined) return edit.submit([{ op: "addRule", id: q.id, rule }]);
            // The rule where it is now (someone else may have changed the rules meanwhile)
            const index = ruleIndexOf(q.rules, ruleOpen.anchor);
            if (index === null) return Promise.resolve({ saved: false, problem: <Alert severity="warning">{t("survey.logic.ruleGone")}</Alert> });
            return edit.submit([{ op: "setRule", id: q.id, index, rule }]);
          }}
        />
      )}
      {q.formulas && (
        <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 3, fontFamily: "monospace", fontSize: "0.8125rem", color: "text.secondary" }}>
          {q.formulas.map((f, i) => {
            const formula = f.expression ?? f.value ?? "";
            return (
              <li key={i} style={{ overflowWrap: "anywhere" }}>
                {f.when ? t("survey.formula.if", { formula, condition: f.when }) : formula}
                <Box component="span" sx={{ fontFamily: "body1.fontFamily" }}>
                  <ExplainButton w={w} question={q.id} which="formula" index={i} />
                </Box>
              </li>
            );
          })}
        </Box>
      )}
      {q.uses.length > 0 && <Detail>{t("survey.uses", { names: q.uses.join(", ") })}</Detail>}
      {edit && q.formulas && (
        <Box sx={{ my: 0.5 }}>
          <Button size="small" startIcon={<EditOutlined />} disabled={edit.busy} onClick={() => setEditingFormulas(true)}>
            {t("survey.formulas.edit")}
          </Button>
        </Box>
      )}
      {edit && editingFormulas && (
        <FormulasDialog
          w={w}
          q={q}
          onClose={() => setEditingFormulas(false)}
          onApply={(formulas) => edit.submit([{ op: "setFormulas", id: q.id, formulas }])}
        />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        {t("survey.name", { name: q.name })}
      </Typography>
    </Box>
  );
}

function TableView({ w: survey, table, siblings, page }: { w: Words; table: DesignTable; siblings: readonly DesignItem[]; page: string }) {
  const edit = useContext(EditContext);
  // A name the table's conditions use is its own column first, as the server reads them (another table may have one alike)
  const w = useMemo(() => tableWords(survey, table), [survey, table]);
  const { t } = w;
  const list = table.rowsList ? w.lists.get(table.rowsList) : undefined;
  const listName = list ? textIn(list.label, w.language, w.design.languages) || list.name : (table.rowsList ?? "");
  const kind =
    table.layout === "group"
      ? t("survey.table.group")
      : table.layout === "table"
        ? table.rowsList ? t("survey.table.table", { list: listName }) : t("survey.table.tableFree")
        : table.rowsList ? t("survey.table.block", { list: listName }) : t("survey.table.blockFree");
  const help = textIn(table.help, w.language, w.design.languages);
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
      <Words target={{ kind: "node", id: table.id }} part="label" value={table.label} label={t("survey.edit.label")} multiline>
        <Typography sx={{ fontWeight: 600 }}>{textIn(table.label, w.language, w.design.languages) || table.name}</Typography>
      </Words>
      <ItemTools w={w} item={table} siblings={siblings} page={page} />
      <Detail>{kind}</Detail>
      {list && <Detail>{t("survey.answers", { items: answersText(w, list.items) })}</Detail>}
      <Words target={{ kind: "node", id: table.id }} part="help" value={table.help} label={t("survey.edit.help")} multiline>
        {help && <Detail>{help}</Detail>}
      </Words>
      {table.shownWhen && <Detail>{t("survey.shownWhen", { condition: conditionWords(w, table.shownWhen) })}</Detail>}
      <Stack spacing={2} sx={{ mt: 1.5 }}>
        {table.columns.map((c) => (
          <QuestionView key={c.name} w={w} q={c} inTable table={table} siblings={table.columns} />
        ))}
        {edit && (
          <Box>
            <Button size="small" variant="outlined" startIcon={<Add />} disabled={edit.busy} onClick={() => edit.addQuestion({ table: table.id })}>
              {t("survey.edit.addColumn")}
            </Button>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

/** A list and its answers (memo: a list's fields are many, and typing elsewhere leaves them as they are) */
const ListView = memo(function ListView({ w, list }: { w: Words; list: DesignList }) {
  const { t } = w;
  const edit = useContext(EditContext);
  return (
    // Off screen, its layout is skipped (a long list's fields are many: typing elsewhere stays quick)
    <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: "divider", contentVisibility: "auto", containIntrinsicSize: "auto 240px" }} data-focus-home>
      <Words target={{ kind: "list", name: list.name }} part="label" value={list.label} label={t("survey.edit.list")}>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{textIn(list.label, w.language, w.design.languages) || list.name}</Typography>
      </Words>
      <Detail>
        {[
          t("survey.list.count", { count: list.items.length }),
          list.usedBy.length > 0 ? t("survey.list.usedBy", { names: list.usedBy.join(", ") }) : t("survey.list.unused"),
          ...(list.external ? [t("survey.list.external")] : []),
        ].join(" · ")}
      </Detail>
      <ItemTree w={w} list={list.name} items={list.items} />
      {edit && !list.external && <AddItemForm w={w} list={list} />}
      {edit && list.usedBy.length === 0 && (
        <Button size="small" color="error" startIcon={<DeleteOutline />} disabled={edit.busy} sx={{ mt: 0.5 }}
          onClick={() => edit.change([{ op: "deleteList", name: list.name }], textIn(list.label, w.language, w.design.languages) || list.name)}>
          {t("survey.list.delete")}
        </Button>
      )}
      <Typography variant="caption" color="text.secondary">
        {t("survey.name", { name: list.name })}
      </Typography>
    </Box>
  );
});

function ItemTree({ w, list, items, codes }: { w: Words; list: string; items: DesignListItem[]; codes?: ReadonlySet<string> }) {
  const edit = useContext(EditContext);
  const editing = edit !== null;
  const [under, setUnder] = useState<DesignListItem | null>(null);
  // Every code of the list, at every level: a new one is none of them
  const taken = useMemo(() => codes ?? new Set(listOptions(w.lists.get(list)?.items ?? []).map((i) => i.code)), [codes, w.lists, list]);
  if (items.length === 0) return null;
  return (
    <Box component="ul" sx={{ m: 0, pl: 3 }}>
      {under && edit && (
        <NameDialog
          title={w.t("survey.list.underTitle", { answer: textIn(under.label, w.language, w.design.languages) || under.code })}
          label={w.t("survey.list.itemLabel")}
          onClose={() => setUnder(null)}
          onDone={(text) => edit.submit([{ op: "addItem", list, under: under.code, item: { code: uniqueName(slugName(text, "answer"), taken), label: { [w.language]: text } } }])}
        />
      )}
      {items.map((i) => {
        const name = `${textIn(i.label, w.language, w.design.languages) || i.code} (${i.code})`;
        const why =
          i.usedBy.length > 0
            ? w.t("survey.edit.usedBy", { names: i.usedBy.join(", ") })
            : i.items.length > 0
              ? w.t("survey.list.hasUnder")
              : codes === undefined && items.length === 1
                ? w.t("survey.list.lastAnswer")
                : undefined;
        return (
        <Typography component="li" variant="body2" key={i.code} sx={{ overflowWrap: "anywhere" }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Words target={{ kind: "item", list, code: i.code }} part="label" value={i.label} label={w.t("survey.edit.answer", { code: i.code })}>
                {textIn(i.label, w.language, w.design.languages) || i.code}{" "}
              </Words>
            </Box>
            {edit && (
              <>
                <MoveButtons
                  label={name}
                  up={itemMoveTarget(items.map((x) => x.code), i.code, -1)}
                  down={itemMoveTarget(items.map((x) => x.code), i.code, 1)}
                  onMove={(to) => edit.change([{ op: "moveItem", list, code: i.code, ...(to.before !== undefined ? { before: to.before as string } : {}) }])}
                />
                <ToolButton title={w.t("survey.list.addUnder")} label={`${w.t("survey.list.addUnder")}: ${name}`} disabled={edit.busy} onClick={() => setUnder(i)}>
                  <SubdirectoryArrowRight fontSize="small" />
                </ToolButton>
                {/* An answer that conditions, rules or formulas name, or with answers under it, stays */}
                <ToolButton
                  title={why ?? w.t("survey.edit.delete")}
                  label={`${w.t("survey.edit.delete")}: ${name}`}
                  disabled={edit.busy || why !== undefined}
                  reason={why}
                  onClick={() => edit.change([{ op: "deleteItem", list, code: i.code }], name)}
                >
                  <DeleteOutline fontSize="small" />
                </ToolButton>
              </>
            )}
          </Stack>
          {!editing && (
            <Typography component="span" variant="caption" color="text.secondary">
              ({i.code})
            </Typography>
          )}
          <ItemTree w={w} list={list} items={i.items} codes={taken} />
        </Typography>
        );
      })}
    </Box>
  );
}

/** The versions kept before each change, any of them brought back */
function VersionsCard({ projectId, revision, disabled, onRestored, onStale }: {
  projectId: string;
  revision: string | null;
  /** Changes not saved: saved or discarded first */
  disabled: boolean;
  onRestored: (answer: SurveyDesignAnswer) => void;
  /** Someone else changed the survey since it was read: it is read again */
  onStale: () => void;
}) {
  const t = useT();
  const { language } = useApp();
  const versions = useLoad(["project", projectId, "listSurveyVersions"], () => listSurveyVersions(projectId));
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(false);
  const list = versions.data?.versions ?? [];

  const restore = async (id: string) => {
    if (!revision) return;
    setBusy(true);
    setError(null);
    setDone(false);
    setStale(false);
    try {
      onRestored(await restoreSurveyVersion(projectId, id, revision));
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale") {
        // The survey and its versions as they are now: the version is chosen again on them
        setStale(true);
        onStale();
        versions.reload();
      } else setError(err);
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  return (
    <FoldingCard keepFolded lazy title={t("survey.versions.title")} summary={t("survey.versions.summary", { count: list.length })}>
      <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.versions.explain")} />
      {versions.error ? (
        <ErrorAlert error={versions.error} onRetry={versions.reload} />
      ) : !versions.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Typography color="text.secondary">{t("survey.versions.none")}</Typography>
      ) : (
        <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: "none" }}>
          {list.map((v) => {
            const by = v.by ?? t("survey.versions.someone");
            const date = formatDate(v.createdAt, language);
            return (
              <Stack component="li" key={v.id} direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <Typography variant="body2">
                  {v.restore ? t("survey.versions.beforeRestore", { by, date }) : t("survey.versions.before", { by, date, count: v.changes })}
                </Typography>
                <Button size="small" variant="outlined" disabled={disabled || busy || !revision} onClick={() => setAsking(v.id)}>
                  {t("survey.versions.restore")}
                </Button>
              </Stack>
            );
          })}
        </Stack>
      )}
      {disabled && list.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("survey.versions.saveFirst")}</Typography>}
      {done && <Alert severity="success" role="status" sx={{ mt: 2 }}>{t("survey.versions.restored")}</Alert>}
      {stale && <Alert severity="warning" role="alert" sx={{ mt: 2 }} onClose={() => setStale(false)}>{t("survey.versions.stale")}</Alert>}
      {error !== null && <Box sx={{ mt: 2 }}><ChangeError error={error} /></Box>}
      <Dialog open={asking !== null} onClose={() => setAsking(null)} aria-labelledby="restore-title" maxWidth="sm" fullWidth>
        <DialogTitle id="restore-title">{t("survey.versions.restore")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("survey.versions.confirm")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(null)}>{t("common.cancel")}</Button>
          <Button variant="contained" disabled={busy} onClick={() => asking && void restore(asking)}>
            {t("survey.versions.restore")}
          </Button>
        </DialogActions>
      </Dialog>
    </FoldingCard>
  );
}

/** A language added to the survey: chosen among the common ones, or by its code */
function AddLanguageDialog({ open, present, names, onClose, onAdd }: {
  open: boolean;
  present: readonly string[];
  names: (code: string) => string;
  onClose: () => void;
  onAdd: (code: string) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState("");
  const [code, setCode] = useState("");
  const chosen = code.trim() || picked;
  const bad = code.trim() !== "" && !isLanguageCode(code.trim());
  const known = chosen !== "" && present.includes(chosen);
  const offered = COMMON_LANGUAGES.filter((l) => !present.includes(l)).sort((a, b) => names(a).localeCompare(names(b)));
  const close = () => {
    setPicked("");
    setCode("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} aria-labelledby="add-language-title" maxWidth="xs" fullWidth>
      <DialogTitle id="add-language-title">{t("survey.edit.addLanguage.title")}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t("survey.edit.addLanguage.explain")}</DialogContentText>
        <Stack spacing={2}>
          <TextField select label={t("survey.edit.addLanguage.choose")} value={picked} onChange={(e) => setPicked(e.target.value)} fullWidth>
            {offered.map((l) => (
              <MenuItem key={l} value={l}>
                {names(l)} ({l})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t("survey.edit.addLanguage.other")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={bad || known}
            helperText={bad ? t("survey.edit.addLanguage.bad") : known ? t("survey.edit.addLanguage.known") : " "}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t("common.cancel")}</Button>
        <Button
          variant="contained"
          disabled={chosen === "" || bad || known}
          onClick={() => {
            onAdd(chosen);
            setPicked("");
            setCode("");
          }}
        >
          {t("survey.edit.addLanguage.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Up and down: one step among the items of a page, table or list, or among the pages */
function MoveButtons<T>({ label, up, down, onMove }: { label: string; up: T | null; down: T | null; onMove: (to: T) => void }) {
  const edit = useContext(EditContext);
  const t = useT();
  if (!edit) return null;
  return (
    <>
      <ToolButton title={t("survey.edit.moveUp")} label={`${t("survey.edit.moveUp")}: ${label}`} disabled={edit.busy || up === null} onClick={() => up && onMove(up)}>
        <ArrowUpward fontSize="small" />
      </ToolButton>
      <ToolButton title={t("survey.edit.moveDown")} label={`${t("survey.edit.moveDown")}: ${label}`} disabled={edit.busy || down === null} onClick={() => down && onMove(down)}>
        <ArrowDownward fontSize="small" />
      </ToolButton>
    </>
  );
}

/** Whether the editor offers the Required box: not on the fields Collect Earth fills in, nor on calculated answers */
const canRequire = (q: DesignQuestion) => !q.fixed && !q.formulas;
/** Whether the editor offers "When it is shown": a table, or a question asked in the form */
const canShow = (item: DesignItem) => item.kind === "table" || (canRequire(item) && !item.hidden);

/** What can be done with a question or table while the survey is edited: move it, require it, delete it */
function ItemTools({ w, item, siblings, page, table }: { w: Words; item: DesignItem; siblings: readonly DesignItem[]; page?: string; table?: DesignTable }) {
  const edit = useContext(EditContext);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [showing, setShowing] = useState(false);
  // The questions its conditions can name: a table's from the plot, a column's from its row and the plot
  const candidates = useMemo(
    () => (edit ? conditionQuestions(w.design, item.kind === "table" ? null : (table ?? null), item.name) : []),
    [edit, w.design, item, table],
  );
  if (!edit) return null;
  const { t } = w;
  const label = textIn(item.label, w.language, w.design.languages) || item.name;
  const question = item.kind === "question" ? item : null;
  const others = edit.pages.filter((p) => p.name !== page);
  const usedBy = item.kind === "table" ? usersOfTable(edit.users, item) : usersOfQuestion(edit.users, item);
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", my: 0.5 }}>
      <MoveButtons
        label={label}
        up={moveTarget(siblings, item.id, -1)}
        down={moveTarget(siblings, item.id, 1)}
        onMove={(to) => edit.change([{ op: "moveQuestion", id: item.id, ...(to.before !== undefined ? { before: to.before } : {}) }])}
      />
      {page !== undefined && others.length > 0 && (
        <>
          <ToolButton title={t("survey.edit.moveTo")} label={`${t("survey.edit.moveTo")}: ${label}`} disabled={edit.busy} onClick={(e) => setMenu(e.currentTarget)}>
            <DriveFileMoveOutlined fontSize="small" />
          </ToolButton>
          <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
            {others.map((p) => (
              <MenuItem key={p.name} onClick={() => { setMenu(null); edit.change([{ op: "moveQuestion", id: item.id, page: p.name }]); }}>
                {p.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {canShow(item) && (
        <ToolButton title={t("survey.logic.shown")} label={`${t("survey.logic.shown")}: ${label}`} disabled={edit.busy} onClick={() => setShowing(true)}>
          <VisibilityOutlined fontSize="small" />
        </ToolButton>
      )}
      {question && canRequire(question) && (
        <RequiredControl w={w} q={question} candidates={candidates} busy={edit.busy}
          onChange={(required) => edit.change([{ op: "setRequired", id: question.id, required }])}
          onWhen={(required) => edit.submit([{ op: "setRequired", id: question.id, required }])}
          onText={(text) => edit.submit([{ op: "setExpression", id: question.id, part: "required", text }])} />
      )}
      {showing && (
        <ConditionDialog
          w={w}
          title={t("survey.logic.shownTitle", { question: label })}
          initial={item.shownWhen}
          candidates={candidates}
          allowAlways
          node={item.id}
          onClose={() => setShowing(false)}
          onApply={(when) => edit.submit([{ op: "setShownWhen", id: item.id, when }])}
          onApplyText={(text) => edit.submit([{ op: "setExpression", id: item.id, part: "shownWhen", text }])}
        />
      )}
      {(item.kind === "table" || !item.fixed) && (
        // What other questions name stays until they no longer do (the server refuses it)
        <ToolButton
          title={usedBy.length > 0 ? t("survey.edit.usedBy", { names: usedBy.join(", ") }) : t("survey.edit.delete")}
          label={`${t("survey.edit.delete")}: ${label}`}
          color="error"
          disabled={edit.busy || usedBy.length > 0}
          reason={usedBy.length > 0 ? t("survey.edit.usedBy", { names: usedBy.join(", ") }) : undefined}
          onClick={() => edit.change([item.kind === "table" ? { op: "deleteTable", id: item.id } : { op: "deleteQuestion", id: item.id }], label)}
        >
          <DeleteOutline fontSize="small" />
        </ToolButton>
      )}
    </Stack>
  );
}

/** An answer added at the end of a list: its code and its text in the language chosen */
function AddItemForm({ w, list }: { w: Words; list: DesignList }) {
  const edit = useContext(EditContext);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  // Emptied once the answer is saved; kept, with why, when it is not
  const submit = useSubmit(() => {
    setLabel("");
    setCode("");
  });
  useDraft(label.trim() !== "" || code.trim() !== "");
  if (!edit) return null;
  const { t } = w;
  // Every code of the list, at every level (as the answers under an answer are added)
  const taken = new Set(listOptions(list.items).map((i) => i.code));
  const proposed = code.trim() || uniqueName(slugName(label, "answer"), taken);
  const bad = code.trim() !== "" && (!isItemCode(code.trim()) || taken.has(code.trim()));
  const ready = !edit.busy && !submit.busy && label.trim() !== "" && !bad;
  const add = () => {
    if (ready) void submit.run(edit.submit([{ op: "addItem", list: list.name, item: { code: proposed, label: { [w.language]: label.trim() } } }]));
  };
  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
        <TextField size="small" label={t("survey.list.itemLabel")} value={label} onChange={(e) => setLabel(e.target.value)} sx={{ flex: 2 }}
          helperText={writtenIn(edit, t)} slotProps={{ htmlInput: { lang: w.language } }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <TextField size="small" label={t("survey.list.itemCode")} value={code} placeholder={label ? proposed : ""} onChange={(e) => setCode(e.target.value)}
          error={bad} helperText={bad ? t("survey.list.codeBad") : t("survey.list.codeHelp")} sx={{ flex: 1 }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button variant="outlined" startIcon={submit.busy ? <CircularProgress size={16} /> : <Add />} disabled={!ready} onClick={add}>
          {t("survey.list.addItem")}
        </Button>
      </Stack>
      {submit.problem}
    </Box>
  );
}

/** What a dialog adding to the survey says of the language its texts are written in */
function writtenIn(edit: Editing, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  return edit.manyLanguages ? t("survey.add.languageMany", { language: edit.languageName }) : t("survey.add.language", { language: edit.languageName });
}

/**
 * A text asked for in a dialog: a new page's name, an answer under another. Made anew each time it opens; it closes
 * once what it adds is saved, and keeps what was typed, with why, when it is not. Enter adds.
 */
function NameDialog({ title, label, onClose, onDone }: { title: string; label: string; onClose: () => void; onDone: (text: string) => Promise<AddResult> }) {
  const t = useT();
  const edit = useContext(EditContext);
  const titleId = useId();
  const [text, setText] = useState("");
  const submit = useSubmit(onClose);
  useDraft(text.trim() !== "");
  const ready = text.trim() !== "" && !submit.busy;
  const done = () => {
    if (ready) void submit.run(onDone(text.trim()));
  };
  return (
    <Dialog open onClose={submit.busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField autoFocus fullWidth label={label} value={text} onChange={(e) => setText(e.target.value)}
            helperText={edit ? writtenIn(edit, t) : undefined} slotProps={{ htmlInput: { lang: edit?.language } }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(); } }} />
          {submit.problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.busy}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!ready} onClick={done}>
          {t("survey.add.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const NEW_TYPES: NewQuestionType[] = ["choice", "choices", "yesNo", "integer", "decimal", "text", "memo", "date"];
/** "A new list" in the list choice: no list name has a colon */
const NEW_LIST = "new:";
/** The value of "the answers under the answer to…" in the list choice: no list name has a colon */
const SUB_LIST = "sub:";

/**
 * A question added to a page, or a column to a table: its text, its kind of answer, its list, required or not. Made
 * anew each time it opens; it closes once the question is saved, and keeps what was typed when it is not (the
 * "Before saving" question cancelled, or the save refused).
 */
function AddQuestionDialog({ w, where, onClose, onAdd }: {
  w: Words;
  where: { page?: string; table?: number };
  onClose: () => void;
  onAdd: (ops: SurveyOperation[]) => Promise<AddResult>;
}) {
  const { t, design, language } = w;
  const edit = useContext(EditContext);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<NewQuestionType>("choice");
  const [listName, setListName] = useState(NEW_LIST);
  const [lines, setLines] = useState("");
  const [required, setRequired] = useState(false);
  useDraft(label.trim() !== "" || lines.trim() !== "");
  const choice = type === "choice" || type === "choices";
  const taken = new Set(w.questions.keys());
  const name = uniqueName(slugName(label, "question"), taken);
  const items = itemsFromLines(lines, language);
  const ready = label.trim() !== "" && (!choice || listName !== NEW_LIST || items.length > 0) && !(listName.startsWith(SUB_LIST) && type !== "choice");
  const submit = async (ops: SurveyOperation[]) => {
    setBusy(true);
    setProblem(null);
    const result = await onAdd(ops);
    setBusy(false);
    if (result.saved) onClose();
    else setProblem(result.problem ?? null);
  };
  // A sub-list follows a choice of one answer of the same place: the plot's pages, or the same table
  const place = where.table !== undefined
    ? (design.pages.flatMap((p) => p.items).find((i): i is DesignTable => i.kind === "table" && i.id === where.table)?.columns ?? [])
    : design.pages.flatMap((p) => p.items).filter((i): i is DesignQuestion => i.kind === "question");
  // Only a question whose list has answers under its answers, at the level below its own (the server refuses others)
  const parents = subListParents(place, w.lists, w.questions);
  const subOf = listName.startsWith(SUB_LIST) ? listName.slice(SUB_LIST.length) : null;
  const add = () => {
    const ops: SurveyOperation[] = [];
    let list = listName;
    if (choice && subOf !== null) {
      ops.push({
        op: "addQuestion",
        type,
        label: { [language]: label.trim() },
        name,
        ...(where.page !== undefined ? { page: where.page } : {}),
        ...(where.table !== undefined ? { table: where.table } : {}),
        parent: subOf,
        ...(required ? { required: true } : {}),
      });
      void submit(ops);
      return;
    }
    if (choice && listName === NEW_LIST) {
      list = uniqueName(slugName(label, "list"), new Set(design.lists.map((l) => l.name)));
      ops.push({ op: "addList", name: list, label: { [language]: label.trim() }, items });
    }
    ops.push({
      op: "addQuestion",
      type,
      label: { [language]: label.trim() },
      name,
      ...(where.page !== undefined ? { page: where.page } : {}),
      ...(where.table !== undefined ? { table: where.table } : {}),
      ...(choice ? { list } : {}),
      ...(required ? { required: true } : {}),
    });
    void submit(ops);
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} aria-labelledby="add-question-title" maxWidth="sm" fullWidth>
      <DialogTitle id="add-question-title">{where.table !== undefined ? t("survey.add.columnTitle") : t("survey.add.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* One line: Enter adds the question (when it can be) */}
          <TextField autoFocus label={t("survey.add.label")} value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (ready && !busy) add(); } }}
            helperText={[edit ? writtenIn(edit, t) : "", label.trim() ? t("survey.add.name", { name }) : ""].filter(Boolean).join(" ") || " "}
            slotProps={{ htmlInput: { lang: language } }} />
          <TextField select label={t("survey.add.type")} value={type}
            onChange={(e) => {
              const next = e.target.value as NewQuestionType;
              setType(next);
              // The answers under another's follow a question of one answer: another kind takes a list of its own
              if (next !== "choice" && listName.startsWith(SUB_LIST)) setListName(NEW_LIST);
            }}>
            {NEW_TYPES.map((k) => (
              <MenuItem key={k} value={k}>
                {t(TYPE_KEYS[k])}
              </MenuItem>
            ))}
          </TextField>
          {choice && (
            <TextField select label={t("survey.add.list")} value={listName} onChange={(e) => setListName(e.target.value)}
              helperText={type === "choices" && parents.length > 0 ? t("survey.add.subListOne") : undefined}>
              <MenuItem value={NEW_LIST}>{t("survey.add.newList")}</MenuItem>
              {design.lists.filter((l) => !l.external).map((l) => (
                <MenuItem key={l.name} value={l.name}>
                  {textIn(l.label, language, design.languages) || l.name} ({l.items.length})
                </MenuItem>
              ))}
              {type === "choice" && parents.map((q) => (
                <MenuItem key={`sub-${q.name}`} value={`${SUB_LIST}${q.name}`}>
                  {t("survey.add.subList", { question: textIn(q.label, language, design.languages) || q.name })}
                </MenuItem>
              ))}
            </TextField>
          )}
          {choice && subOf !== null && <Typography variant="body2" color="text.secondary">{t("survey.add.subListHelp")}</Typography>}
          {choice && listName === NEW_LIST && (
            <TextField label={t("survey.add.answers")} value={lines} onChange={(e) => setLines(e.target.value)} multiline minRows={4}
              helperText={t("survey.add.answersHelp")} slotProps={{ htmlInput: { lang: language } }} />
          )}
          <FormControlLabel control={<Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />} label={t("survey.add.required")} />
          {problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!ready || busy} onClick={add}>
          {t("survey.add.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A table on a page: its title and its rows, one per answer of a list (an existing one, or one written here) */
function AddTableDialog({ w, page, onClose, onAdd }: { w: Words; page: string; onClose: () => void; onAdd: (ops: SurveyOperation[]) => Promise<AddResult> }) {
  const { t, design, language } = w;
  const edit = useContext(EditContext);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [label, setLabel] = useState("");
  const [listName, setListName] = useState(NEW_LIST);
  const [lines, setLines] = useState("");
  useDraft(label.trim() !== "" || lines.trim() !== "");
  const name = uniqueName(slugName(label, "table"), new Set(w.questions.keys()));
  const items = itemsFromLines(lines, language);
  const ready = label.trim() !== "" && (listName !== NEW_LIST || items.length > 0);
  const add = async () => {
    const ops: SurveyOperation[] = [];
    let rows = listName;
    if (listName === NEW_LIST) {
      rows = uniqueName(slugName(label, "list"), new Set(design.lists.map((l) => l.name)));
      ops.push({ op: "addList", name: rows, label: { [language]: label.trim() }, items });
    }
    ops.push({ op: "addTable", label: { [language]: label.trim() }, page, rows, name });
    setBusy(true);
    setProblem(null);
    const result = await onAdd(ops);
    setBusy(false);
    // Kept as typed when it was not saved
    if (result.saved) onClose();
    else setProblem(result.problem ?? null);
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth>
      <DialogTitle id={titleId}>{t("survey.table.addTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField autoFocus label={t("survey.table.label")} value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (ready && !busy) void add(); } }}
            helperText={[edit ? writtenIn(edit, t) : "", label.trim() ? t("survey.add.name", { name }) : ""].filter(Boolean).join(" ") || " "}
            slotProps={{ htmlInput: { lang: language } }} />
          <TextField select label={t("survey.table.rows")} value={listName} onChange={(e) => setListName(e.target.value)} helperText={t("survey.table.rowsHelp")}>
            <MenuItem value={NEW_LIST}>{t("survey.add.newList")}</MenuItem>
            {design.lists.filter((l) => !l.external && l.items.length > 0).map((l) => (
              <MenuItem key={l.name} value={l.name}>
                {textIn(l.label, language, design.languages) || l.name} ({l.items.length})
              </MenuItem>
            ))}
          </TextField>
          {listName === NEW_LIST && (
            <TextField label={t("survey.add.answers")} value={lines} onChange={(e) => setLines(e.target.value)} multiline minRows={4}
              helperText={t("survey.add.answersHelp")} slotProps={{ htmlInput: { lang: language } }} />
          )}
          {problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!ready || busy} onClick={() => void add()}>
          {t("survey.add.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A new answer list: its name and its answers, one per line. Made anew each time; closes once the list is saved */
function AddListDialog({ w, onClose, onAdd }: { w: Words; onClose: () => void; onAdd: (op: SurveyOperation) => Promise<AddResult> }) {
  const { t, language } = w;
  const edit = useContext(EditContext);
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState("");
  const submit = useSubmit(onClose);
  useDraft(label.trim() !== "" || lines.trim() !== "");
  // A list keeps at least one answer (the server refuses an empty one)
  const ready = label.trim() !== "" && itemsFromLines(lines, language).length > 0 && !submit.busy;
  const add = () => {
    if (ready) void submit.run(onAdd({ op: "addList", label: { [language]: label.trim() }, items: itemsFromLines(lines, language) }));
  };
  return (
    <Dialog open onClose={submit.busy ? undefined : onClose} aria-labelledby="add-list-title" maxWidth="sm" fullWidth>
      <DialogTitle id="add-list-title">{t("survey.list.addTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField autoFocus label={t("survey.edit.list")} value={label} onChange={(e) => setLabel(e.target.value)}
            helperText={edit ? writtenIn(edit, t) : undefined} slotProps={{ htmlInput: { lang: language } }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <TextField label={t("survey.add.answers")} value={lines} onChange={(e) => setLines(e.target.value)} multiline minRows={4} helperText={t("survey.add.answersHelp")}
            slotProps={{ htmlInput: { lang: language } }} />
          {submit.problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.busy}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!ready} onClick={add}>
          {t("survey.add.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Before a change is saved: what it deletes, and what it does to the plots already collected */
function ConfirmChangeDialog({ w, pending, busy, onCancel, onConfirm }: {
  w: Words;
  pending: PendingChange | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = w;
  const questionLabel = (name: string) => {
    const q = w.questions.get(name);
    return `${(q && textIn(q.label, w.language, w.design.languages)) || name} (${name})`;
  };
  const tableLabel = (name: string) => {
    const table = w.design.pages.flatMap((p) => p.items).find((i): i is DesignTable => i.kind === "table" && i.name === name);
    return `${(table && textIn(table.label, w.language, w.design.languages)) || name} (${name})`;
  };
  const listLabel = (name: string) => {
    const list = w.lists.get(name);
    return (list && textIn(list.label, w.language, w.design.languages)) || name;
  };
  const itemLabel = (list: string, code: string) => {
    const item = listOptions(w.lists.get(list)?.items ?? []).find((i) => i.code === code);
    return `${(item && textIn(item.label, w.language, w.design.languages)) || code} (${code})`;
  };
  const effects = pending?.impact.effects ?? [];
  const effectWords = (e: SurveyEffect): string | undefined => {
    switch (e.kind) {
      case "newQuestions":
        return t("survey.confirm.newQuestions");
      case "questionDeleted":
        return t("survey.confirm.questionDeleted", { question: questionLabel(e.question), count: e.answered });
      case "tableDeleted":
        return t("survey.confirm.tableDeleted", { table: tableLabel(e.table), count: e.answered });
      case "itemDeleted":
        return t("survey.confirm.itemDeleted", { code: itemLabel(e.list, e.code), list: listLabel(e.list), count: e.chosen });
      case "nowRequired":
        return t("survey.confirm.nowRequired", { question: questionLabel(e.question), count: e.unanswered });
      case "hiddenAnswers":
        return t("survey.confirm.hiddenAnswers", { question: questionLabel(e.question), count: e.answered });
      case "ruleFlags":
        return e.checked === 0
          ? t("survey.confirm.ruleNone", { question: questionLabel(e.question) })
          : t("survey.confirm.ruleFlags", { question: questionLabel(e.question), count: e.flagged, checked: e.checked });
    }
  };
  return (
    // The keyboard goes back where it was by the change itself (keepFocus): the button may have moved or gone
    <Dialog open={pending !== null} onClose={onCancel} aria-labelledby="confirm-change-title" maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle id="confirm-change-title">{pending?.what !== undefined ? t("survey.confirm.deleteTitle") : t("survey.confirm.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {pending?.what !== undefined && <DialogContentText>{t("survey.confirm.delete", { what: pending.what })}</DialogContentText>}
          {effects.length > 0 && (
            <Alert severity="warning">
              <Typography sx={{ mb: 1 }}>{t("survey.confirm.effects", { plots: pending?.impact.plots ?? 0 })}</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {effects.map((e, i) => (
                  <Typography component="li" variant="body2" key={i}>
                    {effectWords(e)}
                    {e.kind === "ruleFlags" && e.examples.length > 0 && (
                      <Box component="span" sx={{ display: "block", overflowWrap: "anywhere" }}>
                        {t("survey.confirm.ruleExamples", { plots: e.examples.join(", ") + (e.flagged > e.examples.length ? ", …" : "") })}
                      </Box>
                    )}
                  </Typography>
                ))}
              </Box>
              {/* A question or table deleted says it already */}
              {effects.some((e) => e.kind === "itemDeleted") && !effects.some((e) => e.kind === "questionDeleted" || e.kind === "tableDeleted") && (
                <Typography variant="body2" sx={{ mt: 1 }}>{t("survey.confirm.copy")}</Typography>
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="contained" color={pending?.what !== undefined ? "error" : "primary"} disabled={busy} onClick={onConfirm}>
          {pending?.what !== undefined ? t("survey.edit.delete") : t("survey.confirm.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A list's answers in one line, the first ones only */
function answersText(w: Words, items: DesignListItem[]): string {
  const shown = items.slice(0, INLINE_ANSWERS).map((i) => textIn(i.label, w.language, w.design.languages) || i.code);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(", ")} ${w.t("survey.moreItems", { count: more })}` : shown.join(", ");
}
