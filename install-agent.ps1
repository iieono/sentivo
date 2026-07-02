# Installs the agent on this laptop and autostarts it (hidden) at logon.
#
# Pass the relay base URL and the token the relay was configured with (AUTH_TOKEN):
#   ./install-agent.ps1 -RelayBase "wss://host:8443" -Token "AUTH_TOKEN"
#
# Self-signed relay (no domain): also pass the pinned fingerprint.
#   ./install-agent.ps1 -RelayBase "wss://host:8443" -RelayFp "FP" -Token "AUTH_TOKEN"
param(
    [Parameter(Mandatory = $true)][string]$RelayBase,
    [string]$RelayFp = "",
    [string]$Token
)
$ErrorActionPreference = "Stop"

# Self-elevate once so the whole install is automatic — opens the LAN firewall port + registers
# autostart without a separate admin shell. Accept the single UAC prompt and everything sets up.
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) {
    $a = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -RelayBase `"$RelayBase`""
    if ($RelayFp) { $a += " -RelayFp `"$RelayFp`"" }
    if ($Token) { $a += " -Token `"$Token`"" }
    Write-Host "Requesting administrator rights to finish setup..."
    Start-Process powershell -Verb RunAs -ArgumentList $a
    exit
}

$rng = [Security.Cryptography.RNGCryptoServiceProvider]::new()
if (-not $Token) {
    $bytes = New-Object byte[] 24; $rng.GetBytes($bytes)
    $Token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}
$relayUrl = "$($RelayBase.TrimEnd('/'))/agent?token=$Token"

# 2FA secret (base32, 160-bit): gated commands need a code from your authenticator.
$sb = New-Object byte[] 32; $rng.GetBytes($sb)
$b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
$totp = -join ($sb | ForEach-Object { $b32[$_ -band 31] })

$dir = "$env:LOCALAPPDATA\Sentivo"
New-Item -ItemType Directory -Force $dir | Out-Null

if (-not (Test-Path "$PSScriptRoot\dist\agent.exe")) {
    Write-Host "Building agent..."
    & "$PSScriptRoot\build.ps1"
}
Copy-Item "$PSScriptRoot\dist\agent.exe" "$dir\agent.exe" -Force

# ASCII => no BOM (Go's JSON parser rejects a BOM).
@{ relay_url = $relayUrl; relay_fp = $RelayFp; totp_secret = $totp } |
    ConvertTo-Json | Set-Content "$dir\config.json" -Encoding ascii

$action = New-ScheduledTaskAction -Execute "$dir\agent.exe"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Sentivo Agent" -Action $action `
    -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Sentivo Agent"

# Allow the same-network direct fast path (port 8766) through Windows Firewall. Needs admin;
# if it can't, the app just falls back to the relay until the port is allowed.
try {
    New-NetFirewallRule -DisplayName "Sentivo LAN" -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort 8766 -Profile Private -ErrorAction Stop | Out-Null
    Write-Host "LAN direct fast path allowed on port 8766 (private network)."
} catch {
    Write-Host "Note: run elevated to open port 8766 for the same-network fast path (else it uses the relay)."
}

$amp = [char]38
Write-Host ""
Write-Host "Installed to $dir and started (autostarts at logon)."
Write-Host "Token: $Token"
Write-Host ""
Write-Host "Pair your phone: open the tray menu -> Pair a phone, and scan the QR in the app."
Write-Host ""
Write-Host "Optional 2FA (TOTP) - set require_totp in config to gate commands, then add this to your authenticator:"
Write-Host ("  otpauth://totp/Sentivo:" + $env:COMPUTERNAME + "?secret=" + $totp + $amp + "issuer=Sentivo")
Write-Host "(The app also confirms sensitive actions with biometrics.)"
