import { parsePrUrl } from './prurl.js'
import { createSidebar } from './sidebar.js'
import { getSettings, setAgent } from './settings.js'
import { startReview, streamJob } from './client.js'

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
  void getSettings().then(settings => { if (sidebar === instance) instance.setAgent(settings.agent) }).catch(() => {})
  sidebar.onAgentChange(agent => { void setAgent(agent).catch(() => {}) })
  sidebar.onReview(() => review(instance))
}

async function review(instance) {
  const pr = parsePrUrl(location.href)
  if (!pr || sidebar !== instance) return
  const settings = { ...(await getSettings()), agent: instance.getAgent() }
  if (sidebar !== instance) return
  if (!settings.token) {
    instance.setState({ phase: 'error', message: '尚未設定 token。請依 README 說明貼上 daemon 啟動時印出的 token。' })
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
