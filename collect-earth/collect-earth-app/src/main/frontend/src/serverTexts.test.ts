import { describe, expect, it } from "vitest";
import { serverText } from "./serverTexts";

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

  it("keeps a < that does not open a tag", () => {
    expect(serverText({ k: "Distance < 50 m" }, "k")).toBe("Distance < 50 m");
  });

  it("shows the key when the text is missing, as Messages does", () => {
    expect(serverText({}, "Nope.1")).toBe("!Nope.1!");
  });

  it("shows nothing while the texts are loading, rather than every key for a moment", () => {
    expect(serverText(null, "CollectEarthWindow.11")).toBe("");
  });
});
