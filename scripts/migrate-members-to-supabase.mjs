import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const execute = process.argv.includes('--execute')
const expectedHostArg = process.argv.find(x => x.startsWith('--confirm-host='))?.split('=')[1]
const expectedUsersArg = Number(process.argv.find(x => x.startsWith('--confirm-auth-users='))?.split('=')[1])
const payloadPath = process.env.MIGRATION_PAYLOAD_PATH || '.migration-work/migration_payload.json'
const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'))
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing Supabase environment variables')
const host = new URL(url).host
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const emails = payload.eligible.map(x => String(x.auth?.email || '').trim().toLowerCase()).filter(Boolean)
const duplicateEmails = [...new Set(emails.filter((email, index) => emails.indexOf(email) !== index))]
const memberNos = payload.eligible.map(x => String(x.profile.member_no))
const duplicateMemberNos = [...new Set(memberNos.filter((value, index) => memberNos.indexOf(value) !== index))]
const invalidBirthDates = payload.eligible.filter(x => !/^\d{4}-\d{2}-\d{2}$/.test(String(x.private.birth_date)))
if (duplicateEmails.length || duplicateMemberNos.length || invalidBirthDates.length) {
  throw new Error(JSON.stringify({ duplicateEmails, duplicateMemberNos, invalidBirthDates: invalidBirthDates.map(x => x.migration_key) }))
}

let page = 1, existingUsers = []
while (true) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  existingUsers.push(...data.users)
  if (data.users.length < 1000) break
  page++
}

const summary = {
  host,
  execute,
  existing_auth_users: existingUsers.length,
  migration_users: payload.eligible.length,
  users_with_email: emails.length,
  users_requiring_email: payload.eligible.length - emails.length,
  roles: payload.roles.length,
}
console.log(JSON.stringify({ phase: 'preflight', ...summary }, null, 2))
if (!execute) process.exit(0)
if (expectedHostArg !== host) throw new Error(`Host confirmation mismatch: ${expectedHostArg} !== ${host}`)
if (expectedUsersArg !== existingUsers.length) throw new Error(`Auth user count changed: expected ${expectedUsersArg}, found ${existingUsers.length}`)

const tableSpecs = [
  ['point_transactions','id'],['meeting_applications','id'],['meeting_managers','id'],['meetings','id'],
  ['private_profile_access_logs','id'],['audit_logs','id'],['member_roles','id'],
  ['member_number_history','id'],['member_grade_history','id'],['member_status_history','id'],
  ['memberships','user_id'],['profile_private','user_id'],['profiles','id'],
]
const backup = { created_at: new Date().toISOString(), host, auth_users: existingUsers.map(u => ({ id:u.id,email:u.email,created_at:u.created_at,user_metadata:u.user_metadata })), tables:{} }
for (const [table] of tableSpecs) {
  const { data, error } = await db.from(table).select('*')
  if (error) throw new Error(`Backup ${table}: ${error.message}`)
  backup.tables[table] = data
}
await fs.mkdir('outputs/member-migration-2026-09-01/private-backup', { recursive: true })
const primaryBackupPath = 'outputs/member-migration-2026-09-01/private-backup/pre-migration-supabase-backup.json'
try {
  await fs.access(primaryBackupPath)
  await fs.writeFile(
    `outputs/member-migration-2026-09-01/private-backup/retry-state-${Date.now()}.json`,
    JSON.stringify(backup, null, 2),
  )
} catch {
  await fs.writeFile(primaryBackupPath, JSON.stringify(backup, null, 2))
}

for (const [table, pk] of tableSpecs) {
  const { error } = await db.from(table).delete().not(pk, 'is', null)
  if (error) throw new Error(`Delete ${table}: ${error.message}`)
}
for (const user of existingUsers) {
  const { error } = await db.auth.admin.deleteUser(user.id)
  if (error) throw new Error(`Delete auth user ${user.id}: ${error.message}`)
}
console.log(JSON.stringify({ phase: 'purge_complete', deleted_auth_users: existingUsers.length }))

