/*
 * Neural Frontier login theme: progressive enhancements only. Every page works without it;
 * Keycloak validates everything on the server.
 */
(function () {
  "use strict";
  var body = document.body;
  var msg = function (key, fallback) {
    return (body && body.dataset[key]) || fallback;
  };

  // Caps Lock warning on every password field.
  document.querySelectorAll('input[type="password"]').forEach(function (input) {
    var note = document.createElement("div");
    note.className = "nf-caps";
    note.setAttribute("role", "status");
    note.innerHTML = '<i class="nf-i nf-i-alert" aria-hidden="true"></i>';
    note.appendChild(document.createTextNode(msg("msgCaps", "Caps Lock is on")));
    var anchor = input.closest(".nf-input-group") || input;
    anchor.insertAdjacentElement("afterend", note);
    var update = function (e) {
      if (e.getModifierState) note.classList.toggle("is-on", e.getModifierState("CapsLock"));
    };
    input.addEventListener("keydown", update);
    input.addEventListener("keyup", update);
    input.addEventListener("blur", function () {
      note.classList.remove("is-on");
    });
  });

  // Live password guidance on "choose a new password".
  var pw = document.getElementById("password-new");
  var confirm = document.getElementById("password-confirm");
  if (pw) {
    var user = (body.dataset.user || "").toLowerCase();
    var local = user.split("@")[0];
    var guide = document.createElement("div");
    guide.className = "nf-pw-guide";
    guide.dataset.score = "0";
    guide.innerHTML =
      '<div class="nf-meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
      '<div class="nf-meter-label"><span>' +
      body.dataset.msgStrength +
      '</span><b aria-live="polite"></b></div>' +
      '<ul class="nf-rules">' +
      '<li data-rule="length">' +
      body.dataset.msgRuleLength +
      "</li>" +
      (user ? '<li data-rule="identity">' + body.dataset.msgRuleIdentity + "</li>" : "") +
      '<li data-rule="match">' +
      body.dataset.msgRuleMatch +
      "</li></ul>";
    (pw.closest(".nf-field") || pw.parentElement).appendChild(guide);
    var labels = (body.dataset.msgStrengths || "Too short|Weak|Fair|Good|Strong").split("|");
    var rule = function (name, ok) {
      var li = guide.querySelector('[data-rule="' + name + '"]');
      if (li) li.classList.toggle("is-met", ok);
    };
    var evaluate = function () {
      var v = pw.value;
      var lower = v.toLowerCase();
      var variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (r) {
        return r.test(v);
      }).length;
      var score = 0;
      if (v.length >= 12) {
        score = 1;
        if (variety >= 3 || v.length >= 16) score++;
        if (v.length >= 16 && variety >= 2) score++;
        if (v.length >= 20 || (v.length >= 14 && variety === 4)) score++;
      }
      score = Math.min(score, 4);
      guide.dataset.score = String(v ? Math.max(score, 1) : 0);
      guide.querySelector(".nf-meter-label b").textContent = v ? labels[score] : "";
      rule("length", v.length >= 12);
      rule(
        "identity",
        v.length > 0 &&
          !(
            user &&
            (lower.indexOf(user) !== -1 || (local.length > 2 && lower.indexOf(local) !== -1))
          ),
      );
      rule("match", !!confirm && v.length > 0 && confirm.value === v);
    };
    pw.addEventListener("input", evaluate);
    if (confirm) confirm.addEventListener("input", evaluate);
    evaluate();
  }

  // One-time codes: digits only; sign in automatically once six digits are entered.
  ["otp", "totp"].forEach(function (id) {
    var input = document.getElementById(id);
    if (!input) return;
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("maxlength", "6");
    input.setAttribute("placeholder", "••••••");
    input.addEventListener("input", function () {
      var digits = input.value.replace(/\D/g, "").slice(0, 6);
      if (digits !== input.value) input.value = digits;
      if (id === "otp" && digits.length === 6 && input.form) {
        var submit = input.form.querySelector('[type="submit"]');
        if (input.form.requestSubmit) input.form.requestSubmit(submit || undefined);
      }
    });
  });

  // Copy button for the manual authenticator key.
  var secret = document.getElementById("kc-totp-secret-key");
  if (secret && navigator.clipboard) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nf-copy";
    btn.innerHTML = '<i class="nf-i nf-i-copy" aria-hidden="true"></i><span></span>';
    var label = btn.querySelector("span");
    label.textContent = msg("msgCopy", "Copy");
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(secret.textContent.replace(/\s+/g, "")).then(function () {
        label.textContent = msg("msgCopied", "Copied");
        setTimeout(function () {
          label.textContent = msg("msgCopy", "Copy");
        }, 1600);
      });
    });
    secret.insertAdjacentElement("afterend", btn);
  }

  // Busy state on submit: shimmer + clearer label on the primary button.
  document.querySelectorAll("#kc-content form").forEach(function (form) {
    form.addEventListener("submit", function () {
      form.classList.add("nf-busy");
      var primary = form.querySelector('input[type="submit"][name="login"], #kc-login');
      if (primary && form.id === "kc-form-login") primary.value = msg("msgSigning", "Signing in…");
    });
  });
})();
