export function mapEntryToSupabaseRow(entry) {
  return {
    id: entry.id,
    vault_id: entry.vaultId,
    project_id: entry.projectId || null,
    name: entry.name,
    type: entry.type || 'Other',
    environment: entry.environment || 'Production',
    url: entry.url || '',
    username: entry.username || '',
    password_cipher: entry.passwordCipher,
    secret_notes_cipher: entry.secretNotesCipher || null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    status: entry.status || 'Active',
    updated_at: entry.updatedAt || new Date().toISOString(),
    deleted_at: entry.deletedAt || null
  };
}

export function mapProjectToSupabaseRow(project) {
  return {
    id: project.id,
    vault_id: project.vaultId,
    name: project.name,
    description: project.description || '',
    status: project.status || 'Active',
    logo_url: project.logoUrl || null,
    updated_at: project.updatedAt || new Date().toISOString(),
    deleted_at: project.deletedAt || null
  };
}
