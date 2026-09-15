import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const AZURE_SERVER = 'azure-devops'

function configSource(options = {}) {
  return options.configPath || process.env.PRREVIEW_CLAUDE_MCP_CONFIG || join(homedir(), '.claude.json')
}

export async function createClaudeMcpConfig(options = {}) {
  const source = configSource(options)
  let config
  try {
    const text = await readFile(source, 'utf8')
    try {
      config = JSON.parse(text)
    } catch {
      throw new Error(`Claude 的 azure-devops MCP 設定檔不是有效 JSON：${source}`)
    }
  } catch (error) {
    if (error?.message?.startsWith('Claude 的 azure-devops MCP 設定檔不是有效 JSON')) throw error
    const detail = error?.code === 'ENOENT' ? '找不到設定檔' : '無法讀取設定檔'
    throw new Error(`Claude 的 azure-devops MCP ${detail}：${source}`)
  }

  const server = config?.mcpServers?.[AZURE_SERVER]
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    throw new Error(`Claude 未設定 azure-devops MCP。請先執行 claude mcp add，或設定 PRREVIEW_CLAUDE_MCP_CONFIG：${source}`)
  }

  const directory = await mkdtemp(join(tmpdir(), 'prreview-claude-mcp-'))
  const file = join(directory, 'mcp.json')
  try {
    await writeFile(file, JSON.stringify({ mcpServers: { [AZURE_SERVER]: server } }) + '\n', { mode: 0o600 })
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    path: file,
    async cleanup() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export { AZURE_SERVER }
