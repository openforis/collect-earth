# Trial S7: the same figures from the CSVs, independently (plain Python), compared with the page's pivot and DuckDB.
import csv, json, sys
from collections import defaultdict
rows = sys.argv[1]
out = "../out"
labels = {}
for name in ["land_uses", "climate_zones", "land_cover_elements"]:
    labels[name] = {r["code"]: r["label_en"] for r in csv.DictReader(open(f"{out}/list-{name}.csv", encoding="utf-8"))}
plots = list(csv.DictReader(open(f"{out}/plot-{rows}.csv", encoding="utf-8")))
covers = list(csv.DictReader(open(f"{out}/land_cover-{rows}.csv", encoding="utf-8")))

A = defaultdict(lambda: [set(), 0.0])
B = defaultdict(lambda: [0, 0.0, 0])
for p in plots:
    k = labels["land_uses"].get(p["land_use_category"], p["land_use_category"])
    A[k][0].add(p["id"]); A[k][1] += float(p["expansion_factor"])
    c = labels["climate_zones"].get(p["climate"], p["climate"])
    B[c][0] += 1; B[c][1] += float(p["forest_percentage"]); B[c][2] += 1 if p["land_use_assessment_confidence"] == "true" else 0
E = defaultdict(lambda: [0, 0.0])
for c in covers:
    k = labels["land_cover_elements"].get(c["element"], c["element"])
    E[k][0] += 1; E[k][1] += float(c["percentage"])

def close(a, b, rel=1e-6):
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))

report = {"rows": int(rows), "checks": []}
chk = json.load(open(f"{out}/check-plot-{rows}.json"))
ok = True
for r in chk["A"]["pivot"]:
    py = A[r["k"]]
    good = len(py[0]) == r["plot_count"] and close(py[1], r["area"])
    ok &= good
    report["checks"].append({"A": r["k"], "pivot": [r["plot_count"], round(r["area"], 2)], "python": [len(py[0]), round(py[1], 2)], "ok": good})
for r in chk["A"]["sql"]:
    good = len(A[r["k"]][0]) == r["plot_count"] and close(A[r["k"]][1], r["area"]); ok &= good
    if not good: report["checks"].append({"A-sql": r["k"], "ok": False, "sql": r})
for r in chk["B"]["pivot"]:
    py = B[r["k"]]
    good = close(py[1] / py[0], r["forest_percentage"], 1e-6) and close(py[2] / py[0], r["confident"], 1e-6); ok &= good
    report["checks"].append({"B": r["k"], "pivot": [round(r["forest_percentage"], 3), round(r["confident"], 3)], "python": [round(py[1] / py[0], 3), round(py[2] / py[0], 3)], "ok": good})
total_area = sum(float(p["expansion_factor"]) for p in plots)
report["checks"].append({"total": "area", "pivot": round(chk["A"]["total"]["area"], 2), "python": round(total_area, 2), "ok": close(total_area, chk["A"]["total"]["area"])})
ok &= close(total_area, chk["A"]["total"]["area"])
try:
    chk2 = json.load(open(f"{out}/check-land_cover-{rows}.json"))
    for r in chk2["E"]["pivot"]:
        py = E[r["k"]]
        good = py[0] == r["rows"] and close(py[1] / py[0], r["pct"]); ok &= good
        report["checks"].append({"E": r["k"], "pivot": [r["rows"], round(r["pct"], 3)], "python": [py[0], round(py[1] / py[0], 3)], "ok": good})
except FileNotFoundError:
    pass
report["allOk"] = bool(ok)
json.dump(report, open(f"{out}/compare-{rows}.json", "w"), indent=1)
print(json.dumps(report, indent=1))
