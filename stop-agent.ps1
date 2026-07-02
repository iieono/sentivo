# Manually disconnect the Sentivo agent from THIS laptop.
# It stops now but stays installed, so it auto-starts again at your next sign-in.
# (To bring it back sooner, run start-agent.ps1.)
try {
    Stop-ScheduledTask -TaskName "Sentivo Agent" -ErrorAction Stop
    Write-Host "Sentivo agent stopped. It will start again at next sign-in."
} catch {
    Write-Host "Sentivo agent isn't running (or isn't installed)."
}
