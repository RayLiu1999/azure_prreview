const SEVERITY_ORDER = Object.freeze({ blocker: 0, major: 1, minor: 2, nit: 3 })
const DEFAULT_PANEL_WIDTH = 380
const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 720

function maxPanelWidth() {
  const viewport = typeof window === 'undefined' || !Number.isFinite(window.innerWidth)
    ? MAX_PANEL_WIDTH
    : window.innerWidth - 40
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, viewport))
}

function clampPanelWidth(value) {
  const width = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_PANEL_WIDTH
  return Math.round(Math.min(maxPanelWidth(), Math.max(MIN_PANEL_WIDTH, width)))
}

export function createSidebar(root) {
  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.style.setProperty('--prreview-panel-width', `${DEFAULT_PANEL_WIDTH}px`)

  const resizeHandle = document.createElement('div')
  resizeHandle.className = 'resize-handle'
  resizeHandle.setAttribute('role', 'separator')
  resizeHandle.setAttribute('aria-orientation', 'vertical')
  resizeHandle.setAttribute('aria-label', '調整側邊欄寬度')
  resizeHandle.tabIndex = 0
  resizeHandle.setAttribute('aria-valuemin', String(MIN_PANEL_WIDTH))
  resizeHandle.setAttribute('aria-valuemax', String(maxPanelWidth()))
  resizeHandle.setAttribute('aria-valuenow', String(DEFAULT_PANEL_WIDTH))

  const header = document.createElement('div')
  header.className = 'panel-header'
  const title = document.createElement('h1')
  title.className = 'title'
  title.textContent = 'AI Review'
  const closeButton = document.createElement('button')
  closeButton.className = 'panel-close'
  closeButton.type = 'button'
  closeButton.textContent = '×'
  closeButton.setAttribute('aria-label', '隱藏 AI Review 側邊欄')
  closeButton.title = '隱藏側邊欄'
  header.append(title, closeButton)

  const settingsDetails = document.createElement('details')
  settingsDetails.className = 'settings'
  settingsDetails.open = true
  const settingsSummary = document.createElement('summary')
  settingsSummary.textContent = '設定'
  const settingsForm = document.createElement('form')
  settingsForm.className = 'settings-form'
  settingsForm.noValidate = true

  const daemonUrlInput = document.createElement('input')
  daemonUrlInput.className = 'daemon-url'
  daemonUrlInput.type = 'url'
  daemonUrlInput.inputMode = 'url'
  daemonUrlInput.autocomplete = 'url'
  daemonUrlInput.spellcheck = false
  daemonUrlInput.placeholder = 'http://127.0.0.1:7797'
  daemonUrlInput.setAttribute('aria-label', 'Daemon URL')
  const daemonUrlField = document.createElement('label')
  daemonUrlField.className = 'settings-field'
  const daemonUrlCaption = document.createElement('span')
  daemonUrlCaption.textContent = 'Daemon URL'
  daemonUrlField.append(daemonUrlCaption, daemonUrlInput)

  const tokenInput = document.createElement('input')
  tokenInput.className = 'token'
  tokenInput.type = 'password'
  tokenInput.autocomplete = 'off'
  tokenInput.spellcheck = false
  tokenInput.placeholder = '貼上 daemon 啟動時顯示的 token'
  tokenInput.setAttribute('aria-label', 'Daemon token')
  const revealButton = document.createElement('button')
  revealButton.className = 'settings-action reveal-token'
  revealButton.type = 'button'
  revealButton.textContent = '顯示'
  revealButton.setAttribute('aria-label', '顯示或隱藏 token')
  const tokenRow = document.createElement('div')
  tokenRow.className = 'token-row'
  tokenRow.append(tokenInput, revealButton)
  const tokenField = document.createElement('label')
  tokenField.className = 'settings-field'
  const tokenCaption = document.createElement('span')
  tokenCaption.textContent = 'Token'
  tokenField.append(tokenCaption, tokenRow)

  const settingsActions = document.createElement('div')
  settingsActions.className = 'settings-actions'
  const saveButton = document.createElement('button')
  saveButton.className = 'settings-action primary'
  saveButton.type = 'submit'
  saveButton.textContent = '儲存設定'
  const clearButton = document.createElement('button')
  clearButton.className = 'settings-action'
  clearButton.type = 'button'
  clearButton.textContent = '清除 Token'
  const testButton = document.createElement('button')
  testButton.className = 'settings-action'
  testButton.type = 'button'
  testButton.textContent = '測試連線'
  settingsActions.append(saveButton, clearButton, testButton)

  const settingsStatus = document.createElement('div')
  settingsStatus.className = 'settings-status'
  settingsStatus.setAttribute('role', 'status')
  settingsStatus.setAttribute('aria-live', 'polite')
  settingsForm.append(daemonUrlField, tokenField, settingsActions, settingsStatus)
  settingsDetails.append(settingsSummary, settingsForm)

  const agentRow = document.createElement('label')
  agentRow.className = 'agent-row'
  agentRow.append(document.createTextNode('Agent'))
  const agentSelect = document.createElement('select')
  agentSelect.className = 'agent'
  agentSelect.setAttribute('aria-label', '選擇審核 Agent')
  for (const [value, label] of [['claude', 'Claude'], ['codex', 'Codex']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    agentSelect.append(option)
  }
  agentRow.append(agentSelect)

  const button = document.createElement('button')
  button.className = 'review'
  button.type = 'button'
  button.textContent = '開始審核'
  const content = document.createElement('div')
  content.className = 'content'
  panel.append(resizeHandle, header, settingsDetails, agentRow, button, content)

  const reopenButton = document.createElement('button')
  reopenButton.className = 'reopen-button'
  reopenButton.type = 'button'
  reopenButton.setAttribute('aria-label', '開啟 AI Review 側邊欄')
  reopenButton.title = '開啟 AI Review 側邊欄'
  const reopenIcon = document.createElement('img')
  reopenIcon.alt = ''
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    reopenIcon.src = chrome.runtime.getURL('icons/icon48.png')
  }
  const reopenLabel = document.createElement('span')
  reopenLabel.className = 'reopen-label'
  reopenLabel.textContent = 'AI'
  reopenButton.append(reopenIcon, reopenLabel)
  reopenButton.hidden = true
  root.append(panel)
  root.append(reopenButton)

  let settingsSaveHandler = null
  let settingsClearHandler = null
  let settingsTestHandler = null
  let visibilityHandler = null
  let widthHandler = null
  let isOpen = true
  let drag = null

  const setPanelWidth = value => {
    const width = clampPanelWidth(value)
    panel.style.setProperty('--prreview-panel-width', `${width}px`)
    resizeHandle.setAttribute('aria-valuemax', String(maxPanelWidth()))
    resizeHandle.setAttribute('aria-valuenow', String(width))
    if (widthHandler) widthHandler(width)
    return width
  }
  const setOpen = open => {
    isOpen = Boolean(open)
    panel.hidden = !isOpen
    reopenButton.hidden = isOpen
    if (visibilityHandler) visibilityHandler(isOpen)
  }
  const stopResize = () => {
    if (!drag) return
    window.removeEventListener('pointermove', drag.onMove)
    window.removeEventListener('pointerup', drag.onStop)
    window.removeEventListener('pointercancel', drag.onStop)
    document.body.style.userSelect = drag.userSelect
    document.body.style.cursor = drag.cursor
    drag = null
  }
  const beginResize = event => {
    if (event.button !== 0 || !isOpen) return
    event.preventDefault()
    const current = parseFloat(panel.style.getPropertyValue('--prreview-panel-width')) || DEFAULT_PANEL_WIDTH
    const onMove = move => setPanelWidth(current + event.clientX - move.clientX)
    const onStop = () => stopResize()
    drag = {
      onMove,
      onStop,
      userSelect: document.body.style.userSelect,
      cursor: document.body.style.cursor,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onStop)
    window.addEventListener('pointercancel', onStop)
    resizeHandle.setPointerCapture?.(event.pointerId)
  }

  const setSettingsStatus = (message = '', kind = '') => {
    settingsStatus.className = 'settings-status'
    if (kind) settingsStatus.dataset.kind = kind
    else delete settingsStatus.dataset.kind
    settingsStatus.textContent = typeof message === 'string' ? message : String(message ?? '')
  }
  const invoke = (handler, value) => {
    if (!handler) return
    try {
      const result = handler(value)
      if (result && typeof result.catch === 'function') {
        result.catch(error => setSettingsStatus(error?.message || '設定操作失敗。', 'error'))
      }
    } catch (error) {
      setSettingsStatus(error?.message || '設定操作失敗。', 'error')
    }
  }
  const getSettingsDraft = () => ({ daemonUrl: daemonUrlInput.value, token: tokenInput.value })
  const setSettings = (values = {}) => {
    daemonUrlInput.value = typeof values.daemonUrl === 'string' ? values.daemonUrl : ''
    tokenInput.value = typeof values.token === 'string' ? values.token : ''
  }
  const setSettingsBusy = busy => {
    for (const control of [daemonUrlInput, tokenInput, revealButton, saveButton, clearButton, testButton]) {
      control.disabled = Boolean(busy)
    }
  }

  revealButton.addEventListener('click', () => {
    const visible = tokenInput.type === 'text'
    tokenInput.type = visible ? 'password' : 'text'
    revealButton.textContent = visible ? '顯示' : '隱藏'
  })
  settingsForm.addEventListener('submit', event => {
    event.preventDefault()
    invoke(settingsSaveHandler, getSettingsDraft())
  })
  clearButton.addEventListener('click', () => invoke(settingsClearHandler))
  testButton.addEventListener('click', () => invoke(settingsTestHandler, getSettingsDraft()))
  closeButton.addEventListener('click', () => setOpen(false))
  reopenButton.addEventListener('click', () => setOpen(true))
  resizeHandle.addEventListener('pointerdown', beginResize)
  resizeHandle.addEventListener('keydown', event => {
    const current = parseFloat(panel.style.getPropertyValue('--prreview-panel-width')) || DEFAULT_PANEL_WIDTH
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setPanelWidth(current + 16)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setPanelWidth(current - 16)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPanelWidth(MIN_PANEL_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setPanelWidth(MAX_PANEL_WIDTH)
    }
  })

  const note = (className, value) => {
    const el = document.createElement('div')
    el.className = className
    el.textContent = typeof value === 'string' ? value : String(value ?? '')
    return el
  }
  const renderFinding = finding => {
    const el = document.createElement('div')
    el.className = 'finding'
    el.dataset.severity = SEVERITY_ORDER[finding.severity] === undefined ? 'minor' : finding.severity
    const where = note('where', finding.line ? `${finding.file}:${finding.line}` : finding.file)
    const headline = note('headline', `[${el.dataset.severity}] ${finding.title}`)
    const body = note('body', finding.body)
    el.append(where, headline, body)
    return el
  }
  function setState(state = { phase: 'idle' }) {
    content.replaceChildren()
    const phase = state.phase
    const running = phase === 'running'
    button.disabled = running
    agentSelect.disabled = running
    button.textContent = running ? '審核中…' : '開始審核'
    if (phase === 'running') content.append(note('progress', state.progress || '處理中…'))
    else if (phase === 'error') content.append(note('error', state.message || '發生未知錯誤'))
    else if (phase === 'raw') content.append(note('raw', state.text || ''))
    else if (phase === 'results') {
      if (state.summary) content.append(note('summary', state.summary))
      const findings = Array.isArray(state.findings) ? state.findings : []
      content.append(note('count', `發現 ${findings.length} 個問題`))
      const sorted = [...findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2))
      if (!sorted.length) content.append(note('summary', '沒有發現問題。'))
      else for (const finding of sorted) content.append(renderFinding(finding))
    }
  }
  return {
    setState,
    setOpen,
    isOpen: () => isOpen,
    setPanelWidth,
    onVisibilityChange(fn) { visibilityHandler = fn },
    onWidthChange(fn) { widthHandler = fn },
    destroy() { stopResize() },
    setAgent(agent) { agentSelect.value = agent === 'codex' ? 'codex' : 'claude' },
    getAgent() { return agentSelect.value === 'codex' ? 'codex' : 'claude' },
    onAgentChange(fn) { agentSelect.addEventListener('change', () => fn(agentSelect.value)) },
    onReview(fn) { button.addEventListener('click', fn) },
    setSettings,
    getSettingsDraft,
    setSettingsStatus,
    setSettingsBusy,
    onSettingsSave(fn) { settingsSaveHandler = fn },
    onSettingsClear(fn) { settingsClearHandler = fn },
    onSettingsTest(fn) { settingsTestHandler = fn },
  }
}
