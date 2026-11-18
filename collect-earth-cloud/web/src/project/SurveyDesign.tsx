import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
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
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  getSurveyDesign,
  listSurveyVersions,
  restoreSurveyVersion,
  saveSurveyChanges,
  type DesignList,
  type DesignListItem,
  type DesignPage,
  type DesignQuestion,
  type DesignTable,
  type SurveyDesign,
  type SurveyDesignAnswer,
  type SurveyProblem,
  type WordTarget,
} from "../api";
import { formatDate } from "../format";
import { queryClient } from "../queryClient";
import { COMMON_LANGUAGES, editKey, isLanguageCode, operationsOf, withText, type PendingText, type WordPart } from "./surveyEditView";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FoldingCard } from "../components/FoldingCard";
import { Loading } from "../components/Loading";
import { useT, type MessageKey } from "../i18n";
import { useLoad } from "../useLoad";
import { conditionWords, firstLanguage, requiredWords, ruleWords, tableWords, textIn, TYPE_KEYS, untranslated, words, type Words } from "./surveyDesignView";

/** The most answers a question shows inline; the list's card has them all */
const INLINE_ANSWERS = 12;

/** The words being changed (stage 2): what the fields show and where what is typed goes */
interface Editing {
  language: string;
  /** The survey's first language, whose text a field in another language shows under it */
  firstLanguage: string;
  firstLanguageName: string;
  pending: ReadonlyMap<string, PendingText>;
  set: (target: WordTarget, part: WordPart, text: string, current: string) => void;
}

const EditContext = createContext<Editing | null>(null);

/**
 * Setup › Survey form: the project's survey as the people collecting meet it, page by page, read from the project
 * file (docs/plans/2026-11-18-survey-designer.md, stages 1 and 2); its words changed here, in any of its languages.
 */
