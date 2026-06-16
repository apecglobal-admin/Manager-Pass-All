import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { decryptText, encryptText } from './crypto.js';

const LEGACY_DEFAULT_SECRET = 'apecglobal-manager-local-development-secret';
const LEGACY_DEFAULT_ENCRYPTION_KEY = Buffer.from(LEGACY_DEFAULT_SECRET.padEnd(32, '0').slice(0, 32));
const LEGACY_DECRYPTION_KEYS = [LEGACY_DEFAULT_ENCRYPTION_KEY, LEGACY_DEFAULT_SECRET];
const SHARED_PASSWORD_SECRET = 'apecglobal-manager-shared-password-key';
const SHARED_PASSWORD_ENCRYPTION_KEY = Buffer.from(SHARED_PASSWORD_SECRET.padEnd(32, '0').slice(0, 32));

export function createSupabaseDataStore({
  supabase,
  supabaseUrl,
  supabaseKey,
  supabaseAnonKey,
  accessToken,
  encryptionKey,
  useAccessTokenAuthorization = true,
  createSupabaseClient = createClient
}) {
  const key = supabaseKey || supabaseAnonKey;
  const client = supabase || createSupabaseClient(supabaseUrl, key, {
    ...(accessToken && useAccessTokenAuthorization ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
    auth: { persistSession: false, autoRefreshToken: false }
  });
  let vaultPromise;

  async function getVault() {
    vaultPromise ||= resolveVault();
    return vaultPromise;
  }

  async function resolveVault() {
    let ownerId = '';
    if (accessToken) {
      const { data: userData, error: userError } = await client.auth.getUser(accessToken);
      if (userError) throw userError;
      ownerId = userData.user?.id || '';
    }

    const existingQuery = client
      .from('vaults')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1);
    const existing = ownerId ? await existingQuery.eq('owner_id', ownerId) : await existingQuery;
    if (existing.error) throw existing.error;
    if (existing.data?.[0]) return existing.data[0];
    ownerId ||= await resolveServerOwnerId();
    if (!ownerId) throw new Error('Supabase auth user not found for server-side data writes');

    const created = await client
      .from('vaults')
      .insert({ owner_id: ownerId, name: 'Personal', kdf_salt: randomBytes(16).toString('base64') })
      .select()
      .single();
    if (created.error) throw created.error;
    return created.data;
  }

  return {
    projects: {
      async list() {
        const vault = await getVault();
        const { data, error } = await client
          .from('projects')
          .select('*')
          .eq('vault_id', vault.id)
          .is('deleted_at', null)
          .order('name', { ascending: true });
        if (error) throw error;
        return data.map(mapProject);
      },
      async listByIds(ids = []) {
        const projectIds = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
        if (!projectIds.length) return [];
        const { data, error } = await client
          .from('projects')
          .select('*')
          .in('id', projectIds)
          .is('deleted_at', null)
          .order('name', { ascending: true });
        if (error) throw error;
        return data.map(mapProject);
      },
      async create(input) {
        const vault = await getVault();
        const { data, error } = await client
          .from('projects')
          .insert({
            vault_id: vault.id,
            name: input.name.trim(),
            description: input.description || '',
            status: input.status || 'Active',
            logo_url: input.logoUrl || null
          })
          .select()
          .single();
        if (error) throw error;
        return mapProject(data);
      },
      async update(id, input) {
        const vault = await getVault();
        const { data, error } = await client
          .from('projects')
          .update({
            name: input.name.trim(),
            description: input.description || '',
            status: input.status || 'Active',
            logo_url: input.logoUrl || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .eq('vault_id', vault.id)
          .select()
          .single();
        if (error) throw error;
        return mapProject(data);
      },
      async delete(id) {
        const vault = await getVault();
        const { error } = await client
          .from('projects')
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('vault_id', vault.id);
        if (error) throw error;
      }
    },
    entries: {
      async listByProject(projectId) {
        const { data, error } = await client
          .from('entries')
          .select('*')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('name', { ascending: true });
        if (error) throw error;
        return data.map(mapEntry);
      },
      async search(query) {
        const vault = await getVault();
        const like = `%${query}%`;
        const { data, error } = await client
          .from('entries')
          .select('*')
          .eq('vault_id', vault.id)
          .is('deleted_at', null)
          .or(`name.ilike.${like},url.ilike.${like},username.ilike.${like}`)
          .order('name', { ascending: true });
        if (error) throw error;
        return data.map(mapEntry);
      },
      async create(input) {
        const vault = await getVault();
        const { data, error } = await client
          .from('entries')
          .insert({
            vault_id: vault.id,
            project_id: input.projectId,
            name: input.name.trim(),
            type: input.type || 'Other',
            environment: input.environment || 'Production',
            url: input.url || '',
            username: input.username || '',
            password_cipher: encryptPasswordPayload(input.password || ''),
            secret_notes_cipher: encryptPayload(input.notes || '', encryptionKey),
            tags: input.tags || [],
            status: input.status || 'Active'
          })
          .select()
          .single();
        if (error) throw error;
        return mapEntry(data);
      },
      async update(id, input) {
        const patch = {
          project_id: input.projectId,
          name: input.name.trim(),
          type: input.type || 'Other',
          environment: input.environment || 'Production',
          url: input.url || '',
          username: input.username || '',
          secret_notes_cipher: encryptPayload(input.notes || '', encryptionKey),
          tags: input.tags || [],
          status: input.status || 'Active',
          updated_at: new Date().toISOString()
        };
        if (input.password !== undefined) {
          patch.password_cipher = encryptPasswordPayload(input.password || '');
        }
        const { data, error } = await client
          .from('entries')
          .update(patch)
          .eq('id', id)
          .is('deleted_at', null)
          .select()
          .single();
        if (error) throw error;
        if (!data) throw new Error('Entry not found');
        return mapEntry(data);
      },
      async delete(id) {
        const { error } = await client
          .from('entries')
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', id)
          .is('deleted_at', null);
        if (error) throw error;
      },
      async revealPassword(id) {
        const { data, error } = await client
          .from('entries')
          .select('password_cipher')
          .eq('id', id)
          .is('deleted_at', null)
          .single();
        if (error) throw error;
        if (!data) throw new Error('Entry not found');
        return decryptPasswordPayload(data.password_cipher, encryptionKey);
      }
    },
    activity: {
      async log(action, { projectId = null, entryId = null, details = '' } = {}) {
        const vault = await getVault();
        const { error } = await client.from('activity_logs').insert({
          vault_id: vault.id,
          action,
          entry_id: entryId || null,
          metadata: { projectId, details }
        });
        if (error) throw error;
      }
    }
  };

  async function resolveServerOwnerId() {
    if (!client.auth.admin?.listUsers) return '';
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;
    return data.users?.[0]?.id || '';
  }
}

function mapProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status || 'Active',
    logoUrl: row.logo_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntry(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type || 'Other',
    environment: row.environment || 'Production',
    url: row.url || '',
    username: row.username || '',
    passwordMasked: true,
    notes: decryptPayload(row.secret_notes_cipher, null) || '',
    status: row.status || 'Active',
    tags: row.tags || [],
    permissions: fullEntryPermissions(),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fullEntryPermissions() {
  return {
    canViewEntry: true,
    canViewUrl: true,
    canViewUsername: true,
    canRevealPassword: true,
    canViewNotes: true,
    canCreate: true,
    canEdit: true,
    canDelete: true
  };
}

function encryptPayload(value, encryptionKey) {
  return JSON.parse(encryptText(value, encryptionKey));
}

function encryptPasswordPayload(value) {
  return JSON.parse(encryptText(value || '', SHARED_PASSWORD_ENCRYPTION_KEY));
}

function decryptPayload(value, encryptionKey) {
  if (!value || !encryptionKey) return '';
  return decryptPayloadWithKeys(value, [encryptionKey, ...LEGACY_DECRYPTION_KEYS]);
}

function decryptPasswordPayload(value, encryptionKey) {
  if (!value) return '';
  return decryptPayloadWithKeys(value, [
    SHARED_PASSWORD_ENCRYPTION_KEY,
    encryptionKey,
    ...LEGACY_DECRYPTION_KEYS
  ].filter(Boolean));
}

function decryptPayloadWithKeys(value, keys) {
  const serialized = JSON.stringify(value);
  let firstDecryptError = null;
  const triedKeys = [];
  for (const key of keys) {
    if (triedKeys.some(triedKey => keysEqual(triedKey, key))) continue;
    triedKeys.push(key);
    try {
      return decryptText(serialized, key);
    } catch (error) {
      if (!isDecryptAuthError(error)) throw error;
      firstDecryptError ||= error;
    }
  }
  if (firstDecryptError) throw firstDecryptError;
  return '';
}

function isDecryptAuthError(error) {
  return /Unsupported state or unable to authenticate data/i.test(error?.message || '');
}

function keysEqual(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}
