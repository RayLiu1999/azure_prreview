import { parsePrUrl } from './prurl.js'
import { createSidebar } from './sidebar.js'
import { clearToken, getDaemonFolderPath, getSettings, normalizeSettings, saveDaemonFolderPath, saveSettings, setAgent, setSettingsOpen, setSidebarOpen } from './settings.js'
import { checkConnection, getHistory, startReview, streamJob } from './client.js'

const DEFAULT_PANEL_WIDTH = 380
let host = null
let sidebar = null
let previousMarginRight = ''
let panelWidth = DEFAULT_PANEL_WIDTH
const DAEMON_START_GUIDANCE = 'Daemon 未連線。請在「設定」填入並儲存 start-daemon.cmd 所在資料夾，複製路徑貼到檔案總管網址列，再啟動 start-daemon.cmd。'

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const field = document.createElement('textarea')
  field.value = value
  field.readOnly = true
  field.setAttribute('aria-hidden', 'true')
  field.style.position = 'fixed'
  field.style.left = '-9999px'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('無法複製路徑，請手動選取欄位複製。')
}

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
  void getDaemonFolderPath().then(folderPath => {
    if (sidebar === instance) instance.setDaemonFolderPath(folderPath)
  }).catch(error => {
    if (sidebar === instance) instance.setDaemonFolderStatus(error?.message || '無法讀取已儲存的資料夾路徑。', 'error')
  })
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
        ? DAEMON_START_GUIDANCE
        : error?.message || '連線測試失敗。', 'error')
    } finally {
      if (sidebar === instance) instance.setSettingsBusy(false)
    }
  })
  sidebar.onDaemonFolderSave(async folderPath => {
    instance.setDaemonFolderBusy(true)
    instance.setDaemonFolderStatus('儲存路徑中…')
    try {
      const savedPath = await saveDaemonFolderPath(folderPath)
      if (sidebar === instance) {
        instance.setDaemonFolderPath(savedPath)
        instance.setDaemonFolderStatus('資料夾路徑已儲存。', 'success')
      }
    } catch (error) {
      if (sidebar === instance) instance.setDaemonFolderStatus(error?.message || '路徑儲存失敗。', 'error')
    } finally {
      if (sidebar === instance) instance.setDaemonFolderBusy(false)
    }
  })
  sidebar.onDaemonFolderCopy(async folderPath => {
    if (!folderPath) {
      instance.setDaemonFolderStatus('請先填入 start-daemon.cmd 所在資料夾路徑。', 'error')
      return
    }
    instance.setDaemonFolderBusy(true)
    instance.setDaemonFolderStatus('複製路徑中…')
    try {
      await copyTextToClipboard(folderPath)
      if (sidebar === instance) instance.setDaemonFolderStatus('路徑已複製，貼到檔案總管網址列即可開啟資料夾。', 'success')
    } catch (error) {
      if (sidebar === instance) instance.setDaemonFolderStatus(error?.message || '路徑複製失敗。', 'error')
    } finally {
      if (sidebar === instance) instance.setDaemonFolderBusy(false)
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
    if (error instanceof TypeError) {
      instance.setState({ phase: 'error', message: DAEMON_START_GUIDANCE })
    } else {
      instance.setState({ phase: 'error', message: error.message })
    }
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
