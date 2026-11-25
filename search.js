/* Search, in the header of every page. It all happens in the visitor's browser:
   on first use it fetches the pages below from this site, splits each page's
   <main> into sections at its h1, h2 and h3 headings and keeps them in memory.
   Queries go nowhere, not even into the address, so analytics never sees them.
   A new guide only needs adding to PAGES. */
(function () {
  var PAGES = ["./", "guide/choose.html", "guide/sampling.html", "guide/install.html",
    "guide/interpreters.html", "guide/land-use-change.html", "guide/explorer.html",
    "guide/coordinators.html", "guide/mapathon.html", "guide/own-server.html"];
  var MAX = 10;
  var INLINE = /^(A|ABBR|B|CODE|EM|I|KBD|MARK|SMALL|SPAN|STRONG|SUB|SUP)$/;
  var root = new URL(".", document.currentScript.src); // the site root, from the home page or from guide/
  var box = document.querySelector(".site-search");
  if (!box) return;
  var input = box.querySelector("input");
  var panel = box.querySelector(".search-results");
  var status = box.querySelector(".search-status");
  var list = panel.querySelector("ul");
  var header = box.closest("header");
  var sections, loading;

  function load() {
    return loading || (loading = Promise.all(PAGES.map(function (path) {
      var url = new URL(path, root).href;
      return fetch(url)
        .then(function (r) { return r.ok ? r.text() : ""; })
        .catch(function () { return ""; }) // a page that fails is left out; the others still work
        .then(function (html) { return split(new DOMParser().parseFromString(html, "text/html"), url); });
    })).then(function (pages) { sections = pages.flat(); }));
  }

  function clean(s) { return s.replace(/\s+/g, " ").trim(); }

  function split(doc, url) {
    var main = doc.querySelector("main"), out = [], cur, anchor = "";
    if (!main) return out;
    var page = doc.title.split(" · ")[0];
    var walk = doc.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, function (n) {
      // the contents list repeats the headings, and the set-up quiz the list beside it
      return n.nodeType === 1 && n.matches(".toc, [data-decide]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    });
    for (var n; (n = walk.nextNode());) {
      if (n.nodeType === 3) {
        if (cur && !n.parentNode.closest("h1, h2, h3")) cur.body += n.data;
      } else if (/^H[1-3]$/.test(n.tagName)) {
        // a heading without an id links to the closest id around it, or else the one before it
        anchor = (n.closest("[id]") || {}).id || anchor;
        out.push(cur = { page: page, url: url + (anchor && "#" + anchor), head: clean(n.textContent), body: "" });
      } else if (cur && !INLINE.test(n.tagName)) {
        cur.body += " "; // keeps "<td>a</td><td>b</td>" two words
      }
    }
    out.forEach(function (s) { s.body = clean(s.body); });
    return out;
  }

  function search(q) {
    var words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    // the words hold only letters and digits, so they are safe inside a RegExp
    var tests = words.map(function (w) { return new RegExp("(?:^|[^\\p{L}\\p{N}])" + w, "giu"); });
    var hits = [];
    if (words.length) sections.forEach(function (s) {
      var head = s.page + " " + s.head, inHead = 0, inBody = 0;
      for (var i = 0; i < tests.length; i++) {
        var h = head.search(tests[i]) >= 0, b = (s.body.match(tests[i]) || []).length;
        if (!h && !b) return;
        inHead += h; inBody += b;
      }
      hits.push({ s: s, head: inHead, body: inBody });
    });
    hits.sort(function (a, b) { return b.head - a.head || b.body - a.body; });
    return { hits: hits, re: new RegExp("(^|[^\\p{L}\\p{N}])((?:" + words.join("|") + ")[\\p{L}\\p{N}]*)", "giu") };
  }

  function snippet(text, re) {
    re.lastIndex = 0;
    var m = re.exec(text), at = m ? m.index : 0;
    var start = at > 50 ? text.indexOf(" ", at - 50) + 1 : 0;
    var end = text.length > start + 170 ? Math.max(text.lastIndexOf(" ", start + 170), start + 120) : text.length;
    return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }

  // Puts text into el, the matched words in <mark>, as text nodes: never parsed as HTML.
  function mark(el, text, re) {
    var last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      var at = m.index + m[1].length;
      el.append(text.slice(last, at), make("mark", "", m[2]));
      last = at + m[2].length;
    }
    el.append(text.slice(last));
    return el;
  }

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  function render() {
    var q = input.value.trim();
    list.textContent = "";
    status.textContent = "";
    if (!q) return;
    var r = search(q), n = r.hits.length;
    status.textContent = !n ? "Nothing matches “" + q + "”."
      : n + (n === 1 ? " section matches" : " sections match") + (n > MAX ? ", the best " + MAX + " below." : ".");
    r.hits.slice(0, MAX).forEach(function (h) {
      var a = make("a");
      a.href = h.s.url;
      a.append(make("span", "search-page", h.s.page), mark(make("strong"), h.s.head, r.re), mark(make("span"), snippet(h.s.body, r.re), r.re));
      list.appendChild(make("li")).append(a);
    });
  }

  function update() {
    if (!sections) status.textContent = "Loading the guides…";
    load().then(render);
  }

  input.addEventListener("focus", function () {
    if (header.classList.contains("open")) header.querySelector(".menu-toggle").click(); // one panel under the header at a time
    update();
  });
  input.addEventListener("input", update);

  box.addEventListener("keydown", function (e) {
    var links = Array.from(list.querySelectorAll("a")), i = links.indexOf(document.activeElement);
    if (e.key === "Escape") {
      input.focus();
      input.blur();
    } else if (e.key === "Enter" && i < 0 && links[0]) {
      links[0].click();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      i += e.key === "ArrowDown" ? 1 : -1;
      (i < 0 ? input : links[Math.min(i, links.length - 1)] || input).focus();
    }
  });
  // The list shows while the focus is in the search box: keep it in the field on a click,
  // or Safari, which does not focus links, closes the list before the click lands.
  panel.addEventListener("mousedown", function (e) { e.preventDefault(); });
  list.addEventListener("click", function () { document.activeElement.blur(); }); // closes it, also for a link to this page
})();