export function SurveyDesignCards({ projectId }: { projectId: string }) {
  const t = useT();
  const { language: uiLanguage } = useApp();
  const loaded = useLoad(["project", projectId, "getSurveyDesign"], () => getSurveyDesign(projectId));
  const answer = loaded.data;
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingText>>(new Map());
  const [added, setAdded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<SurveyProblem[] | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  // The languages added and not saved yet are shown as the survey's, for their texts to be written
  const design = useMemo<SurveyDesign | null>(() => {
    const d = answer?.design ?? null;
    return d && added.length > 0 ? { ...d, languages: [...d.languages, ...added.filter((l) => !d.languages.includes(l))] } : d;
  }, [answer, added]);
  // The survey's language shown, the same in every card: the dashboard's while none is chosen
  const [chosen, setChosen] = useState<string | null>(null);
  const language = design ? (chosen && design.languages.includes(chosen) ? chosen : firstLanguage(design, uiLanguage)) : "";
  const w = useMemo(() => (design ? words(design, language, t) : null), [design, language, t]);
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
  const operations = useMemo(() => operationsOf(pending, added), [pending, added]);

  // Changes not saved: the browser asks before closing or reloading the page
  useEffect(() => {
    if (operations.length === 0) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [operations.length]);

  const edit = useMemo<Editing | null>(
    () =>
      editing && design
        ? {
            language,
            firstLanguage: design.languages[0],
            firstLanguageName: names(design.languages[0]),
            pending,
            set: (target, part, text, current) => {
              setSaved(false);
              setPending((before) => withText(before, { target, part, language, text, current }));
            },
          }
        : null,
    [editing, design, language, names, pending],
  );

  const discard = () => {
    setPending(new Map());
    setAdded([]);
    setRefused(null);
    setStale(false);
    setError(null);
    setEditing(false);
  };

  const afterChange = (next: SurveyDesignAnswer) => {
    loaded.setData(next);
    void queryClient.invalidateQueries({ queryKey: ["project", projectId, "listSurveyVersions"] });
  };

  const save = async () => {
    if (!answer?.revision || operations.length === 0) return;
    setSaving(true);
    setError(null);
    setRefused(null);
    setStale(false);
    try {
      afterChange(await saveSurveyChanges(projectId, { revision: answer.revision, operations }));
      setPending(new Map());
      setAdded([]);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale") setStale(true);
      else if (err instanceof ApiError && err.code === "survey_problems") setRefused((err.details.problems as SurveyProblem[] | undefined) ?? []);
      else setError(err);
    } finally {
      setSaving(false);
    }
  };

  const reach =
    answer && answer.peopleWithFile > 0 ? t("survey.edit.reach", { count: answer.peopleWithFile }) : t("survey.edit.reachNone");

  return (
    <EditContext.Provider value={edit}>
      <Paper variant="outlined" component="section" aria-labelledby="survey-design-title" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h2" id="survey-design-title" gutterBottom>
            {t("survey.title")}
          </Typography>
          {answer?.editable && design && !editing && (
            <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setEditing(true)}>
              {t("survey.edit.start")}
            </Button>
          )}
        </Stack>
        <Explain sx={{ mb: 2 }} text={t("survey.explain.short")} more={t("survey.explain")} />
        {loaded.error ? (
          <ErrorAlert error={loaded.error} onRetry={loaded.reload} />
        ) : !answer ? (
          <Loading />
        ) : answer.unreadable ? (
          <Alert severity="warning">{t("survey.unreadable")}</Alert>
        ) : !w ? (
          <Alert severity="info">{t("survey.none")}</Alert>
        ) : (
          <Stack spacing={2}>
            {answer.problems.length > 0 && <Problems w={w} problems={answer.problems} />}
            {editing && (
              <Alert severity="info" icon={<EditOutlined />}>
                {t("survey.edit.explain")}
                <Box sx={{ mt: 1 }}>{reach}</Box>
              </Alert>
            )}
            {saved && !editing && (
              <Alert severity="success" role="status" onClose={() => setSaved(false)}>
                {t("survey.edit.saved")}
              </Alert>
            )}
            <DesignView
              w={w}
              onLanguage={setChosen}
              addLanguage={editing ? () => setAdding(true) : undefined}
            />
            {editing && (
              <Paper
                elevation={3}
                sx={{ position: "sticky", bottom: 16, zIndex: 2, p: 2, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}
              >
                {/* On a phone the count above, the two buttons side by side under it */}
                <Typography sx={{ flex: { xs: "1 1 100%", sm: 1 } }} role="status">
                  {operations.length > 0 ? t("survey.edit.pending", { count: operations.length }) : t("survey.edit.none")}
                </Typography>
                <Button onClick={discard} disabled={saving} sx={{ ml: { xs: "auto", sm: 0 } }}>
                  {operations.length > 0 ? t("survey.edit.discard") : t("survey.edit.done")}
                </Button>
                <Button variant="contained" onClick={() => void save()} disabled={saving || operations.length === 0}>
                  {t("survey.edit.save")}
                </Button>
                {stale && (
                  <Alert
                    severity="warning"
                    sx={{ flexBasis: "100%" }}
                    action={
                      <Button color="inherit" size="small" onClick={() => { setStale(false); loaded.reload(); }}>
                        {t("survey.edit.readAgain")}
                      </Button>
                    }
                  >
                    {t("survey.edit.stale")}
                  </Alert>
                )}
                {refused && (
                  <Box sx={{ flexBasis: "100%" }}>
                    <Problems w={w} problems={refused} title={t("survey.edit.refused")} />
                  </Box>
                )}
                {error !== null && (
                  <Box sx={{ flexBasis: "100%" }}>
                    <ErrorAlert error={error} />
                  </Box>
                )}
              </Paper>
            )}
          </Stack>
        )}
      </Paper>
      {w && <DesignCards w={w} />}
      {answer?.editable && answer.design && (
        <VersionsCard projectId={projectId} revision={answer.revision} disabled={operations.length > 0} onRestored={afterChange} />
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
    </EditContext.Provider>
  );
}

/**
 * A text of the survey: as it reads, or, while the words are changed, a field with it in the language chosen (the
 * survey's first language's under it when this is another)
 */
function Words({ target, part, value, label, multiline = false, children }: {
  target: WordTarget;
  part: WordPart;
  /** The text in each language */
  value: Record<string, string>;
  label: string;
  multiline?: boolean;
  children: ReactNode;
}) {
  const edit = useContext(EditContext);
  const t = useT();
  if (!edit) return <>{children}</>;
  const current = value[edit.language] ?? "";
  const kept = edit.pending.get(editKey(target, part, edit.language));
  const first = edit.language !== edit.firstLanguage ? (value[edit.firstLanguage] ?? "") : "";
  return (
    <TextField
      size="small"
      fullWidth
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      label={label}
      value={kept ? kept.text : current}
      onChange={(e) => edit.set(target, part, e.target.value, current)}
      helperText={first ? t("survey.edit.inFirst", { language: edit.firstLanguageName, text: first }) : undefined}
      slotProps={{ htmlInput: { lang: edit.language, maxLength: 4000 }, formHelperText: { sx: { whiteSpace: "pre-line" } } }}
      sx={{ my: 0.5 }}
    />
  );
}

/** The survey's title, its languages and its pages */
function DesignView({ w, onLanguage, addLanguage }: { w: Words; onLanguage: (language: string) => void; addLanguage?: () => void }) {
  const { design, language, t } = w;
  const { language: uiLanguage } = useApp();
  const missing = useMemo(() => untranslated(design, language), [design, language]);
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
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
        {design.pages.map((page, i) => (
          <PageView key={page.name} w={w} page={page} defaultOpen={i === 0} />
        ))}
      </Stack>
    </Stack>
  );
}

/** What the form fills itself, the hidden fields and the lists: folded cards under the survey */
function DesignCards({ w }: { w: Words }) {
  const { design, language, t } = w;
  return (
    <>
      {design.fromPlotFile.length > 0 && (
        <FoldingCard keepFolded title={t("survey.fromPlotFile.title")} summary={t("survey.fromPlotFile.summary", { count: design.fromPlotFile.length })}>
          <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.fromPlotFile.explain")} />
          <QuestionList w={w} questions={design.fromPlotFile} />
        </FoldingCard>
      )}
      {design.calculated.length > 0 && (
        <FoldingCard
          keepFolded
          title={t("survey.calculated.title")}
          summary={t("survey.calculated.summary", { count: design.calculated.length, formulas: design.counts.formulas })}
        >
          <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.calculated.explain")} />
          <QuestionList w={w} questions={design.calculated} />
        </FoldingCard>
      )}
      <FoldingCard keepFolded title={t("survey.hidden.title")} summary={t("survey.hidden.summary", { count: design.hidden.length })}>
        <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.hidden.explain")} />
        <QuestionList w={w} questions={design.hidden} />
      </FoldingCard>
      <FoldingCard keepFolded title={t("survey.lists.title")} summary={t("survey.lists.summary", { count: design.lists.length })}>
        <Explain variant="body2" sx={{ mb: 2 }} text={t("survey.lists.explain")} />
        <Stack spacing={2} lang={language}>
          {design.lists.map((l) => (
            <ListView key={l.name} w={w} list={l} />
          ))}
        </Stack>
      </FoldingCard>
    </>
  );
}

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
              {t(`surveyCheck.${p.code}` as MessageKey, p.values)}
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
function PageView({ w, page, defaultOpen }: { w: Words; page: DesignPage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const label = textIn(page.label, w.language, w.design.languages) || w.t("survey.noLabel");
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${id}-page`}
        sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", px: 2, py: 1.5, gap: 2, borderRadius: 1 }}
      >
        <Typography variant="h3" sx={{ flex: 1, minWidth: 0 }}>
          {label}
        </Typography>
        <ExpandMore aria-hidden sx={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none", color: "action.active" }} />
      </ButtonBase>
      <Collapse in={open} id={`${id}-page`}>
        <Stack spacing={2} sx={{ px: 2, pb: 2 }}>
          <Words target={{ kind: "page", name: page.name }} part="label" value={page.label} label={w.t("survey.edit.page")}>
            {null}
          </Words>
          {page.items.map((item) => (item.kind === "table" ? <TableView key={item.name} w={w} table={item} /> : <QuestionView key={item.name} w={w} q={item} />))}
        </Stack>
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

function QuestionView({ w, q, inTable }: { w: Words; q: DesignQuestion; inTable?: boolean }) {
  const { t } = w;
  const label = textIn(q.label, w.language, w.design.languages);
  const help = textIn(q.help, w.language, w.design.languages);
  const required = requiredWords(w, q);
  const list = q.list ? w.lists.get(q.list) : undefined;
  return (
    <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: q.hidden || q.formulas ? "divider" : "primary.light" }}>
      <Words target={{ kind: "node", id: q.id }} part="label" value={q.label} label={t("survey.edit.label")} multiline>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{label || q.name}</Typography>
      </Words>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", my: 0.5 }}>
        <Chip size="small" label={t(TYPE_KEYS[q.type])} />
        {required && q.required === "always" && <Chip size="small" color="primary" variant="outlined" label={required} />}
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
      {required && q.required !== "always" && <Detail>{required}</Detail>}
      {q.parentQuestion && <Detail>{t("survey.subList", { question: textIn(w.questions.get(q.parentQuestion)?.label ?? {}, w.language, w.design.languages) || q.parentQuestion })}</Detail>}
      {list && !q.formulas && <Detail>{t("survey.answers", { items: answersText(w, list.items) })}</Detail>}
      {q.rules.map((r, i) => (
        <Box key={i}>
          <Detail tone={r.flag === "warning" ? "warning" : undefined}>
            {ruleWords(w, r)}
            <Words target={{ kind: "rule", node: q.id, index: i }} part="message" value={r.message} label={t("survey.edit.message")} multiline>
              {textIn(r.message, w.language, w.design.languages) && ` — ${t("survey.rule.message", { message: textIn(r.message, w.language, w.design.languages) })}`}
            </Words>
          </Detail>
        </Box>
      ))}
      {q.formulas && (
        <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 3, fontFamily: "monospace", fontSize: "0.8125rem", color: "text.secondary" }}>
          {q.formulas.map((f, i) => {
            const formula = f.expression ?? f.value ?? "";
            return (
              <li key={i} style={{ overflowWrap: "anywhere" }}>
                {f.when ? t("survey.formula.if", { formula, condition: f.when }) : formula}
              </li>
            );
          })}
        </Box>
      )}
      {q.uses.length > 0 && <Detail>{t("survey.uses", { names: q.uses.join(", ") })}</Detail>}
      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        {t("survey.name", { name: q.name })}
      </Typography>
    </Box>
  );
}

function TableView({ w: survey, table }: { w: Words; table: DesignTable }) {
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
      <Detail>{kind}</Detail>
      {list && <Detail>{t("survey.answers", { items: answersText(w, list.items) })}</Detail>}
      <Words target={{ kind: "node", id: table.id }} part="help" value={table.help} label={t("survey.edit.help")} multiline>
        {help && <Detail>{help}</Detail>}
      </Words>
      {table.shownWhen && <Detail>{t("survey.shownWhen", { condition: conditionWords(w, table.shownWhen) })}</Detail>}
      <Stack spacing={2} sx={{ mt: 1.5 }}>
        {table.columns.map((c) => (
          <QuestionView key={c.name} w={w} q={c} inTable />
        ))}
      </Stack>
    </Box>
  );
}

function ListView({ w, list }: { w: Words; list: DesignList }) {
  const { t } = w;
  return (
    <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: "divider" }}>
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
      <Typography variant="caption" color="text.secondary">
        {t("survey.name", { name: list.name })}
      </Typography>
    </Box>
  );
}

function ItemTree({ w, list, items }: { w: Words; list: string; items: DesignListItem[] }) {
  const editing = useContext(EditContext) !== null;
  if (items.length === 0) return null;
  return (
    <Box component="ul" sx={{ m: 0, pl: 3 }}>
      {items.map((i) => (
        <Typography component="li" variant="body2" key={i.code} sx={{ overflowWrap: "anywhere" }}>
          <Words target={{ kind: "item", list, code: i.code }} part="label" value={i.label} label={w.t("survey.edit.answer", { code: i.code })}>
            {textIn(i.label, w.language, w.design.languages) || i.code}{" "}
          </Words>
          {!editing && (
            <Typography component="span" variant="caption" color="text.secondary">
              ({i.code})
            </Typography>
          )}
          <ItemTree w={w} list={list} items={i.items} />
        </Typography>
      ))}
    </Box>
  );
}

/** The versions kept before each change, any of them brought back */
function VersionsCard({ projectId, revision, disabled, onRestored }: {
  projectId: string;
  revision: string | null;
  /** Changes not saved: saved or discarded first */
  disabled: boolean;
  onRestored: (answer: SurveyDesignAnswer) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const versions = useLoad(["project", projectId, "listSurveyVersions"], () => listSurveyVersions(projectId));
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const list = versions.data?.versions ?? [];

  const restore = async (id: string) => {
    if (!revision) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      onRestored(await restoreSurveyVersion(projectId, id, revision));
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  return (
    <FoldingCard keepFolded title={t("survey.versions.title")} summary={t("survey.versions.summary", { count: list.length })}>
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
      <ErrorAlert error={error} />
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

/** A list's answers in one line, the first ones only */
function answersText(w: Words, items: DesignListItem[]): string {
  const shown = items.slice(0, INLINE_ANSWERS).map((i) => textIn(i.label, w.language, w.design.languages) || i.code);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(", ")} ${w.t("survey.moreItems", { count: more })}` : shown.join(", ");
}

/** A language code's name in the dashboard's language ("es" -> "Spanish"), else the code */
function languageNames(uiLanguage: string): (code: string) => string {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([uiLanguage], { type: "language" });
  } catch {
    names = null;
  }
  return (code) => {
    try {
      return names?.of(code) ?? code;
    } catch {
      return code;
    }
  };
}
