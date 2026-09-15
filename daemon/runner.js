import { capture, runJsonlProcess } from './process.js'
import { parseStreamEvent } from './stream.js'
import { buildPrompt, READ_ONLY_TOOLS } from './prompt.js'
import { runCodexReview } from './codex.js'

export async function checkAgentAvailable(agent, executable) {
  if (!['claude', 'codex'].includes(agent)) return false
  try { await capture(executable || agent, ['--version']); return true } catch { return false }
}
export const checkClaudeAvailable = executable => checkAgentAvailable('claude', executable)

export function runReview(pr, options = {}) {
  const agent = options.agent ?? 'claude'
  if (!['claude', 'codex'].includes(agent)) throw new Error('未知的 Agent：僅接受 claude 或 codex')
  if (agent === 'codex') return runCodexReview(pr, options)
  return runJsonlProcess('claude', async () => {
    const args = ['-p', await buildPrompt(pr), '--output-format', 'stream-json', '--verbose',
      '--restricted', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
      '--allowedTools', ...READ_ONLY_TOOLS.map(t => `mcp__azure-devops__${t}`),
      '--permission-mode', 'dontAsk']
    if (options.model) args.push('--model', options.model)
    return { executable: options.claudePath || process.env.PRREVIEW_CLAUDE || 'claude', args }
  }, parseStreamEvent, options)
}
