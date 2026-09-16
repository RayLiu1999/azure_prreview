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

$clipCommand = Get-Command clip.exe -ErrorAction SilentlyContinue
if ($clipCommand) {
  $token | & $clipCommand.Source
  if ($LASTEXITCODE -eq 0) {
    exit 0
  }
}

# clip.exe is available on normal Windows installations. Keep Set-Clipboard
# as a fallback for environments that do not expose the native command.
Set-Clipboard -Value $token
