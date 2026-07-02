# Start the Sentivo agent now (e.g. after /disconnect or stop-agent.ps1,
# without waiting for the next sign-in).
try {
    Start-ScheduledTask -TaskName "Sentivo Agent" -ErrorAction Stop
    Write-Host "Sentivo agent started."
} catch {
    Write-Host "Sentivo agent isn't installed — run install-agent.ps1 first."
}
