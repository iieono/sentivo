# Builds both binaries into dist/.
#   agent.exe : Windows, -H windowsgui = no console window (runs hidden)
#   relay     : Linux amd64, for the VPS
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force dist | Out-Null

Write-Host "Building agent (windows)..."
go build -ldflags "-s -w -H=windowsgui" -o dist/agent.exe ./agent

Write-Host "Building relay.exe (windows, on-device mode)..."
go build -ldflags "-s -w -H=windowsgui" -o dist/relay.exe ./relay

Write-Host "Building relay (linux/amd64, VPS mode)..."
$env:GOOS = "linux"; $env:GOARCH = "amd64"
try {
    go build -ldflags "-s -w" -o dist/relay ./relay
} finally {
    Remove-Item Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
}

Write-Host "Done -> dist/agent.exe, dist/relay.exe (on-device), dist/relay (VPS)"
