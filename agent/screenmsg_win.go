//go:build windows

package main

import (
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

var pMessageBox = user32.NewProc("MessageBoxW") // user32 is declared in win.go

func messageBox(title, text string) {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	// MB_ICONWARNING | MB_SYSTEMMODAL | MB_SETFOREGROUND | MB_TOPMOST
	pMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x30|0x1000|0x10000|0x40000)
}

// screenMsg flashes a message on the laptop's screen (anti-theft — a thief sees it).
// msg.exe auto-dismisses after the timeout; falls back to a topmost dialog on editions
// (Home) that lack it. Fire-and-forget so it never blocks the command loop.
func screenMsg(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		text = "This device is monitored by Sentivo."
	}
	go func() {
		if noWin(exec.Command("msg", "*", "/TIME:30", text)).Run() != nil {
			messageBox("Sentivo", text)
		}
	}()
}
