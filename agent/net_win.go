//go:build windows

package main

import (
	"os/exec"
	"strings"
)

// netJSON samples network throughput over 700ms and summarizes active connections:
// {down, up (bytes/sec), conns, top:[{addr,n}]}. On-demand only (runs while the app's
// Network screen is open), so no idle cost.
func netJSON() string {
	const script = `
function tot { $r=0;$t=0; Get-NetAdapter -Physical -EA SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $s=Get-NetAdapterStatistics -Name $_.Name -EA SilentlyContinue; if($s){ $r+=$s.ReceivedBytes; $t+=$s.SentBytes } }; @($r,$t) }
$a=tot; Start-Sleep -Milliseconds 700; $b=tot
$est = @(Get-NetTCPConnection -State Established -EA SilentlyContinue)
$top = $est | Group-Object RemoteAddress | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object { [pscustomobject]@{ addr=$_.Name; n=$_.Count } }
[pscustomobject]@{ down=[int](($b[0]-$a[0])/0.7); up=[int](($b[1]-$a[1])/0.7); conns=$est.Count; top=@($top) } | ConvertTo-Json -Compress
`
	out, _ := noWin(exec.Command("powershell", "-NoProfile", "-Command", script)).Output()
	s := strings.TrimSpace(string(out))
	if s == "" {
		return `{"down":0,"up":0,"conns":0,"top":[]}`
	}
	return s
}
