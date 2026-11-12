/* Google Analytics (GA4), in the same property as openforis.org (G-8K943HZKJZ),
   so visits to collectearth.org show up there; filter the reports by hostname.
   As on openforis.org, it loads 3 seconds after the page opens, or at the
   visitor's first scroll, touch, mouse move or key press, so it never slows
   the page down. */
(function () {
  var ID = "G-8K943HZKJZ";
  var EVENTS = ["scroll", "mousemove", "touchstart", "keydown"];
  var loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    EVENTS.forEach(function (t) { window.removeEventListener(t, load); });
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ID);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
    document.head.appendChild(s);
  }

  EVENTS.forEach(function (t) { window.addEventListener(t, load, { passive: true }); });

  // A download link marked data-download="windows|macos|linux" (guide/install.html) counts as the
  // event CE_Beta_Download, with the system in the parameter os.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-download]");
    if (!a) return;
    load();
    window.gtag("event", "CE_Beta_Download", { os: a.getAttribute("data-download"), transport_type: "beacon" });
  });

  if (document.readyState === "complete") setTimeout(load, 3000);
  else window.addEventListener("load", function () { setTimeout(load, 3000); });
})();
