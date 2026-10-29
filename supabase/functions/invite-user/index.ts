// Supabase Edge Function: invite-user
// Lets an owner (or anyone with users.manage) add a team member to their company.
//
// POST { email, fullName, role, language?, allBoats?, boatIds?: string[] }
// The person receives an invitation email and sets their own password.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const ROLES = ['owner', 'manager', 'payroll_officer', 'accountant', 'readonly'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not authenticated' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const siteUrl = Deno.env.get('SITE_URL') ?? '';

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: ctx, error: ctxError } = await userClient.rpc('my_context');
  if (ctxError || !ctx) return json({ error: 'Not authenticated' }, 401);
  const permissions: string[] = ctx.permissions ?? [];
  if (!permissions.includes('users.manage')) return json({ error: 'permission_denied: users.manage' }, 403);

  let body: { email?: string; fullName?: string; role?: string; language?: string; allBoats?: boolean; boatIds?: string[] };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  const role = body.role ?? 'readonly';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);
  if (role === 'owner' && ctx.profile.role !== 'owner') return json({ error: 'Only an owner can invite another owner' }, 403);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const companyId: string = ctx.profile.company_id;

  // Boats must belong to the caller's company
  const boatIds = Array.isArray(body.boatIds) ? body.boatIds : [];
  if (boatIds.length) {
    const { data: boats, error } = await admin.from('boats').select('id').eq('company_id', companyId).in('id', boatIds);
    if (error) return json({ error: error.message }, 400);
    if ((boats ?? []).length !== boatIds.length) return json({ error: 'One or more boats were not found' }, 400);
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl ? `${siteUrl}/reset-password` : undefined,
    data: { full_name: body.fullName ?? '' },
  });
  if (inviteError || !invited.user) {
    return json({ error: inviteError?.message ?? 'Could not invite user' }, 400);
  }
  const userId = invited.user.id;

  const { data: existing } = await admin.from('profiles').select('id, company_id').eq('id', userId).maybeSingle();
  if (existing && existing.company_id !== companyId) {
    return json({ error: 'This email already belongs to another company' }, 409);
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    company_id: companyId,
    full_name: body.fullName ?? '',
    email,
    role,
    language: body.language === 'dv' ? 'dv' : body.language === 'en' ? 'en' : null,
    all_boats: !!body.allBoats || role === 'owner',
    active: true,
  });
  if (profileError) return json({ error: profileError.message }, 400);

  if (boatIds.length) {
    await admin.from('user_boats').delete().eq('user_id', userId);
    const { error } = await admin.from('user_boats').insert(boatIds.map((b) => ({ user_id: userId, boat_id: b, company_id: companyId })));
    if (error) return json({ error: error.message }, 400);
  }

  return json({ userId, invited: true });
});
