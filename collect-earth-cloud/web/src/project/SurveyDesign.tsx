import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useId, useMemo, useState, type ReactNode } from "react";
import { getSurveyDesign, type DesignList, type DesignListItem, type DesignPage, type DesignQuestion, type DesignTable } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FoldingCard } from "../components/FoldingCard";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";
import { conditionWords, firstLanguage, requiredWords, ruleWords, textIn, TYPE_KEYS, untranslated, words, type Words } from "./surveyDesignView";

/** The most answers a question shows inline; the list's card has them all */
const INLINE_ANSWERS = 12;

/**
 * Setup › Survey form: the project's survey as the people collecting meet it, page by page, read from the project
 * file (docs/plans/2026-11-18-survey-designer.md, stage 1). Read-only: the survey changes with a new project file.
 */
export function SurveyDesignCards({ projectId }: { projectId: string }) {
  const t = useT();
  const { language: uiLanguage } = useApp();
  const loaded = useLoad(["project", projectId, "getSurveyDesign"], () => getSurveyDesign(projectId));
  const design = loaded.data?.design ?? null;
  // The survey's language shown, the same in every card: the dashboard's while none is chosen
  const [chosen, setChosen] = useState<string | null>(null);
  const language = design ? (chosen && design.languages.includes(chosen) ? chosen : firstLanguage(design, uiLanguage)) : "";
  const w = useMemo(() => (design ? words(design, language, t) : null), [design, language, t]);
  return (
    <>
      <Paper variant="outlined" component="section" aria-labelledby="survey-design-title" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" id="survey-design-title" gutterBottom>
          {t("survey.title")}
        </Typography>
        <Explain sx={{ mb: 2 }} text={t("survey.explain.short")} more={t("survey.explain")} />
        {loaded.error ? (
          <ErrorAlert error={loaded.error} onRetry={loaded.reload} />
        ) : !loaded.data ? (
          <Loading />
        ) : loaded.data.unreadable ? (
          <Alert severity="warning">{t("survey.unreadable")}</Alert>
        ) : !w ? (
          <Alert severity="info">{t("survey.none")}</Alert>
        ) : (
          <DesignView w={w} onLanguage={setChosen} />
        )}
      </Paper>
      {w && <DesignCards w={w} />}
    </>
  );
}

/** The survey's title, its languages and its pages */
function DesignView({ w, onLanguage }: { w: Words; onLanguage: (language: string) => void }) {
  const { design, language, t } = w;
  const { language: uiLanguage } = useApp();
  const missing = useMemo(() => untranslated(design, language), [design, language]);
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
  const questions = design.pages.reduce((n, p) => n + p.items.reduce((m, i) => m + (i.kind === "table" ? i.columns.length : 1), 0), 0);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography sx={{ fontWeight: 600 }}>{textIn(design.title, language, design.languages) || t("survey.noLabel")}</Typography>
        <Typography color="text.secondary">{t("survey.counts", { pages: design.pages.length, questions, lists: design.lists.length })}</Typography>
      </Box>
      {design.languages.length > 1 && (
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

function QuestionView({ w, q }: { w: Words; q: DesignQuestion }) {
  const { t } = w;
  const label = textIn(q.label, w.language, w.design.languages);
  const help = textIn(q.help, w.language, w.design.languages);
  const required = requiredWords(w, q);
  const list = q.list ? w.lists.get(q.list) : undefined;
  return (
    <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: q.hidden || q.formulas ? "divider" : "primary.light" }}>
      <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{label || q.name}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", my: 0.5 }}>
        <Chip size="small" label={t(TYPE_KEYS[q.type])} />
        {required && q.required === "always" && <Chip size="small" color="primary" variant="outlined" label={required} />}
        {q.key && <Chip size="small" variant="outlined" label={t("survey.key")} />}
        {q.hidden && <Chip size="small" variant="outlined" label={t("survey.notShown")} />}
        {q.formulas && <Chip size="small" variant="outlined" label={t("survey.isCalculated")} />}
        {q.layout && <Chip size="small" variant="outlined" label={t(q.layout === "buttons" ? "survey.layout.buttons" : "survey.layout.dropdown")} />}
        {q.notExported && <Chip size="small" variant="outlined" label={t("survey.notExported")} />}
      </Stack>
      {help && (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere", mb: 0.5 }}>
          {help}
        </Typography>
      )}
      {q.shownWhen && q.shownWhen.kind !== "never" && <Detail>{t("survey.shownWhen", { condition: conditionWords(w, q.shownWhen) })}</Detail>}
      {required && q.required !== "always" && <Detail>{required}</Detail>}
      {q.parentQuestion && <Detail>{t("survey.subList", { question: textIn(w.questions.get(q.parentQuestion)?.label ?? {}, w.language, w.design.languages) || q.parentQuestion })}</Detail>}
      {list && !q.formulas && <Detail>{t("survey.answers", { items: answersText(w, list.items) })}</Detail>}
      {q.rules.map((r, i) => (
        <Detail key={i} tone={r.flag === "warning" ? "warning" : undefined}>
          {ruleWords(w, r)}
          {textIn(r.message, w.language, w.design.languages) && ` — ${t("survey.rule.message", { message: textIn(r.message, w.language, w.design.languages) })}`}
        </Detail>
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

function TableView({ w, table }: { w: Words; table: DesignTable }) {
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
      <Typography sx={{ fontWeight: 600 }}>{textIn(table.label, w.language, w.design.languages) || table.name}</Typography>
      <Detail>{kind}</Detail>
      {list && <Detail>{t("survey.answers", { items: answersText(w, list.items) })}</Detail>}
      {help && <Detail>{help}</Detail>}
      {table.shownWhen && <Detail>{t("survey.shownWhen", { condition: conditionWords(w, table.shownWhen) })}</Detail>}
      <Stack spacing={2} sx={{ mt: 1.5 }}>
        {table.columns.map((c) => (
          <QuestionView key={c.name} w={w} q={c} />
        ))}
      </Stack>
    </Box>
  );
}

function ListView({ w, list }: { w: Words; list: DesignList }) {
  const { t } = w;
  return (
    <Box sx={{ pl: 1.5, borderLeft: 3, borderColor: "divider" }}>
      <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{textIn(list.label, w.language, w.design.languages) || list.name}</Typography>
      <Detail>
        {[
          t("survey.list.count", { count: list.items.length }),
          list.usedBy.length > 0 ? t("survey.list.usedBy", { names: list.usedBy.join(", ") }) : t("survey.list.unused"),
          ...(list.external ? [t("survey.list.external")] : []),
        ].join(" · ")}
      </Detail>
      <ItemTree w={w} items={list.items} />
      <Typography variant="caption" color="text.secondary">
        {t("survey.name", { name: list.name })}
      </Typography>
    </Box>
  );
}

function ItemTree({ w, items }: { w: Words; items: DesignListItem[] }) {
  if (items.length === 0) return null;
  return (
    <Box component="ul" sx={{ m: 0, pl: 3 }}>
      {items.map((i) => (
        <Typography component="li" variant="body2" key={i.code} sx={{ overflowWrap: "anywhere" }}>
          {textIn(i.label, w.language, w.design.languages) || i.code}{" "}
          <Typography component="span" variant="caption" color="text.secondary">
            ({i.code})
          </Typography>
          <ItemTree w={w} items={i.items} />
        </Typography>
      ))}
    </Box>
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
