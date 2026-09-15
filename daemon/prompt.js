import { readFile } from 'node:fs/promises'

export async function buildPrompt(pr) {
  const template = await readFile(new URL('./prompts/review.md', import.meta.url), 'utf8')
  return template.replace(/\{\{(org|project|repo|prId)\}\}/g, (_, key) => String(pr[key]))
}

export const READ_ONLY_TOOLS = Object.freeze([
  'repo_pull_request', 'repo_file', 'repo_branch', 'repo_repository', 'search_code',
])
