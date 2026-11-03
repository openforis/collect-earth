import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadServerTexts, serverText } from "./serverTexts";

describe("serverText", () => {
  it("gives the text of a key", () => {
    expect(serverText({ "CollectEarthWindow.11": "Salir" }, "CollectEarthWindow.11")).toBe("Salir");
  });

  it("drops the Swing HTML and the mnemonic marks", () => {
    expect(serverText({ k: "<html>Are you sure?<br>Really</html>" }, "k")).toBe("Are you sure?\nReally");
    expect(serverText({ k: "&Exit" }, "k")).toBe("Exit");
  });

  it("drops the tags of the real texts, misspelt ones too", () => {
    // CollectEarthWindow.35 closes with </hml>; the Mongolian texts have tags translated and spaced (</ Б>, <би>)
    expect(serverText({ k: "<html>OPERATOR NAME EMPTY!<br>Please fill the operator name.</hml>" }, "k"))
      .toBe("OPERATOR NAME EMPTY!\nPlease fill the operator name.");
    expect(serverText({ k: "<HTML> <б> Сервер </ Б> <br/> Тийм үү? </ HTML>" }, "k")).toBe("Сервер\nТийм үү?");
    expect(serverText({ k: "<html><b>Bold</b> and <i>italic</i>, <a href='https://www.openforis.org'>a link</a></html>" }, "k"))
      .toBe("Bold and italic, a link");
  });

  it("keeps a real & and decodes the common entities", () => {
    expect(serverText({ k: "Save & Apply changes" }, "k")).toBe("Save & Apply changes");
    expect(serverText({ k: "R&D" }, "k")).toBe("R&D");
    expect(serverText({ k: "<html>Tom&nbsp;&amp;&nbsp;Jerry &lt;3 &quot;x&quot; &#39;y&#39;</html>" }, "k"))
      .toBe("Tom & Jerry <3 \"x\" 'y'");
    // An entity is decoded once: &amp;lt; is the text "&lt;", not "<"
    expect(serverText({ k: "&amp;lt;" }, "k")).toBe("&lt;");
  });

  it("decodes hexadecimal character codes, and leaves one beyond Unicode as it is", () => {
    expect(serverText({ k: "it&#x27;s &#X41;" }, "k")).toBe("it's A");
    expect(serverText({ k: "a&#99999999;b &#x110000;" }, "k")).toBe("a&#99999999;b &#x110000;");
  });

  it("keeps a < that does not open a tag", () => {
    expect(serverText({ k: "Distance < 50 m" }, "k")).toBe("Distance < 50 m");
  });

  it("shows the key when the text is missing, as Messages does", () => {
    expect(serverText({}, "Nope.1")).toBe("!Nope.1!");
  });

  it("shows nothing while the texts are loading, rather than every key for a moment", () => {
    expect(serverText(null, "CollectEarthWindow.11")).toBe("");
    expect(serverText(undefined, "CollectEarthWindow.11")).toBe("");
  });
});

describe("loadServerTexts", () => {
  // The tests run in node, which has no window: the client reads the page's origin from it
  beforeEach(() => vi.stubGlobal("window", { location: { origin: "http://localhost:8028" } }));
  afterEach(() => vi.unstubAllGlobals());

  const answering = (body: string) => vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status: 200 }));

  it("asks for the language", async () => {
    const fetchMock = answering(JSON.stringify({ language: "es", texts: { "CollectEarthWindow.11": "Salir" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadServerTexts("es")).toEqual({ "CollectEarthWindow.11": "Salir" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8028/earth/api/messages?lang=es");
  });

  it("gives no texts, rather than failing, for an answer without them", async () => {
    vi.stubGlobal("fetch", answering(""));
    expect(await loadServerTexts("es")).toEqual({});
    vi.stubGlobal("fetch", answering(JSON.stringify({ language: "es" })));
    expect(await loadServerTexts("es")).toEqual({});
  });
});
