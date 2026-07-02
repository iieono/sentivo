# Installs the relay ON THIS DEVICE (no VPS) and autostarts it hidden.
# Use this for "local mode". For "VPS mode" use deploy/setup-relay.sh instead.
#   ./install-relay-local.ps1
param(
    [string]$Addr = ":8443"
)
$ErrorActionPreference = "Stop"

$dir = "$env:LOCALAPPDATA\ControlRelay"
New-Item -ItemType Directory -Force $dir | Out-Null

if (-not (Test-Path "$PSScriptRoot\dist\relay.exe")) {
    Write-Host "Building..."
    & "$PSScriptRoot\build.ps1"
}
Copy-Item "$PSScriptRoot\dist\relay.exe" "$dir\relay.exe" -Force

# random shared secret for the agent socket
$rng = [Security.Cryptography.RNGCryptoServiceProvider]::new()
$bytes = New-Object byte[] 24; $rng.GetBytes($bytes)
$token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''

@{ auth_token = $token; addr = $Addr } |
    ConvertTo-Json | Set-Content "$dir\config.json" -Encoding utf8

$action = New-ScheduledTaskAction -Execute "$dir\relay.exe" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Control Relay" -Action $action `
    -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Control Relay"

# wait for the relay to write its cert fingerprint
$fp = $null
foreach ($i in 1..15) {
    Start-Sleep -Milliseconds 500
    if (Test-Path "$dir\fingerprint.txt") { $fp = (Get-Content "$dir\fingerprint.txt" -Raw).Trim(); break }
}

$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "On-device relay installed to $dir and started."
Write-Host "AUTH_TOKEN: $token"
Write-Host "RELAY_FP  : $fp"
Write-Host ""
Write-Host "Now install the agent pointing at this relay:"
Write-Host "  ./install-agent.ps1 -RelayBase 'wss://127.0.0.1:8443' -RelayFp '$fp' -Token '$token'"
if ($lan) { Write-Host "  (from another LAN device: -RelayBase 'wss://$lan`:8443' )" }
