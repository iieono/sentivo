//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// noWin runs a child process without flashing a console window — the agent is a
// hidden (windowsgui) process, so an un-suppressed shell-out pops a black box.
func noWin(c *exec.Cmd) *exec.Cmd {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return c
}
