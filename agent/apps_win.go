//go:build windows

package main

import (
	"encoding/json"
	"os/exec"
	"strings"
)

// appListJSON lists user-facing (windowed) apps as [{name,pid,title}] — not every
// background process, just what you'd switch between.
func appListJSON() string {
	script := "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,Id,MainWindowTitle | ConvertTo-Json -Compress"
	out, _ := noWin(exec.Command("powershell", "-NoProfile", "-Command", script)).Output()
	s := strings.TrimSpace(string(out))
	if s == "" {
		return "[]"
	}
	if strings.HasPrefix(s, "{") { // PowerShell emits a bare object for a single match
		s = "[" + s + "]"
	}
	var raw []struct {
		ProcessName     string
		Id              int
		MainWindowTitle string
	}
	if json.Unmarshal([]byte(s), &raw) != nil {
		return "[]"
	}
	type app struct {
		Name  string `json:"name"`
		Pid   int    `json:"pid"`
		Title string `json:"title"`
	}
	out2 := make([]app, 0, len(raw))
	for _, r := range raw {
		out2 = append(out2, app{Name: r.ProcessName, Pid: r.Id, Title: r.MainWindowTitle})
	}
	b, _ := json.Marshal(out2)
	return string(b)
}

// launchApp starts an app by name or path (Start-Process resolves PATH + registered apps).
func launchApp(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "usage: app name (e.g. notepad, chrome, spotify)"
	}
	if strings.HasPrefix(name, "http://") || strings.HasPrefix(name, "https://") {
		// open a URL in the default browser — Start-Process -FilePath treats a URL as a file and fails
		noWin(exec.Command("rundll32", "url.dll,FileProtocolHandler", name)).Start()
		return "🌐 opened " + name
	}
	esc := strings.ReplaceAll(name, "'", "''")
	script := "try { Start-Process -FilePath '" + esc + "' -ErrorAction Stop; '✅ launched " + esc + "' } catch { '❌ not found: " + esc + "' }"
	out, _ := noWin(exec.Command("powershell", "-NoProfile", "-Command", script)).Output()
	return strings.TrimSpace(string(out))
}
