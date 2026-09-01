import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing Supabase environment variables')
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const tables = [
  'profiles','profile_private','memberships','member_grade_history','member_status_history',
  'member_number_history','member_roles','audit_logs','private_profile_access_logs',
  'meetings','meeting_managers','meeting_applications','point_transactions',
]
const counts = {}
for (const table of tables) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true })
  counts[table] = error ? { error: error.code } : count
}
let page = 1, authUsers = []
while (true) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  authUsers.push(...data.users)
  if (data.users.length < 1000) break
  page++
}
const authSummary = {
  must_change_password: authUsers.filter((u) => u.user_metadata?.must_change_password === true).length,
  migration_email_pending: authUsers.filter((u) => u.user_metadata?.migration_email_pending === true).length,
  legacy_migrated: authUsers.filter((u) => u.user_metadata?.legacy_migrated === true).length,
  placeholder_emails: authUsers.filter((u) => u.email?.endsWith('@legacy.iuna.invalid')).length,
}
console.log(JSON.stringify({ supabase_host: new URL(url).host, counts, auth_user_count: authUsers.length, auth_summary: authSummary }, null, 2))
