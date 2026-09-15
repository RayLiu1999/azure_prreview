import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeMcpConfig } from '../claude.js'

async function makeConfig(config) {
  const directory = await mkdtemp(join(tmpdir(), 'prreview-claude-test-'))
  const path = join(directory, 'claude.json')
  await writeFile(path, JSON.stringify(config), 'utf8')
  return { directory, path }
}

test('createClaudeMcpConfig 只保留 azure-devops MCP', async () => {
  const config = {
    mcpServers: {
      'azure-devops': {
        type: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'KingnetRD', '-a', 'pat'],
        env: { PERSONAL_ACCESS_TOKEN: 'secret', NODE_OPTIONS: '--use-system-ca' },
      },
      other: { type: 'stdio', command: 'other' },
    },
  }
  const source = await makeConfig(config)
  try {
    const generated = await createClaudeMcpConfig({ configPath: source.path })
    try {
      assert.deepEqual(JSON.parse(await readFile(generated.path, 'utf8')), {
        mcpServers: { 'azure-devops': config.mcpServers['azure-devops'] },
      })
    } finally {
      await generated.cleanup()
    }
    await assert.rejects(() => readFile(generated.path), { code: 'ENOENT' })
  } finally {
    await rm(source.directory, { recursive: true, force: true })
  }
})

test('createClaudeMcpConfig 對缺少或無效設定回報明確錯誤', async () => {
  await assert.rejects(
    () => createClaudeMcpConfig({ configPath: join(tmpdir(), 'prreview-claude-does-not-exist.json') }),
    /找不到設定檔/,
  )

  const source = await makeConfig({ mcpServers: { other: { command: 'other' } } })
  try {
    await assert.rejects(() => createClaudeMcpConfig({ configPath: source.path }), /未設定 azure-devops MCP/)
  } finally {
    await rm(source.directory, { recursive: true, force: true })
  }
})

test('createClaudeMcpConfig 拒絕損壞的 JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prreview-claude-test-'))
  const path = join(directory, 'claude.json')
  await writeFile(path, '{broken', 'utf8')
  try {
    await assert.rejects(() => createClaudeMcpConfig({ configPath: path }), /設定檔不是有效 JSON/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