const migrated = new Map()
let created = 0
for (const item of payload.eligible) {
  const memberNo = String(item.profile.member_no)
  const realEmail = String(item.auth?.email || '').trim().toLowerCase()
  const email = realEmail || `${memberNo}@legacy.iuna.invalid`
  const password = String(item.private.birth_date).replaceAll('-', '')
  const metadata = {
    legacy_migrated: true,
    migration_key: item.migration_key,
    member_no: memberNo,
    legal_name: item.private.legal_name,
    migration_email_pending: !realEmail,
    must_change_password: true,
  }
  const { data: createdUser, error: createError } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: metadata,
  })
  if (createError || !createdUser.user) throw new Error(`Create ${item.migration_key}: ${createError?.message || 'missing user'}`)
  const userId = createdUser.user.id
  migrated.set(item.migration_key, userId)

  for (const [table] of [['member_number_history'],['member_grade_history'],['member_status_history']]) {
    const { error } = await db.from(table).delete().eq('user_id', userId)
    if (error) throw new Error(`Clear bootstrap ${table} ${item.migration_key}: ${error.message}`)
  }
  const interests = Array.isArray(item.profile.interests) ? item.profile.interests : []
  const rawPhone = String(item.private.phone || '').trim()
  const phone = rawPhone.length >= 8 && rawPhone.length <= 30 ? rawPhone : null
  const invalidPhoneNote = rawPhone && !phone ? `기존 전화번호: ${rawPhone}` : ''
  const introduction = [item.profile.introduction || '', invalidPhoneNote].filter(Boolean).join(', ')
  const { error: profileError } = await db.from('profiles').update({
    member_no: memberNo,
    nickname: item.profile.nickname || item.private.legal_name,
    profile_image_path: item.profile.profile_image_path || null,
    company_name: item.profile.company_name || null,
    job_title: item.profile.job_title || null,
    introduction: introduction || null,
    interests,
    deleted_at: null,
  }).eq('id', userId)
  if (profileError) throw new Error(`Profile ${item.migration_key}: ${profileError.message}`)
  const { error: privateError } = await db.from('profile_private').update({
    legal_name: item.private.legal_name,
    gender: item.private.gender || 'undisclosed',
    birth_date: item.private.birth_date,
    phone,
    retention_status: 'active',
    retention_until: null,
    destroyed_at: null,
    destruction_method: null,
  }).eq('user_id', userId)
  if (privateError) throw new Error(`Private ${item.migration_key}: ${privateError.message}`)
  const gradeAt = item.membership.grade_started_at || new Date().toISOString()
  const statusAt = item.membership.status_started_at || new Date().toISOString()
  const { error: membershipError } = await db.from('memberships').update({
    grade: item.membership.grade,
    status: item.membership.status,
    grade_started_at: gradeAt,
    status_started_at: statusAt,
    last_completed_activity_at: null,
    dormant_at: null,
    withdrawn_at: null,
    expelled_at: null,
  }).eq('user_id', userId)
  if (membershipError) throw new Error(`Membership ${item.migration_key}: ${membershipError.message}`)
  const band = memberNo.startsWith('1') ? 'operator' : memberNo.startsWith('2') ? 'regular' : 'associate'
  const historyRows = [
    db.from('member_number_history').insert({ user_id:userId,member_no:memberNo,number_band:band,valid_from:gradeAt,change_reason:'legacy_2026_migration' }),
    db.from('member_grade_history').insert({ user_id:userId,from_grade:null,to_grade:item.membership.grade,reason_code:'data_migration',reason_text:'2026 회원리스트 초기 이관',source_entity_type:'legacy_member_list' }),
    db.from('member_status_history').insert({ user_id:userId,from_status:null,to_status:item.membership.status,reason_code:'data_migration',reason_text:'2026 회원리스트 초기 이관',source_entity_type:'legacy_member_list' }),
  ]
  const historyResults = await Promise.all(historyRows)
  const historyError = historyResults.find(x => x.error)?.error
  if (historyError) throw new Error(`History ${item.migration_key}: ${historyError.message}`)
  created++
  if (created % 20 === 0) console.log(JSON.stringify({ phase:'users', created, total:payload.eligible.length }))
}

const { data: roleRows, error: roleReadError } = await db.from('roles').select('id,code')
if (roleReadError) throw roleReadError
const roleIds = new Map(roleRows.map(x => [x.code, x.id]))
for (const role of payload.roles) {
  const userId = migrated.get(role.migration_key)
  const roleId = roleIds.get(role.role_code)
  if (!userId || !roleId) throw new Error(`Role mapping missing ${role.migration_key}/${role.role_code}`)
  const { error } = await db.from('member_roles').insert({ user_id:userId,role_id:roleId,assigned_at:new Date().toISOString() })
  if (error) throw new Error(`Role ${role.migration_key}: ${error.message}`)
}

const verify = {}
for (const [table] of [['profiles'],['profile_private'],['memberships'],['member_roles']]) {
  const { count, error } = await db.from(table).select('*',{count:'exact',head:true})
  if (error) throw error
  verify[table] = count
}
const { data: finalUsers, error: finalAuthError } = await db.auth.admin.listUsers({ page:1, perPage:1000 })
if (finalAuthError) throw finalAuthError
console.log(JSON.stringify({ phase:'complete', ...summary, final_auth_users:finalUsers.users.length, verify }, null, 2))
