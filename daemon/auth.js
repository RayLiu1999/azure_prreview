import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function generateToken() {
  return randomBytes(32).toString('hex')
}

export function tokenMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(actual, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function loadOrCreateToken(dir) {
  const file = join(dir, 'token')
  try {
    const existing = await readFile(file, 'utf8')
    const trimmed = existing.trim()
    if (trimmed) {
      // Keep an existing token private as well; mode is not changed by readFile.
      await chmod(file, 0o600).catch(() => {})
      return trimmed
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const token = generateToken()
  await mkdir(dir, { recursive: true })
  await writeFile(file, token + '\n', { mode: 0o600 })
  return token
}
