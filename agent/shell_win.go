//go:build windows

package main

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// runShell executes a command via PowerShell and returns combined output, bounded by a
// timeout and size cap so a hung or noisy command can't wedge the agent or flood the wire.
// Powerful — gate it (TOTP on the agent, biometric in the app).
func runShell(cmdText string) string {
	cmdText = strings.TrimSpace(cmdText)
	if cmdText == "" {
		return "usage: type a command"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c := noWin(exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", cmdText))
	out, _ := c.CombinedOutput()
	s := string(out)
	if ctx.Err() == context.DeadlineExceeded {
		s += "\n[timed out after 30s]"
	}
	const max = 100 << 10 // 100 KB
	if len(s) > max {
		s = s[:max] + "\n[…truncated]"
	}
	if strings.TrimSpace(s) == "" {
		s = "(no output)"
	}
	return s
}
