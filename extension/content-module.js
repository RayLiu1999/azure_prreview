import { parsePrUrl } from './prurl.js'
import { createSidebar } from './sidebar.js'
import { clearToken, getSettings, normalizeSettings, saveSettings, setAgent } from './settings.js'
import { checkConnection, startReview, streamJob } from './client.js'

const PANEL_WIDTH = '380px'
let host = null
let sidebar = null
let previousMarginRight = ''

function mount() {
  if (host) return
  host = document.createElement('div')
  host.id = 'prreview-host'
  const shadow = host.attachShadow({ mode: 'open' })
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = chrome.runtime.getURL('sidebar.css')
  shadow.append(link)
  previousMarginRight = document.body.style.marginRight
  document.body.append(host)
  document.body.style.marginRight = `calc(${previousMarginRight || '0px'} + ${PANEL_WIDTH})`
  sidebar = createSidebar(shadow)
  const instance = sidebar
  sidebar.setState({ phase: 'idle' })
  void getSettings().then(settings => {
    if (sidebar !== instance) return
    instance.setAgent(settings.agent)
    instance.setSettings(settings)
  }).catch(() => {})
  sidebar.onAgentChange(agent => { void setAgent(agent).catch(() => {}) })
  sidebar.onSettingsSave(async draft => {
    instance.setSettingsBusy(true)
    instance.setSettingsStatus('儲存中…')
    try {
      const settings = await saveSettings(draft)
      if (sidebar !== instance) return
      instance.setSettings(settings)
      instance.setSettingsStatus('設定已儲存。', 'success')
    } catch (error) {
      if (sidebar === instance) instance.setSettingsStatus(error?.message || '設定儲存失敗。', 'error')
    } finally {
      if (sidebar === instance) instance.setSettingsBusy(false)
    }
  })
  sidebar.onSettingsClear(async () => {
    instance.setSettingsBusy(true)
    instance.setSettingsStatus('清除中…')
    try {
      const settings = await clearToken()
      if (sidebar !== instance) return
      instance.setSettings(settings)
      instance.setSettingsStatus('Token 已清除。', 'success')
    } catch (error) {
      if (sidebar === instance) instance.setSettingsStatus(error?.message || 'Token 清除失敗。', 'error')
    } finally {
      if (sidebar === instance) instance.setSettingsBusy(false)
    }
  })
  sidebar.onSettingsTest(async draft => {
    const candidate = normalizeSettings(draft)
    instance.setSettingsBusy(true)
    instance.setSettingsStatus('測試連線中…')
    try {
      await checkConnection(candidate)
      if (sidebar === instance) instance.setSettingsStatus('連線成功，token 有效。', 'success')
    } catch (error) {
      if (sidebar !== instance) return
      instance.setSettingsStatus(error instanceof TypeError
        ? 'daemon 未連線。請確認 daemon 正在執行。'
        : error?.message || '連線測試失敗。', 'error')
    } finally {
      if (sidebar === instance) instance.setSettingsBusy(false)
    }
  })
  sidebar.onReview(() => review(instance))
}

async function review(instance) {
  const pr = parsePrUrl(location.href)
  if (!pr || sidebar !== instance) return
  const settings = { ...(await getSettings()), agent: instance.getAgent() }
  if (sidebar !== instance) return
  if (!settings.token) {
    instance.setState({ phase: 'error', message: '尚未設定 token。請先在側邊欄的「設定」區貼上 daemon token。' })
    return
  }
  instance.setState({ phase: 'running', progress: '連線中…' })
  try {
    const jobId = await startReview(pr, settings)
    await streamJob(jobId, settings, event => {
      if (sidebar !== instance) return
      if (event.kind === 'tool') instance.setState({ phase: 'running', progress: event.detail ? `${event.tool} → ${event.detail}` : event.tool })
      else if (event.kind === 'text') instance.setState({ phase: 'running', progress: event.text })
      else if (event.kind === 'error') instance.setState({ phase: 'error', message: event.message })
      else if (event.kind === 'done') instance.setState(event.result?.ok
        ? { phase: 'results', summary: event.result.summary, findings: event.result.findings }
        : { phase: 'raw', text: event.result?.raw || '' })
    })
  } catch (error) {
    if (sidebar !== instance) return
    instance.setState({ phase: 'error', message: error instanceof TypeError ? 'daemon 未連線。請先執行：cd prreview/daemon && npm start' : error.message })
  }
}

function unmount() {
  if (!host) return
  host.remove()
  host = null
  sidebar = null
  document.body.style.marginRight = previousMarginRight
  previousMarginRight = ''
}

function sync() {
  const pr = parsePrUrl(location.href)
  if (pr) mount()
  else unmount()
}

let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) { lastUrl = location.href; sync() }
}).observe(document, { subtree: true, childList: true })
sync()
