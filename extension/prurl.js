const PR_PATH = /^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/

export function parsePrUrl(url) {
  if (typeof url !== 'string' || !url) return null

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return null

  const legacy = parsed.hostname.match(/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.visualstudio\.com$/)
  if (parsed.hostname !== 'dev.azure.com' && !legacy) return null
  const path = legacy ? `/${legacy[1]}${parsed.pathname}` : parsed.pathname
  const match = path.match(PR_PATH)
  if (!match) return null

  const [, org, project, repo, prId] = match
  const id = Number(prId)
  if (!Number.isSafeInteger(id) || id < 1) return null
  try {
    return {
      org: decodeURIComponent(org),
      project: decodeURIComponent(project),
      repo: decodeURIComponent(repo),
      prId: id,
    }
  } catch {
    return null
  }
}
