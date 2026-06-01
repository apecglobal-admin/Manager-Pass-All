import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS'
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return json({ ok: true }, 200);
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Supabase function is not configured' }, 500);
  }

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) {
    return json({ error: 'Missing admin session token' }, 401);
  }

  let body: { email?: string } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const targetEmail = String(body.email || '').trim().toLowerCase();
  if (!targetEmail) {
    return json({ error: 'Email is required' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: callerData, error: callerError } = await userClient.auth.getUser(accessToken);
  if (callerError || !callerData.user?.email) {
    return json({ error: 'Invalid admin session token' }, 401);
  }

  const { data: caller, error: callerLookupError } = await adminClient
    .from('app_users')
    .select('id, role, status, username')
    .eq('username', callerData.user.email.toLowerCase())
    .maybeSingle();
  if (callerLookupError) {
    return json({ error: callerLookupError.message }, 500);
  }
  if (caller?.role !== 'Admin' || caller?.status !== 'Active') {
    return json({ error: 'Admin only' }, 403);
  }

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return json({ error: error.message }, 500);

    const authUser = (data.users || []).find(user => String(user.email || '').trim().toLowerCase() === targetEmail);
    if (authUser) {
      const deleted = await adminClient.auth.admin.deleteUser(authUser.id);
      if (deleted.error) return json({ error: deleted.error.message }, 500);
      return json({ ok: true, authDeleted: true });
    }
    if ((data.users || []).length < 100) {
      return json({ ok: true, authDeleted: false });
    }
  }

  return json({ error: 'Supabase auth user lookup exceeded 100 pages' }, 500);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8'
    }
  });
}
