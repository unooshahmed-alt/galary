// Supabase Edge Function: payroll
// Runs the wage engine on the trusted backend and stores the result.
//
// POST { action: "preview" | "calculate", payrollId: string }
//   preview   → returns the calculation without saving (needs payroll.prepare)
//   calculate → validates, then saves via apply_payroll_calculation (service role)
//
// Permission and boat access are checked by the database function
// payroll_inputs(), which runs with the caller's own JWT.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { calculatePayroll, type PayrollInputs } from '../_shared/wageEngine.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not authenticated' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not authenticated' }, 401);

  let body: { action?: string; payrollId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const action = body.action ?? 'calculate';
  if (!body.payrollId || !['preview', 'calculate'].includes(action)) {
    return json({ error: 'payrollId and a valid action are required' }, 400);
  }

  // 1. Gather inputs with the caller's identity (permission + tenant + boat checks)
  const { data: packet, error: inputsError } = await userClient.rpc('payroll_inputs', { p_payroll: body.payrollId });
  if (inputsError) return json({ error: inputsError.message }, inputsError.code === '42501' ? 403 : 400);

  const inputs = packet.inputs as PayrollInputs;
  const result = calculatePayroll(inputs);

  if (action === 'preview') return json({ result, inputs, hash: packet.hash });
  if (result.errors.length) return json({ error: 'Calculation has errors', result }, 422);
  if (!['draft', 'calculated'].includes(packet.status)) {
    return json({ error: `Payroll is ${packet.status}; it can no longer be recalculated` }, 409);
  }

  // 2. Persist with the service role (function is not callable by end users)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: applyError } = await admin.rpc('apply_payroll_calculation', {
    p_payroll: body.payrollId,
    p_hash: packet.hash,
    p_result: result,
    p_user: userData.user.id,
  });
  if (applyError) return json({ error: applyError.message, result }, 409);

  return json({ result, saved: true });
});
