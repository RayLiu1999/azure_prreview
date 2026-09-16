import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearToken, getSettings, normalizeSettings, saveSettings, setAgent, setSettingsOpen } from '../settings.js'

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
  assert.deepEqual(settings, { daemonUrl: 'http://localhost:7797', token: 'abc', agent: 'claude', settingsOpen: true })
})

test('clearToken 只清除 token 並保留 daemon URL', async () => {
  await saveSettings({ daemonUrl: 'http://localhost:7797', token: 'abc' })
  const settings = await clearToken()
  assert.deepEqual(settings, { daemonUrl: 'http://localhost:7797', token: '', agent: 'claude', settingsOpen: true })
  assert.deepEqual(await getSettings(), settings)
})

test('setAgent 保存 Codex 選擇並拒絕未知 Agent', async () => {
  await setAgent('codex')
  assert.equal((await getSettings()).agent, 'codex')
  await assert.rejects(() => setAgent('other'), /未知的 Agent/)
  assert.equal((await getSettings()).agent, 'codex')
})

test('設定區收合狀態保存於瀏覽器並可在下次讀取', async () => {
  assert.equal((await getSettings()).settingsOpen, true)
  assert.equal(await setSettingsOpen(false), false)
  assert.equal((await getSettings()).settingsOpen, false)
  assert.equal(await setSettingsOpen(true), true)
  assert.equal((await getSettings()).settingsOpen, true)
})

test('設定區收合狀態遇到舊版或無效值時回到預設展開', async () => {
  stored.settingsOpen = 'false'
  assert.equal((await getSettings()).settingsOpen, true)
})
