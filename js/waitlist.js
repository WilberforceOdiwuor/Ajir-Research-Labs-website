// waitlist.js
// Pre-release sign-up only. No inline script — the page CSP is script-src 'self'.

// The publishable key is meant to be public. It buys nothing on its own:
// public.waitlist_signups grants nothing to anon, so this key cannot read or
// write the table. The edge function is the only writer, and it authenticates
// as service_role on the server side.
const WL_ENDPOINT = "https://zrtvvbnpmgyjebkhunes.supabase.co/functions/v1/waitlist-signup";
const WL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydHZ2Ym5wbWd5amVia2h1bmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTQ3MzUsImV4cCI6MjA5MTczMDczNX0.BrWhVu9v_pOQnDYCDxeExAJUFZr95eRE2BGnzLDXmM8";

const WL_TIMEOUT_MS = 12000;

// Deliberately the same shape the edge function accepts. The server validates
// again regardless — this check exists to answer the person faster, not to be
// trusted.
const WL_EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

const WL_MESSAGES = {
  invalid_email: "That does not look like an email address. Check it and try again.",
  rate_limited: "That is a few tries in a short window. Give it a minute, then try again.",
  offline: "No connection reached us. Check your network and try again.",
  fallback: "Something broke on our side. Write to contact@ajirresearch.com and we will add you by hand.",
};

function wlSetStatus(el, message, tone) {
  if (!el) return;
  el.textContent = message || "";
  el.dataset.tone = tone || "";
}

// Which button on the product page sent them here, so the table records the
// surface rather than guessing. Anything unrecognised becomes "web" server-side.
function wlReadSource() {
  try {
    const value = new URLSearchParams(window.location.search).get("from");
    return value && /^[a-z-]{1,32}$/.test(value) ? value : "pre-release";
  } catch (err) {
    return "pre-release";
  }
}

async function wlSubmit(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WL_TIMEOUT_MS);

  try {
    const res = await fetch(WL_ENDPOINT, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        "apikey": WL_KEY,
        "Authorization": `Bearer ${WL_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body = {};
    try {
      body = await res.json();
    } catch (err) {
      body = {};
    }

    return { ok: res.ok && body.ok === true, error: body.error, status: res.status };
  } catch (err) {
    // AbortError and network failures land here alike; neither tells the
    // person anything useful beyond "it did not go".
    return { ok: false, error: "offline", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function wlInit() {
  const form = document.querySelector("[data-waitlist-form]");
  if (!form) return;

  const emailField = form.querySelector("[name='email']");
  const newsletterField = form.querySelector("[name='newsletter']");
  const honeypotField = form.querySelector("[name='company']");
  const submitButton = form.querySelector("[type='submit']");
  const status = form.querySelector("[data-waitlist-status]");
  const done = document.querySelector("[data-waitlist-done]");
  const doneEmail = document.querySelector("[data-waitlist-done-email]");
  const doneNewsletter = document.querySelector("[data-waitlist-done-newsletter]");

  if (!emailField || !submitButton) return;

  let inFlight = false;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (inFlight) return;

    const email = emailField.value.trim().toLowerCase();
    const newsletter = Boolean(newsletterField && newsletterField.checked);

    if (!WL_EMAIL_SHAPE.test(email) || email.length < 6 || email.length > 254) {
      wlSetStatus(status, WL_MESSAGES.invalid_email, "error");
      emailField.focus();
      return;
    }

    inFlight = true;
    submitButton.disabled = true;
    const restoreLabel = submitButton.textContent;
    submitButton.textContent = "Sending…";
    wlSetStatus(status, "", "");

    const result = await wlSubmit({
      email,
      newsletter,
      source: wlReadSource(),
      company: honeypotField ? honeypotField.value : "",
    });

    inFlight = false;
    submitButton.disabled = false;
    submitButton.textContent = restoreLabel;

    if (result.ok) {
      if (doneEmail) doneEmail.textContent = email;
      if (doneNewsletter) {
        doneNewsletter.textContent = newsletter
          ? "You are on the newsletter too."
          : "You are not on the newsletter — only the access note.";
      }
      if (done) {
        form.hidden = true;
        done.hidden = false;
        const heading = done.querySelector("h2, [data-waitlist-done-focus]");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus();
        }
      } else {
        wlSetStatus(status, "You are on the list.", "ok");
      }
      return;
    }

    wlSetStatus(status, WL_MESSAGES[result.error] || WL_MESSAGES.fallback, "error");
  });
}

document.addEventListener("DOMContentLoaded", wlInit);
