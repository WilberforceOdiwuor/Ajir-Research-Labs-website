import { createHandler } from './worker.mjs';

Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  brevoKey: Deno.env.get('BREVO_API_KEY') || Deno.env.get('BREVO_APU_KEY') || '',
  secretNames: Object.keys(Deno.env.toObject()).filter(name => /brevo|ajir/i.test(name)),
}));
