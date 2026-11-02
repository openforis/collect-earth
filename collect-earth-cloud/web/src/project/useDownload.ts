import { getExport, type ExportKind } from "../api";
import { dailyCsv, decisionsCsv, differencesCsv } from "../activityView";
import { useApp } from "../appContext";
import { csvBlob, csvTime } from "../csv";
import { useT } from "../i18n";
import { peopleCsv, sortPeople } from "../peopleView";
import { browserTimeZone } from "../progressView";
import { saveBlob } from "../saveBlob";

/**
 * The CSV downloads (coordinators): the rows come from the server, which notes each download in
 * the activity log; the CSV is written here in the person's language, times in their zone.
 */
export function useDownload(projectId: string): (kind: ExportKind) => Promise<void> {
  const t = useT();
  const { language } = useApp();
  return async (kind: ExportKind) => {
    const data = await getExport(projectId, kind, browserTimeZone());
    let csv: string;
    if (data.kind === "people") csv = peopleCsv(t, sortPeople(data.rows, "username", "asc"), csvTime, language);
    else if (data.kind === "daily") csv = dailyCsv(t, data.rows, language);
    else if (data.kind === "decisions") csv = decisionsCsv(t, data.rows, csvTime, language);
    else csv = differencesCsv(t, data, language);
    saveBlob(csvBlob(csv), `${kind}-${data.today}.csv`);
  };
}
