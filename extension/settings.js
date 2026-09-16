const DEFAULTS = Object.freeze({
  daemonUrl: 'http://127.0.0.1:7797',
  token: '',
  agent: 'claude',
  settingsOpen: true,
})

function normalizeDaemonUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return DEFAULTS.daemonUrl
  try {
    const url = new URL(value)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
    if (!loopback || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return DEFAULTS.daemonUrl
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return DEFAULTS.daemonUrl
  }
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  const merged = { ...DEFAULTS, ...stored }
  const normalized = normalizeSettings(merged)
  return {
    ...normalized,
    agent: merged.agent === 'codex' ? 'codex' : 'claude',
    settingsOpen: typeof merged.settingsOpen === 'boolean' ? merged.settingsOpen : DEFAULTS.settingsOpen,
  }
}

export function normalizeSettings(values = {}) {
  return {
    daemonUrl: normalizeDaemonUrl(values.daemonUrl),
    token: typeof values.token === 'string' ? values.token.trim() : '',
  }
}

export async function saveSettings(values = {}) {
  await chrome.storage.local.set(normalizeSettings(values))
  return getSettings()
}

export async function clearToken() {
  await chrome.storage.local.remove('token')
  return getSettings()
}

export async function setAgent(agent) {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('未知的 Agent')
  await chrome.storage.local.set({ agent })
}

export async function setSettingsOpen(open) {
  const settingsOpen = Boolean(open)
  await chrome.storage.local.set({ settingsOpen })
  return settingsOpen
}

export { DEFAULTS, normalizeDaemonUrl }
