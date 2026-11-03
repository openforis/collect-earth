import { apiGet, apiPost } from "./apiClient";
import type { Notice } from "./notices";

export const readNotices = (signal?: AbortSignal) => apiGet<{ notices: Notice[] }>("notices", signal).then((r) => r.notices);

/** Answers a notice; one answered already (by another page) is gone, which is no error for this page */
export const answerNotice = (id: string, option: string) => apiPost<void>("notices/" + encodeURIComponent(id) + "/answer", { option });
