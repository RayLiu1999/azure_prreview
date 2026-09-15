const SEVERITY_ORDER = Object.freeze({ blocker: 0, major: 1, minor: 2, nit: 3 })

export function createSidebar(root) {
  const panel = document.createElement('div')
  panel.className = 'panel'
  const title = document.createElement('h1')
  title.className = 'title'
  title.textContent = 'AI Review'
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
  panel.append(title, agentRow, button, content)
  root.append(panel)

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
    setAgent(agent) { agentSelect.value = agent === 'codex' ? 'codex' : 'claude' },
    getAgent() { return agentSelect.value === 'codex' ? 'codex' : 'claude' },
    onAgentChange(fn) { agentSelect.addEventListener('change', () => fn(agentSelect.value)) },
    onReview(fn) { button.addEventListener('click', fn) },
  }
}
