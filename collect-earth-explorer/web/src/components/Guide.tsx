// The side pane's "how to use" guide, lazily loaded with its texts (configure/texts.ts) so the Explorer's chunk does not carry them.
import { t } from "../lib/i18n";
import { ct, USE_KEYS } from "../configure/texts";

export default function Guide({ onClose }: { onClose: () => void }) {
  return (
    <section className="guide" aria-label={ct("help.useTitle")}>
      <h3>{ct("help.useTitle")}</h3>
      <ul>
        {USE_KEYS.map((k) => (
          <li key={k}>{ct(k)}</li>
        ))}
      </ul>
      <button onClick={onClose}>{t("guide.close")}</button>
    </section>
  );
}
