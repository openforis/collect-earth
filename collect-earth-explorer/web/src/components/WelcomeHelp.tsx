// The landing page's help, lazily loaded with its texts (configure/texts.ts) so the Explorer's chunk does not carry them.
import { lang } from "../lib/i18n";
import { ct, USE_KEYS, type CKey } from "../configure/texts";

const DASHBOARD = "https://cloud.collectearth.org";
const items = (keys: CKey[]) => keys.map((k) => <li key={k}>{ct(k)}</li>);

export default function WelcomeHelp() {
  return (
    <div className="welcome-help">
      <h2>{ct("help.fitTitle")}</h2>
      <ol>
        <li>
          {ct("help.fit1")}
          <br />
          <a href={DASHBOARD} target="_blank" rel="noreferrer">cloud.collectearth.org</a>
        </li>
        {items(["help.fit2", "help.fit3"])}
      </ol>
      <h2>{ct("help.useTitle")}</h2>
      <ul>{items(USE_KEYS)}</ul>
      <h2>{ct("help.setupTitle")}</h2>
      <ul>{items(["help.dashboard", "help.desktop"])}</ul>
      <p>
        <a href={`/configure?lang=${lang}`}>{ct("help.try")}</a>
        <br />
        {ct("help.notSaved")}
      </p>
    </div>
  );
}
