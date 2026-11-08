# Trial S8: the AI analyst

What `docs/plans/2026-11-05-node-and-arena.md` ("The AI analyst", trial S8) asks: twenty questions a coordinator would
ask, in English, Spanish and French, put to the model; its answers checked against hand-written ones; its explanations
read by two coordinators.

The analyst answers in views (rows, columns, measures, filters, a chart), as the server's view proposals do
(`src/ai/analysisViews.ts`): it is sent the survey's structure only, never a plot, an answer or a person. So the trial:

1. asks each question (`questions.ts`) with the survey's structure, in the language of the question;
2. checks the answer as the server does (`validateProposals`);
3. turns the model's view and the hand-written one into figures in DuckDB, on 800 plots and 80 quality checks of
   trial data whose answers hang together (`data.ts`, `figures.ts`), and compares them: a view passes when every
   expected figure is the same, however it was built (rows and columns swapped, an extra measure, an equivalent
   filter);
4. gives the model the figures of its own view (collectors as Person A, B…) and asks it to explain them in a short
   paragraph; anything naming a collector or looking like coordinates is flagged.

Both views count first assessments only, as the analysis page does, unless they filter on the assessment.

## Running it

```bash
cd collect-earth-cloud/trials/s8-analyst && npm install && cd ../..
npx tsx trials/s8-analyst/run.mts --model expected   # the hand-written views: 60 / 60 (the trial checks itself)
npx tsx trials/s8-analyst/run.mts --model broken     # one deliberate mistake per question: 0 / 20 must pass
npx tsx trials/s8-analyst/run.mts --model echo       # a stand-in model through the model's own path
AI_VERTEX_API_KEY=… npx tsx trials/s8-analyst/run.mts --model gemini
```

With Gemini, `AI_VERTEX_PROJECT` and the machine's Google credentials work instead of a key, and `AI_MODEL` picks
another model, as for the server. `--lang en,es` and `--only q01,q02` narrow the run. The report (Markdown, for the
coordinators) and the results (JSON) go to `out/`.

## What is left for the trial itself

- The run with Gemini: not done yet (no Vertex AI key in the session that built the trial).
- One real survey besides the demo: add its project file to `data.ts` and its own questions.
- The two coordinators' reading of the explanations (step B), from the report.
