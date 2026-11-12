/* "Find your set-up": a few questions, one at a time, leading to a set-up.
   Markup: a [data-decide] box with [data-step] panels; buttons carry data-go
   with the next step's name, or "start" to begin again. Without JavaScript the
   panels stay hidden and the plain list next to them (.decide-static) shows. */
(function () {
  document.querySelectorAll("[data-decide]").forEach(function (box) {
    var first = box.getAttribute("data-start");
    var steps = box.querySelectorAll("[data-step]");
    var trail = box.querySelector("[data-trail]");
    var answers = [];

    function show(name, focus) {
      steps.forEach(function (s) { s.hidden = s.getAttribute("data-step") !== name; });
      if (trail) {
        trail.hidden = answers.length === 0;
        trail.innerHTML = "";
        answers.forEach(function (a) {
          var chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = a;
          trail.appendChild(chip);
        });
      }
      var heading = box.querySelector('[data-step="' + name + '"] h3');
      if (focus && heading) heading.focus({ preventScroll: true });
    }

    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-go]");
      if (!b || !box.contains(b)) return;
      var go = b.getAttribute("data-go");
      if (go === "start") { answers = []; show(first, true); return; }
      answers.push(b.textContent.trim());
      show(go, true);
    });

    box.classList.add("ready");
    show(first, false);
  });
})();
