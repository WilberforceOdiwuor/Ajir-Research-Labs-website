import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256, escapeHtml, emailContent, failureDisposition } from '../supabase/functions/waitlist-brevo/worker.mjs';

const token = 'test-worker-token';
const config = { worker_token_hash: await sha256(token), active: true, setup_complete: true,
  waitlist_list_id: 11, newsletter_list_id: 12, sender_name: 'Ajir Research Labs', sender_email: 'contact@ajirresearch.com' };
const env = { supabaseUrl: 'https://test.supabase.co', serviceKey: 'service-test', brevoKey: 'brevo-test' };
const request = (action, secret = token, path = '') => new Request(`https://test.supabase.co/functions/v1/waitlist-brevo${path}`, {
  method: 'POST', headers: secret ? { 'X-Worker-Token': secret } : {}, body: JSON.stringify({ action }) });
const signup = { id: 'signup-id', email: 'person@example.com', status: 'pending', source: 'product-hero',
  newsletter_opt_in: false, created_at: '2026-09-23T10:00:00Z' };

function harness(job, overrides = {}) {
  const calls = []; let claimed = false;
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname; const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, path, body, headers: init.headers, method: init.method });
    let data;
    if (path.endsWith('/waitlist_brevo_config')) data = config;
    else if (path.endsWith('/waitlist_brevo_claim')) { data = claimed ? [] : [job]; claimed = true; }
    else if (path.endsWith('/waitlist_brevo_signup')) data = overrides.signup ?? signup;
    else if (path.endsWith('/waitlist_brevo_mark_send')) data = overrides.firstSend ?? new Date().toISOString();
    else if (path.endsWith('/waitlist_brevo_finish') || path.endsWith('/waitlist_brevo_event')) data = null;
    else if (path.startsWith('/v3/contacts/') && init.method === 'GET') data = overrides.contact ?? { id: 42, emailBlacklisted: false };
    else if (path.startsWith('/v3/contacts/') && init.method === 'PUT') data = {};
    else if (path === '/v3/smtp/email') {
      if (overrides.emailError) return new Response(JSON.stringify(overrides.emailError), { status: overrides.emailStatus ?? 400 });
      data = { messageId: '<test-message>' };
    } else throw new Error(`unexpected_request:${path}`);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return { calls, handler: createHandler(env, fetcher) };
}
const job = (kind, extra = {}) => ({ id: 'job-id', lease_id: 'lease-id', kind, signup_id: signup.id,
  payload: {}, attempts: 1, first_send_at: null, ...extra });

test('unauthenticated calls cannot reach the database or Brevo', async () => {
  const h = harness(job('welcome'));
  assert.equal((await h.handler(request('setup', null))).status, 401);
  assert.equal(h.calls.length, 0);
});
test('wrong worker token cannot perform actions', async () => {
  const h = harness(job('welcome'));
  assert.equal((await h.handler(request('setup', 'wrong'))).status, 401);
  assert.equal(h.calls.length, 1);
});
test('webhooks require their own valid credential', async () => {
  const h = harness(job('welcome'));
  assert.equal((await h.handler(request('process', token, '/events/marketing'))).status, 401);
  assert.equal(h.calls.length, 0);
});
test('newsletter opt-out removes only the newsletter list without resetting blocklists', async () => {
  const h = harness(job('sync'));
  assert.equal((await h.handler(request('process'))).status, 200);
  const update = h.calls.find(c => c.method === 'PUT').body;
  assert.deepEqual(update.listIds, [11]); assert.deepEqual(update.unlinkListIds, [12]);
  assert.equal(update.attributes.AJIR_NEWSLETTER, false);
  assert.ok(!('emailBlacklisted' in update));
});
test('previous Brevo unsubscribe is retained when the form is resubmitted', async () => {
  const h = harness(job('sync'), { contact: { id: 42, emailBlacklisted: true }, signup: { ...signup, newsletter_opt_in: true } });
  await h.handler(request('process'));
  const update = h.calls.find(c => c.method === 'PUT').body;
  assert.deepEqual(update.listIds, []); assert.deepEqual(update.unlinkListIds, [11, 12]);
  assert.equal(update.attributes.AJIR_STATUS, 'unsubscribed');
  assert.ok(h.calls.some(c => c.path.endsWith('/waitlist_brevo_event')));
});
test('confirmation respects the selected newsletter preference', async () => {
  const h = harness(job('welcome'));
  await h.handler(request('process'));
  const mail = h.calls.find(c => c.path === '/v3/smtp/email').body;
  assert.equal(mail.to[0].email, signup.email);
  assert.match(mail.textContent, /not subscribed to our newsletter/);
  assert.equal(mail.headers.idempotencyKey, 'job-id');
  assert.equal(mail.replyTo.email, 'contact@ajirresearch.com');
});
test('unsubscribed signups do not receive confirmations', async () => {
  const h = harness(job('welcome'), { signup: { ...signup, status: 'unsubscribed' } });
  await h.handler(request('process'));
  assert.ok(!h.calls.some(c => c.path === '/v3/smtp/email'));
});
test('ambiguous old email attempts are held for review, avoiding duplicate sends', async () => {
  const h = harness(job('welcome'), { firstSend: new Date(Date.now() - 16 * 60000).toISOString() });
  await h.handler(request('process'));
  assert.ok(!h.calls.some(c => c.path === '/v3/smtp/email'));
  const finish = h.calls.find(c => c.path.endsWith('/waitlist_brevo_finish')).body;
  assert.equal(finish.p_state, 'failed'); assert.match(finish.p_error, /email_delivery_uncertain/);
});
test('temporary provider failures remain queued', async () => {
  const h = harness(job('welcome'), { emailError: { code: 'temporary_error' }, emailStatus: 503 });
  await h.handler(request('process'));
  assert.equal(h.calls.find(c => c.path.endsWith('/waitlist_brevo_finish')).body.p_state, 'pending');
});
test('confirmed duplicate responses finish the job without another send', () => {
  assert.equal(failureDisposition({ code: 'duplicate_parameter' }, job('welcome')).state, 'done');
});
test('free-plan quota defers mail instead of discarding it', () => {
  const d = failureDisposition({ system: 'brevo', code: 'not_enough_credits' }, job('alert'));
  assert.equal(d.state, 'pending'); assert.equal(d.delay, 86400); assert.equal(d.resetSend, true);
});
test('email data is escaped and digest contains source and failure counts', () => {
  assert.equal(escapeHtml('<script>&'), '&lt;script&gt;&amp;');
  const c = emailContent(job('digest', { payload: { recipient: 'owner@example.com', day: '2026-09-22', new_signups: 2,
    newsletter_opt_ins: 1, total_signups: 4, waiting: 4, pending_jobs: 0, failed_jobs: 1, sources: { 'product-hero': 2 } } }));
  assert.match(c.text, /product-hero: 2/); assert.match(c.text, /Jobs needing attention: 1/);
});
