import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearToken, getSettings, normalizeSettings, saveSettings } from '../settings.js'

let previousChrome
let stored

beforeEach(() => {
  previousChrome = globalThis.chrome
  stored = {}
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...stored } },
        async set(values) { Object.assign(stored, values) },
        async remove(keys) {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key]
        },
      },
    },
  }
})

afterEach(() => {
  if (previousChrome === undefined) delete globalThis.chrome
  else globalThis.chrome = previousChrome
})

test('normalizeSettings 只接受本機 daemon URL 並清除 token 空白', () => {
  assert.deepEqual(normalizeSettings({ daemonUrl: 'http://localhost:7797/', token: '  abc  ' }), {
    daemonUrl: 'http://localhost:7797',
    token: 'abc',
  })
  assert.equal(normalizeSettings({ daemonUrl: 'https://evil.example', token: 'x' }).daemonUrl, 'http://127.0.0.1:7797')
})

test('saveSettings 儲存設定並回傳完整設定', async () => {
  const settings = await saveSettings({ daemonUrl: 'http://localhost:7797/', token: '  abc  ' })
  assert.deepEqual(settings, { daemonUrl: 'http://localhost:7797', token: 'abc', agent: 'claude' })
})

test('clearToken 只清除 token 並保留 daemon URL', async () => {
  await saveSettings({ daemonUrl: 'http://localhost:7797', token: 'abc' })
  const settings = await clearToken()
  assert.deepEqual(settings, { daemonUrl: 'http://localhost:7797', token: '', agent: 'claude' })
  assert.deepEqual(await getSettings(), settings)
})
