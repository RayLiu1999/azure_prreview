param(
  [Parameter(Mandatory = $true)]
  [string]$TokenFile
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
  throw "找不到 token：$TokenFile"
}

$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
if ($token -notmatch '^[a-f0-9]{64}$') {
  throw 'token 格式無效'
}

Set-Clipboard -Value $token
