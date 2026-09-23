// Secrets stay in the Edge Function environment and Supabase Vault.
// Native fetch avoids adding a package dependency to this small worker.
const BREVO = 'https://api.brevo.com/v3';
const ATTRIBUTES = { AJIR_SIGNUP_ID: 'text', AJIR_SIGNED_UP_AT: 'text', AJIR_SOURCE: 'text', AJIR_STATUS: 'text', AJIR_NEWSLETTER: 'boolean' };
const TERMINAL = new Set(['unsubscribed', 'bounced']);
const encoder = new TextEncoder();
const hex = buffer => Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function webhookToken(key) {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, encoder.encode('ajir-waitlist-brevo-events-v1')));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function emailContent(job, signup) {
  const p = job.payload;
  if (job.kind === 'welcome') return {
    to: signup.email, subject: 'You’re on the AskNoema waitlist',
    text: `Thanks for requesting pre-release access to AskNoema.\n\nYour request is saved. We’ll email you when access is available.\n\n${signup.newsletter_opt_in ? 'You also opted in to the Ajir Research newsletter.' : 'You’ll receive access updates only; you are not subscribed to our newsletter.'}\n\nTo leave the waitlist or change your newsletter preference, reply to this email and tell us which updates you want to stop.\n\nAjir Research Labs\nhttps://ajirresearch.com`,
  };
  if (job.kind === 'alert') return {
    to: p.recipient, subject: 'New AskNoema pre-release signup',
    text: `New pre-release request\n\nEmail: ${signup.email}\nSigned up: ${signup.created_at}\nSource: ${signup.source}\nNewsletter: ${signup.newsletter_opt_in ? 'Opted in' : 'Access updates only'}\nStatus: ${signup.status}\n\nView subscribers: https://app.brevo.com/contact/list-listing\n\nAjir Research Labs`,
  };
  if (job.kind === 'digest') return {
    to: p.recipient, subject: `AskNoema signup summary — ${p.day}`,
    text: `Signup summary for ${p.day} (Africa/Nairobi)\n\nNew signups: ${p.new_signups}\nNewsletter opt-ins among those signups: ${p.newsletter_opt_ins}\nTotal signup records: ${p.total_signups}\nWaiting for access: ${p.waiting}\n\nSignup sources:\n${Object.entries(p.sources ?? {}).map(([source, count]) => `${source}: ${count}`).join('\n') || 'No new signups'}\n\nIntegration jobs awaiting processing: ${p.pending_jobs}\nJobs needing attention: ${p.failed_jobs}\n\nView subscribers: https://app.brevo.com/contact/list-listing\n\nAjir Research Labs`,
  };
  if (job.kind === 'test') return {
    to: p.recipient, subject: 'AskNoema signup notifications — setup test',
    text: 'This is a setup test from Ajir Research Labs.\n\nThis address is configured to receive new AskNoema signup alerts and a daily summary at 8:00 AM East Africa Time.\n\nNo subscriber was added by this test.\n\nReplies go to contact@ajirresearch.com.',
  };
  throw new Error('unknown_email_kind');
}
class ApiError extends Error {
  constructor(system, status, code, ambiguous = false) {
    super(`${system}:${status}:${code}`);
    this.system = system; this.status = status; this.code = code; this.ambiguous = ambiguous;
  }
}
export function failureDisposition(error, job) {
  if (error.code === 'duplicate_parameter' && job.kind !== 'sync') return { state: 'done', result: { duplicate_prevented: true } };
  // A crash or uncertain transport response must not resend after Brevo's 15-minute deduplication window.
  if (error.message === 'email_delivery_uncertain') return { state: 'failed', error: 'email_delivery_uncertain: check Brevo email logs before retrying' };
  if (error.system === 'brevo' && ['not_enough_credits', 'Insufficient credits'].includes(error.code)) {
    return { state: 'pending', delay: 86400, resetSend: !job.first_send_at };
  }
  if (error.system === 'brevo' && [400, 401, 403, 404, 422].includes(error.status)) return { state: 'failed' };
  return job.attempts >= 8 ? { state: 'failed' } : {
    state: 'pending', delay: Math.min(30 * 2 ** (job.attempts - 1), 300),
    resetSend: error.system === 'brevo' && error.status === 429 && !job.first_send_at,
  };
}
export function createHandler(env, fetcher = fetch) {
  const { supabaseUrl, serviceKey, brevoKey } = env;
  async function request(system, url, method, body, headers) {
    let response;
    try {
      response = await fetcher(url, { method, headers: { 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
    } catch {
      throw new ApiError(system, 0, 'network_or_timeout', true);
    }
    let data = {};
    try { const raw = await response.text(); data = raw ? JSON.parse(raw) : {}; }
    catch { throw new ApiError(system, response.status, 'invalid_response', response.ok); }
    if (!response.ok) {
      const error = new ApiError(system, response.status, data.code ?? 'request_failed', response.status >= 500);
      error.path = new URL(url).pathname;
      throw error;
    }
    return data;
  }
  const rpc = (name, body = {}) => request('supabase', `${supabaseUrl}/rest/v1/rpc/waitlist_brevo_${name}`, 'POST', body,
    { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });
  const brevo = (path, method = 'GET', body) => {
    if (!brevoKey) throw new ApiError('brevo', 503, 'missing_BREVO_API_KEY');
    return request('brevo', `${BREVO}${path}`, method, body, { 'api-key': brevoKey });
  };
  async function collection(path, field) {
    const all = [];
    for (let offset = 0; offset < 10000; offset += 50) {
      let data;
      try { data = await brevo(`${path}${path.includes('?') ? '&' : '?'}limit=50&offset=${offset}`); }
      catch (error) { if (error.code === 'document_not_found') return all; throw error; }
      const rows = data[field] ?? []; all.push(...rows);
      if (rows.length < 50) return all;
    }
    throw new Error('too_many_brevo_items');
  }
  async function inspect() {
    if (!brevoKey) return { key_configured: false, candidate_secret_names: env.secretNames ?? [] };
    const account = await brevo('/account');
    const { senders = [] } = await brevo('/senders');
    return { key_configured: true, relay_enabled: account.relay?.enabled === true,
      plans: account.plan?.map(({ type, credits, creditsType }) => ({ type, credits, creditsType })),
      senders: senders.map(({ id, name, email, active }) => ({ id, name, email, active })) };
  }
  async function setup(config) {
    const account = await brevo('/account');
    const folders = await collection('/contacts/folders', 'folders');
    let folder = folders.find(f => f.name === 'Ajir Research Labs');
    if (!folder) folder = await brevo('/contacts/folders', 'POST', { name: 'Ajir Research Labs' });
    const lists = await collection('/contacts/lists', 'lists');
    const ids = {};
    for (const [key, name] of [['waitlist_list_id', 'AskNoema Waitlist'], ['newsletter_list_id', 'Ajir Newsletter']]) {
      const list = lists.find(l => l.name === name && l.folderId === folder.id) ??
        await brevo('/contacts/lists', 'POST', { name, folderId: folder.id });
      ids[key] = list.id;
    }
    const { attributes = [] } = await brevo('/contacts/attributes');
    for (const [name, type] of Object.entries(ATTRIBUTES)) {
      const existing = attributes.find(a => a.name === name);
      if (existing && existing.type !== type) throw new Error(`attribute_type_mismatch:${name}`);
      if (!existing) await brevo(`/contacts/attributes/normal/${name}`, 'POST', { type });
    }
    let { senders = [] } = await brevo('/senders');
    let sender = senders.find(s => s.email.toLowerCase() === config.sender_email);
    if (!sender) {
      await brevo('/senders', 'POST', { name: config.sender_name, email: config.sender_email });
      ({ senders = [] } = await brevo('/senders'));
      sender = senders.find(s => s.email.toLowerCase() === config.sender_email);
    }
    const token = await webhookToken(brevoKey);
    const { webhooks = [] } = await brevo('/webhooks').catch(error => {
      if (error.code === 'document_not_found') return { webhooks: [] };
      throw error;
    });
    for (const type of ['transactional', 'marketing']) {
      const url = `${supabaseUrl}/functions/v1/waitlist-brevo/events/${type}`;
      const payload = { url, type, description: `Ajir waitlist ${type} delivery and consent`,
        events: ['delivered', 'hardBounce', 'spam', 'unsubscribed'],
        headers: [{ key: 'X-Brevo-Webhook-Token', value: token }] };
      const existing = webhooks.find(w => w.url === url && w.type === type);
      if (existing) await brevo(`/webhooks/${existing.id}`, 'PUT', payload);
      else await brevo('/webhooks', 'POST', payload);
    }
    await rpc('save_config', { p_patch: { ...ids, sender_id: sender?.id, setup_complete: true } });
    return { ...ids, sender_active: sender?.active === true, relay_enabled: account.relay?.enabled === true };
  }
  async function contact(email) {
    try { return await brevo(`/contacts/${encodeURIComponent(email)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function sync(signup, config) {
    let current = await contact(signup.email);
    // Never clear a Brevo blocklist flag, including when a signup is submitted again.
    if (current?.emailBlacklisted && !TERMINAL.has(signup.status)) {
      await rpc('event', { p_email: signup.email, p_event: 'unsubscribed' });
      signup = { ...signup, status: 'unsubscribed', newsletter_opt_in: false };
    }
    const active = !TERMINAL.has(signup.status) && !current?.emailBlacklisted;
    const listIds = [], unlinkListIds = [];
    (active ? listIds : unlinkListIds).push(config.waitlist_list_id);
    (active && signup.newsletter_opt_in ? listIds : unlinkListIds).push(config.newsletter_list_id);
    const attributes = { AJIR_SIGNUP_ID: signup.id, AJIR_SIGNED_UP_AT: signup.created_at,
      AJIR_SOURCE: signup.source, AJIR_STATUS: signup.status, AJIR_NEWSLETTER: active && signup.newsletter_opt_in };
    if (!current) {
      await brevo('/contacts', 'POST', { email: signup.email, attributes, listIds, updateEnabled: true });
      current = await contact(signup.email);
    }
    await brevo(`/contacts/${encodeURIComponent(signup.email)}`, 'PUT', { attributes, listIds, unlinkListIds });
    return { contact_id: current?.id, synced: true };
  }
  async function send(job, signup, config) {
    if (job.kind === 'welcome') {
      if (TERMINAL.has(signup.status)) return { skipped: 'unsubscribed_or_bounced' };
      const c = await contact(signup.email);
      if (c?.emailBlacklisted || c?.smtpBlacklistSender?.length) return { skipped: 'brevo_suppressed' };
    }
    const content = emailContent(job, signup);
    const first = await rpc('mark_send', { p_id: job.id, p_lease: job.lease_id });
    if (!first || Date.now() - new Date(first).getTime() > 14 * 60 * 1000) throw new Error('email_delivery_uncertain');
    return await brevo('/smtp/email', 'POST', {
      sender: { name: config.sender_name, email: config.sender_email },
      replyTo: { name: config.sender_name, email: config.sender_email },
      to: [{ email: content.to, contactPixelTrackingConsent: false }],
      subject: content.subject, textContent: content.text,
      htmlContent: `<html><body><div style="font:16px/1.6 Arial,sans-serif;max-width:600px;margin:auto;white-space:pre-wrap">${escapeHtml(content.text)}</div></body></html>`,
      headers: { idempotencyKey: job.id }, tags: [`ajir-${job.kind}`],
    });
  }
  async function process(config) {
    if (!config.active) return { paused: true };
    if (!config.setup_complete) throw new Error('setup_incomplete');
    const until = Date.now() + 40000;
    let processed = 0, failed = 0;
    while (Date.now() < until && processed + failed < 12) {
      const [job] = await rpc('claim', { p_limit: 1 });
      if (!job) break;
      try {
        const signup = job.signup_id ? await rpc('signup', { p_id: job.signup_id }) : null;
        const result = job.signup_id && !signup ? { skipped: 'signup_deleted' } :
          job.kind === 'sync' ? await sync(signup, config) : await send(job, signup, config);
        await rpc('finish', { p_id: job.id, p_lease: job.lease_id, p_state: 'done', p_result: result });
        processed++;
      } catch (error) {
        const d = failureDisposition(error, job);
        await rpc('finish', { p_id: job.id, p_lease: job.lease_id, p_state: d.state,
          p_result: d.result ?? null, p_error: d.error ?? error.message,
          p_delay: d.delay ?? 60, p_reset_send: d.resetSend ?? false });
        failed++;
        if (error.status === 401 || error.status === 403 || error.code === 'missing_BREVO_API_KEY') break;
      }
    }
    return { processed, failed };
  }
  async function events(payload, config, type) {
    const rows = Array.isArray(payload) ? payload : [payload];
    if (rows.length > 100) throw new Error('too_many_events');
    for (const event of rows) {
      if (typeof event.email !== 'string' || typeof event.event !== 'string') continue;
      if (!['delivered', 'hard_bounce', 'hardBounce', 'spam', 'unsubscribed'].includes(event.event)) continue;
      let scope = 'all';
      if (type === 'marketing' && event.event === 'unsubscribed' && Array.isArray(event.list_id) && event.list_id.length) {
        const lists = event.list_id.map(Number);
        const waitlist = lists.includes(config.waitlist_list_id), newsletter = lists.includes(config.newsletter_list_id);
        if (!waitlist && !newsletter) continue;
        scope = waitlist && newsletter ? 'all' : waitlist ? 'waitlist' : 'newsletter';
      }
      await rpc('event', { p_email: event.email.toLowerCase(), p_event: event.event,
        p_message_id: event['message-id'] ?? null, p_scope: scope });
    }
    return { ok: true };
  }
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return async function handler(req) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const path = new URL(req.url).pathname;
    const isEvent = /\/events\/(transactional|marketing)$/.test(path);
    const token = req.headers.get(isEvent ? 'X-Brevo-Webhook-Token' : 'X-Worker-Token');
    if (!token) return json({ error: 'unauthorized' }, 401);
    try {
      if (isEvent && (!brevoKey || !same(token, await webhookToken(brevoKey)))) return json({ error: 'unauthorized' }, 401);
      const config = await rpc('config');
      if (!isEvent && !same(await sha256(token), config.worker_token_hash)) return json({ error: 'unauthorized' }, 401);
      const raw = await req.text();
      if (raw.length > 100000) return json({ error: 'payload_too_large' }, 413);
      let payload;
      try { payload = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
      if (isEvent) return json(await events(payload, config, path.split('/').at(-1)));
      switch (payload.action) {
        case 'inspect': return json(await inspect());
        case 'setup': return json(await setup(config));
        case 'process': return json(await process(config));
        case 'digest': await rpc('enqueue_digest'); return json(await process(config));
        case 'status': {
          const lists = [];
          for (const id of [config.waitlist_list_id, config.newsletter_list_id].filter(Boolean)) {
            const list = await brevo(`/contacts/lists/${id}`);
            lists.push({ id: list.id, name: list.name, totalSubscribers: list.totalSubscribers });
          }
          return json({ ...(await rpc('status')), lists });
        }
        case 'delivery-check': {
          const d = await brevo('/smtp/statistics/events?limit=30&days=1');
          return json({ events: (d.events ?? []).filter(e => (config.alert_recipients ?? []).includes(e.email))
            .map(({ email, event, date, messageId, tag }) => ({ email, event, date, messageId, tag })) });
        }
        default: return json({ error: 'unknown_action' }, 400);
      }
    } catch (error) {
      // Never log request headers, email bodies, Brevo API responses, or credentials.
      console.error('waitlist-brevo:', error.message);
      return json({ error: error.message, operation: error.path?.replace(/%40[^/]+/g, ':redacted') }, 503);
    }
  };
}
