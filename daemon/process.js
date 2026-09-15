import { spawn, execFile } from 'node:child_process'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { delimiter, join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { parseFindings } from './findings.js'

const exec = promisify(execFile)

// Node cannot execute Windows npm .cmd/.ps1 shims with shell:false.
export async function resolveExecutable(name) {
  if (process.platform !== 'win32' || isAbsolute(name) || /[\\/]/.test(name)) return name
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (name === 'codex') {
      const packages = join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai')
      for (const pkg of await readdir(packages).catch(() => [])) {
        if (!pkg.startsWith('codex-win32-')) continue
        const vendor = join(packages, pkg, 'vendor')
        for (const arch of await readdir(vendor).catch(() => [])) {
          const file = join(vendor, arch, 'bin', 'codex.exe')
          try { await access(file); return file } catch {}
        }
      }
    }
    const file = join(dir, name.endsWith('.exe') ? name : `${name}.exe`)
    try { await access(file); return file } catch {}
  }
  return name
}

export async function capture(executable, args) {
  return exec(await resolveExecutable(executable), args, {
    windowsHide: true, shell: false, timeout: 30_000, maxBuffer: 2_000_000, encoding: 'utf8',
  })
}

export function runJsonlProcess(provider, prepare, parse, options = {}) {
  let child
  let cancelled = false
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  async function* generate() {
    let cwd
    let timer
    let timedOut = false
    try {
      if (cancelled) throw new Error('已取消')
      const invocation = await prepare()
      if (cancelled) throw new Error('已取消')
      cwd = await mkdtemp(join(tmpdir(), 'prreview-run-'))
      child = spawn(await resolveExecutable(invocation.executable), invocation.args, {
        cwd, env: invocation.env || process.env, shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let spawnError
      const exited = new Promise(resolve => {
        child.once('error', error => { spawnError = error })
        child.once('close', resolve)
      })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16_384) })
      timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
      let finalText
      let resultError
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
      for await (const line of lines) {
        if (options.onDiagnostic) {
          try {
            const raw = JSON.parse(line)
            options.onDiagnostic({ type: raw.type, item: raw.item && {
              type: raw.item.type, server: raw.item.server, tool: raw.item.tool,
              status: raw.item.status,
            } })
          } catch {}
        }
        const event = parse(line)
        if (!event) continue
        if (event.kind === 'result') {
          if (event.isError) resultError = event.text
          else finalText = event.text
        } else if (event.kind === 'violation') {
          resultError = event.message
          child.kill()
        } else yield event
      }
      const code = await exited
      if (spawnError) throw new Error(spawnError.code === 'ENOENT'
        ? `找不到 ${provider} 執行檔：${invocation.executable}`
        : `無法啟動 ${provider}：${spawnError.code || '未知錯誤'}`)
      if (cancelled) throw new Error('已取消')
      if (timedOut) throw new Error('審核逾時，請稍後重試。')
      if (resultError) throw new Error(resultError)
      if (code !== 0 || finalText === undefined) {
        const reason = /limit|quota/i.test(stderr) ? '帳號額度不足' : `退出代碼 ${code}，未完成審核`
        throw new Error(`${provider}：${reason}。請確認 CLI 登入與 azure-devops MCP 設定。`)
      }
      yield { kind: 'done', result: parseFindings(finalText) }
    } catch (error) {
      yield { kind: 'error', message: error.message }
    } finally {
      clearTimeout(timer)
      if (child && child.exitCode === null) child.kill()
      if (cwd) await rm(cwd, { recursive: true, force: true })
    }
  }
  return { events: generate(), cancel() { cancelled = true; child?.kill() } }
}
