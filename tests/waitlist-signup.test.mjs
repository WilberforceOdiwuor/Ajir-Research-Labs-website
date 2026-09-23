import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const backend = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/waitlist-signup/index.ts', import.meta.url), 'utf8'));
const frontend = readFileSync(new URL('../js/waitlist.js', import.meta.url), 'utf8');
function server(existing = [], failure) {
  let handler, calls = 0;
  const rows = new Map(existing.map(row => [row.email, { ...row }]));
  vm.runInNewContext(backend, {
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://test.supabase.co' : 'server-key' }, serve: fn => { handler = fn; } },
    Response, console: { error() {} },
    fetch: async (url, init) => {
      calls++;
      if (failure) return failure();
      const record = JSON.parse(init.body);
      await Promise.resolve();
      if (rows.has(record.email)) {
        if (init.headers.Prefer.includes('merge-duplicates')) {
          rows.set(record.email, { ...rows.get(record.email), ...record });
        } else return Response.json({ code: '23505', details: 'Private database details' }, { status: 409 });
      } else rows.set(record.email, record);
      return new Response(null, { status: 201 });
    },
  });
  return { rows, get calls() { return calls; }, submit: payload => handler(new Request('https://test.supabase.co/functions/v1/waitlist-signup', {
    method: 'POST', headers: { Origin: 'https://ajirresearch.com' }, body: JSON.stringify(payload),
  })) };
}
const original = { email: 'person@example.com', newsletter_opt_in: false, source: 'product-hero', status: 'pending', created_at: '2026-09-22' };

test('existing email returns a specific duplicate result and preserves the original record', async () => {
  const s = server([original]);
  const r = await s.submit({ email: 'person@example.com', newsletter: true, source: 'product-closing' });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { ok: false, error: 'already_registered' });
  assert.deepEqual(s.rows.get(original.email), original);
});
test('case and surrounding spaces do not bypass duplicate detection', async () => {
  const s = server([original]);
  assert.equal((await s.submit({ email: '  PERSON@Example.COM  ' })).status, 409);
  assert.equal(s.rows.size, 1);
});
test('simultaneous first-time requests create exactly one signup', async () => {
  const s = server();
  const responses = await Promise.all([s.submit({ email: original.email, newsletter: false }), s.submit({ email: original.email, newsletter: true })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(s.rows.size, 1);
  assert.equal(s.rows.get(original.email).newsletter_opt_in, false);
});
test('an unsubscribed record is not reactivated by another signup', async () => {
  const previous = { ...original, status: 'unsubscribed' };
  const s = server([previous]);
  assert.equal((await s.submit({ email: original.email, newsletter: true })).status, 409);
  assert.deepEqual(s.rows.get(original.email), previous);
});
test('new valid signup still succeeds', async () => {
  const s = server(); const r = await s.submit({ email: ' NEW@example.com ', newsletter: true, source: 'product-hero' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(s.rows.get('new@example.com').newsletter_opt_in, true);
});
test('invalid payloads and honeypots cannot write a record', async () => {
  const s = server();
  assert.equal((await s.submit(null)).status, 400);
  assert.equal((await s.submit([])).status, 400);
  assert.equal((await s.submit({ email: 'invalid' })).status, 422);
  assert.equal((await s.submit({ email: original.email, company: 'bot' })).status, 200);
  assert.equal(s.calls, 0);
});
test('other conflicts and database failures do not masquerade as duplicate emails', async () => {
  const s = server([], () => Response.json({ code: '23503' }, { status: 409 }));
  const r = await s.submit({ email: original.email });
  assert.equal(r.status, 502); assert.equal((await r.json()).error, 'store_failed');
});

function element(props = {}) {
  return { hidden: false, value: '', checked: false, textContent: '', dataset: {}, listeners: {}, attrs: {},
    focus() { this.focused = true; }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, fn) { this.listeners[k] = fn; }, ...props };
}
function screen(fetcher) {
  const email = element(), newsletter = element(), honeypot = element(), submit = element({ textContent: 'Request access' }), status = element();
  const duplicateHeading = element(), doneHeading = element();
  const formFields = { "[name='email']": email, "[name='newsletter']": newsletter, "[name='company']": honeypot,
    "[type='submit']": submit, '[data-waitlist-status]': status };
  const form = element({ querySelector: s => formFields[s] });
  const duplicate = element({ hidden: true, querySelector: () => duplicateHeading });
  const done = element({ hidden: true, querySelector: () => doneHeading });
  const duplicateEmail = element(), doneEmail = element(), doneNewsletter = element(), another = element();
  const fields = { '[data-waitlist-form]': form, '[data-waitlist-done]': done, '[data-waitlist-done-email]': doneEmail,
    '[data-waitlist-done-newsletter]': doneNewsletter, '[data-waitlist-duplicate]': duplicate,
    '[data-waitlist-duplicate-email]': duplicateEmail, '[data-waitlist-use-another]': another };
  vm.runInNewContext(frontend, { document: { querySelector: s => fields[s], addEventListener: (_, fn) => fn() },
    window: { location: { search: '' } }, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: fetcher });
  return { email, newsletter, submit, status, form, duplicate, done, duplicateEmail, doneEmail, doneNewsletter, duplicateHeading, another,
    submitForm: () => form.listeners.submit({ preventDefault() {} }) };
}
test('duplicate response displays the existing-signup screen and moves keyboard focus', async () => {
  const ui = screen(async () => Response.json({ ok: false, error: 'already_registered' }, { status: 409 }));
  ui.email.value = ' PERSON@EXAMPLE.COM '; ui.newsletter.checked = true;
  await ui.submitForm();
  assert.equal(ui.form.hidden, true); assert.equal(ui.duplicate.hidden, false); assert.equal(ui.done.hidden, true);
  assert.equal(ui.duplicateEmail.textContent, original.email); assert.equal(ui.duplicateHeading.focused, true);
  assert.equal(ui.doneNewsletter.textContent, '');
  ui.another.listeners.click();
  assert.equal(ui.duplicate.hidden, true); assert.equal(ui.form.hidden, false);
  assert.equal(ui.email.value, ''); assert.equal(ui.newsletter.checked, false); assert.equal(ui.email.focused, true);
});
test('first-time submission still displays the normal confirmation', async () => {
  const ui = screen(async () => Response.json({ ok: true }));
  ui.email.value = 'new@example.com'; await ui.submitForm();
  assert.equal(ui.done.hidden, false); assert.equal(ui.duplicate.hidden, true);
  assert.equal(ui.doneEmail.textContent, 'new@example.com');
});
test('double-clicks send only one request while submission is in flight', async () => {
  let release, requests = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const ui = screen(async () => { requests++; await pending; return Response.json({ ok: true }); });
  ui.email.value = 'new@example.com';
  const first = ui.submitForm(); await ui.submitForm();
  assert.equal(requests, 1); assert.equal(ui.submit.disabled, true);
  release(); await first; assert.equal(ui.submit.disabled, false);
});
