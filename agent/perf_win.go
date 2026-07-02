//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"strings"
)

// Windows power-mode OVERLAYS (the Settings "Power mode" slider). These sit on top of the
// active power plan and change CPU/GPU performance WITHOUT touching the plan's sleep/display
// timeouts — switching the whole plan (the old approach) reset the user's sleep settings.
var perfOverlays = map[string]string{
	"saver":    "961cc777-2547-4f9d-8174-7d86181b8a7a", // Best power efficiency
	"balanced": "00000000-0000-0000-0000-000000000000", // Recommended (no overlay)
	"high":     "3af9b8d9-7c97-431d-ad78-34a8bfea439f", // Better performance
	"ultimate": "ded574b5-45a0-4f42-8737-46345c09c238", // Best performance
}

func setPerf(mode string) string {
	mode = strings.TrimSpace(mode)
	if mode == "gaming" {
		noWin(exec.Command("powercfg", "/overlaysetactive", perfOverlays["ultimate"])).Run()
		noWin(exec.Command("reg", "add", `HKCU\Software\Microsoft\GameBar`, "/v", "AutoGameModeEnabled", "/t", "REG_DWORD", "/d", "1", "/f")).Run()
		noWin(exec.Command("reg", "add", `HKCU\Software\Microsoft\GameBar`, "/v", "AllowAutoGameMode", "/t", "REG_DWORD", "/d", "1", "/f")).Run()
		return "🎮 gaming mode on — Best Performance + Game Mode (sleep settings untouched)"
	}
	ov, ok := perfOverlays[mode]
	if !ok {
		return "unknown power mode"
	}
	if err := noWin(exec.Command("powercfg", "/overlaysetactive", ov)).Run(); err != nil {
		return "⚡ couldn't switch power mode"
	}
	return "⚡ power mode: " + mode + " (your sleep/plan settings untouched)"
}

// setBrightness sets the internal display brightness (0–100) via WMI. External monitors
// generally don't expose WmiMonitorBrightnessMethods, so this is a no-op there.
func setBrightness(level string) string {
	n, err := strconv.Atoi(strings.TrimSpace(level))
	if err != nil || n < 0 || n > 100 {
		return "brightness must be 0–100" // reject anything non-numeric — this text hits a shell
	}
	ns := strconv.Itoa(n)
	script := "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1," + ns + ")"
	if err := noWin(exec.Command("powershell", "-NoProfile", "-Command", script)).Run(); err != nil {
		return "couldn't set brightness (external monitors often don't support it)"
	}
	return "☀️ brightness " + ns + "%"
}

// focusApp brings a running app's window to the foreground (control one app, not the desktop).
func focusApp(pidStr string) string {
	pidStr = strings.TrimSpace(pidStr)
	if _, err := strconv.Atoi(pidStr); err != nil {
		return "no pid" // must be numeric — this text hits a shell
	}
	script := "$p=Get-Process -Id " + pidStr + " -EA SilentlyContinue; if($p){ (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null; '🪟 focused ' + $p.ProcessName } else { 'not running' }"
	out, _ := noWin(exec.Command("powershell", "-NoProfile", "-Command", script)).Output()
	return strings.TrimSpace(string(out))
}
