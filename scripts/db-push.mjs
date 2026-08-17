// Apply supabase/schema.sql. Used by `pnpm db:push`.
//
// The direct host (db.<ref>.supabase.co) is IPv6-only, which a lot of networks —
// WSL2 among them — cannot reach, so this prefers the IPv4 pooler. Set
// SUPABASE_DB_URL to skip the region search entirely (copy it from the dashboard,
// Project settings > Database > Connection pooling).
//
// TLS: Supabase serves its own CA, which is not in the system trust store, so a
// verified connection needs that certificate — download it from the dashboard
// (Project settings > Database > SSL configuration) and point SUPABASE_DB_CA at
// it. Verification is never skipped silently: the database password crosses this
// connection. To accept the risk knowingly on a trusted network, set
// SUPABASE_DB_ALLOW_SELF_SIGNED=1.
//
// The dashboard SQL editor is the simplest route and needs none of this.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

function tlsConfig() {
  const caPath = process.env.SUPABASE_DB_CA
  if (caPath) return { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
  if (process.env.SUPABASE_DB_ALLOW_SELF_SIGNED === '1') {
    console.warn('WARNING: TLS certificate not verified (SUPABASE_DB_ALLOW_SELF_SIGNED=1).')
    return { rejectUnauthorized: false }
  }
  return { rejectUnauthorized: true }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8')

const ssl = tlsConfig()
const password = process.env.SUPABASE_DB_PASSWORD
const url = process.env.SUPABASE_URL ?? ''
const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]

// Pooler regions, most likely first. Only the correct one authenticates.
const REGIONS = [
  'eu-west-2', 'eu-west-1', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
  'sa-east-1', 'ca-central-1',
]

function candidates() {
  if (process.env.SUPABASE_DB_URL) {
    return [{ label: 'SUPABASE_DB_URL', config: { connectionString: process.env.SUPABASE_DB_URL, ssl } }]
  }
  if (!ref || !password) return []
  const out = []
  for (const region of REGIONS) {
    for (const prefix of ['aws-0', 'aws-1']) {
      out.push({
        label: `${prefix}-${region}`,
        config: {
          host: `${prefix}-${region}.pooler.supabase.com`,
          port: 5432, // session mode: transaction mode cannot run DDL scripts
          user: `postgres.${ref}`,
          password,
          database: 'postgres',
          ssl,
          connectionTimeoutMillis: 8000,
        },
      })
    }
  }
  return out
}

const list = candidates()
if (list.length === 0) {
  console.error('Set SUPABASE_URL and SUPABASE_DB_PASSWORD in .env (or SUPABASE_DB_URL).')
  process.exit(1)
}

for (const { label, config } of list) {
  const client = new pg.Client(config)
  try {
    await client.connect()
  } catch (err) {
    // "Tenant or user not found" simply means this is the wrong region.
    const wrongRegion = /Tenant or user not found|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|self-signed/i.test(
      err.message,
    )
    await client.end().catch(() => {})
    if (wrongRegion) continue
    console.error(`${label}: ${err.message}`)
    continue
  }

  try {
    console.log(`connected via ${label}, applying schema...`)
    await client.query(sql)
    console.log('schema applied')
    process.exit(0)
  } catch (err) {
    console.error('schema failed:', err.message)
    process.exit(1)
  } finally {
    await client.end().catch(() => {})
  }
}

console.error(
  'Could not apply the schema. Either paste supabase/schema.sql into the dashboard SQL\n' +
    'editor, or download the certificate from Project settings > Database > SSL\n' +
    'configuration, point SUPABASE_DB_CA at it, and run this again.',
)
process.exit(1)
