import { parsePrUrl } from './prurl.js'
import { createSidebar } from './sidebar.js'
import { clearToken, getSettings, normalizeSettings, saveSettings, setAgent, setSettingsOpen, setSidebarOpen } from './settings.js'
import { checkConnection, getHistory, startReview, streamJob } from './client.js'

const DEFAULT_PANEL_WIDTH = 380
let host = null
let sidebar = null
let previousMarginRight = ''
let panelWidth = DEFAULT_PANEL_WIDTH

function applyBodyMargin() {
  if (!host || !sidebar?.isOpen()) {
    document.body.style.marginRight = previousMarginRight
    return
  }
  document.body.style.marginRight = `calc(${previousMarginRight || '0px'} + ${panelWidth}px)`
}

function mount() {
  if (host) return
  const pr = parsePrUrl(location.href)
  if (!pr) return
  host = document.createElement('div')
  host.id = 'prreview-host'
  const shadow = host.attachShadow({ mode: 'open' })
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = chrome.runtime.getURL('sidebar.css')
  shadow.append(link)
  previousMarginRight = document.body.style.marginRight
  document.body.append(host)
  sidebar = createSidebar(shadow)
  const instance = sidebar
  let agentChangedByUser = false
  let sidebarOpenChangedByUser = false
  panelWidth = DEFAULT_PANEL_WIDTH
  sidebar.onWidthChange(width => { panelWidth = width; applyBodyMargin() })
  sidebar.onVisibilityChange(open => {
    sidebarOpenChangedByUser = true
    applyBodyMargin()
    void setSidebarOpen(open).catch(error => {
      if (sidebar === instance) instance.setSettingsStatus(error?.message || '側邊欄狀態儲存失敗。', 'error')
    })
  })
  sidebar.onSettingsOpenChange(open => {
    void setSettingsOpen(open).catch(error => {
      if (sidebar === instance) instance.setSettingsStatus(error?.message || '設定收合狀態儲存失敗。', 'error')
    })
  })
  applyBodyMargin()
  sidebar.setState({ phase: 'idle' })
  void getSettings().then(settings => {
    if (sidebar !== instance) return
    if (!agentChangedByUser) instance.setAgent(settings.agent)
    instance.setSettings(settings)
    instance.setSettingsOpen(settings.settingsOpen)
    if (!sidebarOpenChangedByUser) instance.setOpen(settings.sidebarOpen)
    void loadHistory(instance, pr, settings)
  }).catch(() => {})
  sidebar.onAgentChange(agent => {
    agentChangedByUser = true
    void setAgent(agent).catch(error => {
      if (sidebar === instance) instance.setSettingsStatus(error?.message || 'Agent 設定儲存失敗。', 'error')
    })
  })
  sidebar.onHistorySelect(item => {
    if (sidebar !== instance || !item) return
    if (item.raw && (!item.verdict || item.status === 'error')) {
      instance.setState({ phase: 'raw', text: item.raw })
      return
    }
    if (item.status === 'error' || !item.verdict) {
      instance.setState({ phase: 'error', message: '這筆歷史結果沒有可用的結論。' })
      return
    }
    instance.setState({
      phase: 'results',
      summary: item.summary,
      verdict: item.verdict,
      findings: item.findings,
    })
  })
  sidebar.onSettingsSave(async draft => {
    instance.setSettingsBusy(true)
    instance.setSettingsStatus('儲存中…')
    try {
      const settings = await saveSettings(draft)
      if (sidebar !== instance) return
      instance.setSettings(settings)
      instance.setSettingsStatus('設定已儲存。', 'success')
      void loadHistory(instance, pr, settings)
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
      instance.setHistory([], 'error')
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
        ? { phase: 'results', summary: event.result.summary, verdict: event.result.verdict, findings: event.result.findings }
        : { phase: 'raw', text: event.result?.raw || '' })
    })
    await loadHistory(instance, pr, settings)
  } catch (error) {
    if (sidebar !== instance) return
    instance.setState({ phase: 'error', message: error instanceof TypeError ? 'daemon 未連線。請先執行：cd prreview/daemon && npm start' : error.message })
  }
}

async function loadHistory(instance, pr, settings) {
  if (sidebar !== instance) return
  if (!settings?.token) {
    instance.setHistory([], 'error')
    return
  }
  instance.setHistory([], 'loading')
  try {
    const items = await getHistory(pr, settings)
    if (sidebar === instance) instance.setHistory(items)
  } catch {
    if (sidebar === instance) instance.setHistory([], 'error')
  }
}

function unmount() {
  if (!host) return
  sidebar?.destroy?.()
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
