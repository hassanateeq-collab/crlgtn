/* Shared behaviour for the Corlington marketing pages.
   Each page sets FORM_MODE ("corporate" on the home page, "vendor" on the
   vendor page) before loading this file — the two audiences have their own
   pages, so the form no longer toggles between them. */

var LEAD_ENDPOINT = "https://cfnaxfvoshbxjnqbrfgu.supabase.co/functions/v1/ef_lead";
var DESK = "desk@corlington.com";

(function () {
  var kind = window.FORM_MODE === "vendor" ? "vendor" : "corporate";
  var form = document.getElementById("frm");

  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  // Live countdown on the product shot, if this page shows one.
  var cd = document.getElementById("cd");
  if (cd) {
    var t = 6442;
    setInterval(function () {
      t = t > 0 ? t - 1 : 6442;
      var h = Math.floor(t / 3600),
          m = String(Math.floor(t % 3600 / 60)).padStart(2, "0"),
          s = String(t % 60).padStart(2, "0");
      cd.textContent = "0" + h + ":" + m + ":" + s;
    }, 1000);
  }

  if (!form) return;

  var btn = form.querySelector('button[type="submit"]');
  var note = document.getElementById("f-note");
  var busy = false;

  function say(text, kindOfMessage) {
    if (!note) return;
    note.textContent = text;
    note.className = "fmsg " + (kindOfMessage || "");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;

    var v = function (n) { return (form[n] && form[n].value || "").trim(); };

    // The browser's own required/type=email checks run first; this catches the
    // rest so a visitor never waits on a round trip to be told a field is empty.
    if (!v("org") || !v("person") || !v("email") || !v("phone")) {
      say("Please fill in your name, organisation, email and phone.", "err");
      return;
    }

    busy = true;
    var original = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    say("");

    fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: kind,
        org: v("org"),
        person: v("person"),
        email: v("email"),
        phone: v("phone"),
        city: v("city"),
        volume: v("extra"),
        notes: v("notes"),
        company_website: v("company_website"), // honeypot
        source_page: location.pathname
      })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { r: r, b: b }; }); })
      .then(function (res) {
        if (res.r.ok && res.b && res.b.ok) {
          form.innerHTML =
            '<div class="fdone">' +
              '<div class="fdone-mk">✓</div>' +
              '<h3>Thank you — we have it.</h3>' +
              '<p>Someone from Corlington will come back to you at <b>' +
                v("email").replace(/[<>&]/g, "") + '</b>, usually within one working day.</p>' +
            '</div>';
          return;
        }
        var msg = (res.b && res.b.error && res.b.error.message) || "";
        if (res.r.status === 429) {
          say("That is a few requests in a short time. Please try again in a few minutes.", "err");
        } else {
          say(msg || "Something went wrong sending that. Please email " + DESK + " and we will pick it up.", "err");
        }
      })
      .catch(function () {
        say("We could not reach the server. Please email " + DESK + " and we will pick it up.", "err");
      })
      .then(function () {
        busy = false;
        if (btn) { btn.disabled = false; btn.textContent = original; }
      });
  });
})();
