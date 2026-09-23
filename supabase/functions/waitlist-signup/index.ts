// AskNoema pre-release sign-up.
//
// The browser never touches the table. public.waitlist_signups has RLS on with
// no policies, so the publishable key in the page source cannot read or write
// it; this function is the only writer and it authenticates as service_role.
//
// It stores exactly two things a person gave us — an email address and a
// newsletter answer — plus which button they came from. The caller's IP is
// used for in-memory rate limiting and is never written to the database.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// CORS is a browser-side courtesy, not a security boundary — anything with a
// socket can set its own Origin. The real defences below are validation, the
// honeypot and the rate limit. Localhost is here so the page can be tested
// before it ships.
const ALLOWED_ORIGINS = new Set([
  "https://ajirresearch.com",
  "https://www.ajirresearch.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

const DEFAULT_ORIGIN = "https://ajirresearch.com";

// Deliberately loose: the only claim being made is "this is shaped like an
// address". Whether it receives mail is settled by mail, not by a regex.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

const KNOWN_SOURCES = new Set([
  "product-hero",
  "product-closing",
  "pre-release",
  "web",
]);

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MAX_TRACKED_IPS = 5000;

// Per-instance and lost on cold start, which is fine: this exists to blunt a
// bored script, not to be an authority on who has asked.
const hits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const seen = hits.get(ip);

  if (!seen || now > seen.resetAt) {
    if (hits.size > MAX_TRACKED_IPS) {
      for (const [key, value] of hits) {
        if (now > value.resetAt) hits.delete(key);
      }
    }
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  seen.count += 1;
  return seen.count > MAX_PER_WINDOW;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function reply(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return reply({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return reply({ ok: false, error: "forbidden_origin" }, 403, origin);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (isRateLimited(ip)) {
    return reply({ ok: false, error: "rate_limited" }, 429, origin);
  }

  let payload: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 2000) {
      return reply({ ok: false, error: "payload_too_large" }, 413, origin);
    }
    payload = JSON.parse(raw || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return reply({ ok: false, error: "bad_json" }, 400, origin);
    }
  } catch {
    return reply({ ok: false, error: "bad_json" }, 400, origin);
  }

  // The honeypot field is hidden from people and irresistible to bots. A hit
  // gets a cheerful 200 and goes nowhere, so the script has nothing to tune.
  if (typeof payload.company === "string" && payload.company.trim() !== "") {
    return reply({ ok: true }, 200, origin);
  }

  const email = String(payload.email ?? "").trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    return reply({ ok: false, error: "invalid_email" }, 422, origin);
  }

  const newsletterOptIn = payload.newsletter === true ||
    payload.newsletter === "true" ||
    payload.newsletter === "on";

  const claimedSource = String(payload.source ?? "web");
  const source = KNOWN_SOURCES.has(claimedSource) ? claimedSource : "web";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("waitlist-signup is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return reply({ ok: false, error: "store_unavailable" }, 503, origin);
  }

  // Insert only. The database unique constraint on the normalized email is
  // authoritative, including when two requests arrive at the same time.
  // Repeat requests must not overwrite consent, status, source, or timestamps.
  let stored: Response;
  try {
    stored = await fetch(`${SUPABASE_URL}/rest/v1/waitlist_signups`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        email,
        newsletter_opt_in: newsletterOptIn,
        source,
      }),
    });
  } catch (err) {
    console.error("waitlist-signup could not reach PostgREST", err);
    return reply({ ok: false, error: "store_unavailable" }, 503, origin);
  }

  if (!stored.ok) {
    let failure: { code?: string } = {};
    try { failure = await stored.json(); } catch { /* A provider error may not be JSON. */ }
    if (stored.status === 409 && failure?.code === "23505") {
      return reply({ ok: false, error: "already_registered" }, 409, origin);
    }
    // Keep database details and submitted addresses out of responses and logs.
    console.error("waitlist-signup write failed", stored.status, failure?.code);
    return reply({ ok: false, error: "store_failed" }, 502, origin);
  }

  // Only a newly inserted request reaches the normal confirmation screen.
  return reply({ ok: true }, 200, origin);
});
