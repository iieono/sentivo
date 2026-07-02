//go:build windows

package main

import (
	"strconv"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"sentivo/proto"
)

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	pOpenInputDesktop = user32.NewProc("OpenInputDesktop")
	pCloseDesktop     = user32.NewProc("CloseDesktop")
	pMouseEvent       = user32.NewProc("mouse_event")
	pGetLastInputInfo = user32.NewProc("GetLastInputInfo")
	pSendInput        = user32.NewProc("SendInput")
	pGetCursorPos     = user32.NewProc("GetCursorPos")

	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	pGetSystemPowerStatus = kernel32.NewProc("GetSystemPowerStatus")
	pGetTickCount         = kernel32.NewProc("GetTickCount")
	pGetLogicalDrives     = kernel32.NewProc("GetLogicalDrives")
	pGetDriveType         = kernel32.NewProc("GetDriveTypeW")
	pBeep                 = kernel32.NewProc("Beep")
)

var alarmRunning atomic.Bool

// alarm loops a siren through the default audio device until stopAlarm() is called
// (safety-capped at ~2 min so a lost stop can't beep forever). Beep is synchronous, so
// the loop reacts to a stop within one ~800ms cycle.
func alarm() {
	if alarmRunning.Swap(true) {
		return // already sounding
	}
	go func() {
		defer alarmRunning.Store(false)
		deadline := time.Now().Add(2 * time.Minute)
		for alarmRunning.Load() && time.Now().Before(deadline) {
			pBeep.Call(1300, 400) // Hz, ms
			pBeep.Call(900, 400)
		}
	}()
}

func stopAlarm() { alarmRunning.Store(false) }

// driveLetters returns every present drive root ("C:\\", "D:\\", …) via the drive bitmask.
func driveLetters() []string {
	mask, _, _ := pGetLogicalDrives.Call()
	var out []string
	for i := uint(0); i < 26; i++ {
		if mask&(1<<i) != 0 {
			out = append(out, string(rune('A'+i))+":\\")
		}
	}
	return out
}

type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

// idleSeconds is seconds since the last local keyboard/mouse input.
func idleSeconds() uint32 {
	lii := lastInputInfo{cbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	r, _, _ := pGetLastInputInfo.Call(uintptr(unsafe.Pointer(&lii)))
	if r == 0 {
		return 0
	}
	tick, _, _ := pGetTickCount.Call()
	return (uint32(tick) - lii.dwTime) / 1000 // uint32 subtraction handles tick wrap
}

// removableDrives returns the set of mounted removable drives (e.g. USB sticks).
func removableDrives() map[string]bool {
	m := map[string]bool{}
	mask, _, _ := pGetLogicalDrives.Call()
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		root := string(rune('A'+i)) + ":\\"
		p, err := syscall.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		if t, _, _ := pGetDriveType.Call(uintptr(unsafe.Pointer(p))); t == 2 { // DRIVE_REMOVABLE
			m[root] = true
		}
	}
	return m
}

type systemPowerStatus struct {
	ACLineStatus        byte // 0 = on battery, 1 = plugged in, 255 = unknown
	BatteryFlag         byte
	BatteryLifePercent  byte // 0-100, 255 = unknown
	SystemStatusFlag    byte
	BatteryLifeTime     uint32
	BatteryFullLifeTime uint32
}

// getPowerStatus reports AC line status and battery %, ok=false if unknown.
func getPowerStatus() (ac byte, pct byte, ok bool) {
	var s systemPowerStatus
	r, _, _ := pGetSystemPowerStatus.Call(uintptr(unsafe.Pointer(&s)))
	if r == 0 || s.ACLineStatus == 255 {
		return 0, 0, false
	}
	return s.ACLineStatus, s.BatteryLifePercent, true
}

// wakeScreen nudges the mouse to turn the display back on.
func wakeScreen() {
	const mouseeventfMove = 0x0001
	pMouseEvent.Call(mouseeventfMove, 0, 0, 0, 0)
}

// --- remote control via SendInput ---

const (
	inTypeMouse    = 0
	inTypeKeyboard = 1

	mMove       = 0x0001
	mAbsolute   = 0x8000
	mLeftDown   = 0x0002
	mLeftUp     = 0x0004
	mRightDown  = 0x0008
	mRightUp    = 0x0010
	mMiddleDown = 0x0020
	mMiddleUp   = 0x0040
	mWheel      = 0x0800

	kKeyUp   = 0x0002
	kUnicode = 0x0004
)

type mouseInput struct {
	dx, dy      int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type kbdInput struct {
	wVk, wScan  uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
	_           [8]byte // pad KEYBDINPUT to the MOUSEINPUT union size (INPUT = 40B on 64-bit)
}

type inputMouseT struct {
	typ uint32
	_   uint32
	mi  mouseInput
}

type inputKbdT struct {
	typ uint32
	_   uint32
	ki  kbdInput
}

func sendMouse(mi mouseInput) {
	in := inputMouseT{typ: inTypeMouse, mi: mi}
	pSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
}

func sendKbd(ki kbdInput) {
	in := inputKbdT{typ: inTypeKeyboard, ki: ki}
	pSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
}

// absCoord maps a normalized 0..1 position to the primary monitor's 0..65535 space.
func absCoord(v float64) int32 {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	return int32(v * 65535)
}

func mouseFlags(button string, down bool) uint32 {
	switch button {
	case "right":
		if down {
			return mRightDown
		}
		return mRightUp
	case "middle":
		if down {
			return mMiddleDown
		}
		return mMiddleUp
	default:
		if down {
			return mLeftDown
		}
		return mLeftUp
	}
}

// injectInput replays a viewer's remote-control event on the local desktop.
func injectInput(in *proto.Input) {
	switch in.Type {
	case "move":
		sendMouse(mouseInput{dx: absCoord(in.X), dy: absCoord(in.Y), dwFlags: mMove | mAbsolute})
	case "down", "up":
		sendMouse(mouseInput{dx: absCoord(in.X), dy: absCoord(in.Y),
			dwFlags: mMove | mAbsolute | mouseFlags(in.Button, in.Type == "down")})
	case "scroll":
		sendMouse(mouseInput{mouseData: uint32(int32(in.Dy) * 120), dwFlags: mWheel})
	case "rmove": // trackpad: relative cursor move (no absolute flag)
		sendMouse(mouseInput{dx: int32(in.Dx), dy: int32(in.Dy), dwFlags: mMove})
	case "click": // click in place (trackpad tap) — button set via in.Button
		if in.Button == "right" {
			sendMouse(mouseInput{dwFlags: mRightDown})
			sendMouse(mouseInput{dwFlags: mRightUp})
		} else {
			sendMouse(mouseInput{dwFlags: mLeftDown})
			sendMouse(mouseInput{dwFlags: mLeftUp})
		}
	case "key":
		sendKey(in.Key, in.Down)
	}
}

// mods tracks held modifier keys. Updated in-order from the single connection's
// read loop, so no locking needed. resetMods releases them on disconnect.
var mods struct{ ctrl, alt, meta bool }

func sendKey(key string, down bool) {
	switch key {
	case "Control":
		mods.ctrl = down
		keyVK(0x11, down)
		return
	case "Alt":
		mods.alt = down
		keyVK(0x12, down)
		return
	case "Meta":
		mods.meta = down
		keyVK(0x5B, down)
		return
	case "Shift":
		keyVK(0x10, down)
		return
	}
	if r := []rune(key); len(r) == 1 && r[0] >= 0x20 {
		// With Ctrl/Alt/Meta held, use a virtual-key so the combo works (Ctrl+C).
		// Unicode injection ignores modifier state, so it can't do combos.
		if mods.ctrl || mods.alt || mods.meta {
			if vk := charVK(r[0]); vk != 0 {
				keyVK(vk, down)
			}
			return
		}
		if down { // plain printable: type it directly via Unicode (layout-independent)
			sendKbd(kbdInput{wScan: uint16(r[0]), dwFlags: kUnicode})
			sendKbd(kbdInput{wScan: uint16(r[0]), dwFlags: kUnicode | kKeyUp})
		}
		return
	}
	if vk := vkFor(key); vk != 0 {
		keyVK(vk, down)
	}
}

func keyVK(vk uint16, down bool) {
	f := uint32(0)
	if !down {
		f = kKeyUp
	}
	sendKbd(kbdInput{wVk: vk, dwFlags: f})
}

// mediaVK — the multimedia / volume virtual keys; a tap is down+up.
var mediaVK = map[string]uint16{
	"playpause": 0xB3, "next": 0xB0, "prev": 0xB1, "stop": 0xB2,
	"volup": 0xAF, "voldown": 0xAE, "mute": 0xAD,
}

func mediaKey(name string) bool {
	vk, ok := mediaVK[name]
	if !ok {
		return false
	}
	keyVK(vk, true)
	keyVK(vk, false)
	return true
}

// pasteKeystroke fires Ctrl+V to drop the current clipboard at the focused control.
func pasteKeystroke() {
	keyVK(0x11, true)  // Ctrl down
	keyVK(0x56, true)  // V down
	keyVK(0x56, false) // V up
	keyVK(0x11, false) // Ctrl up
}

// charVK maps a printable char to its virtual-key code for modifier combos.
func charVK(r rune) uint16 {
	switch {
	case r >= 'a' && r <= 'z':
		return uint16(r-'a') + 0x41
	case r >= 'A' && r <= 'Z':
		return uint16(r-'A') + 0x41
	case r >= '0' && r <= '9':
		return uint16(r-'0') + 0x30
	}
	return 0 // letters/digits cover Ctrl+C/V/X/Z/A/S etc.; symbols rare
}

// resetMods releases any held modifiers — call on disconnect to avoid a stuck
// Ctrl/Alt on the real desktop if a viewer drops mid-combo.
func resetMods() {
	if mods.ctrl {
		keyVK(0x11, false)
		mods.ctrl = false
	}
	if mods.alt {
		keyVK(0x12, false)
		mods.alt = false
	}
	if mods.meta {
		keyVK(0x5B, false)
		mods.meta = false
	}
}

func vkFor(key string) uint16 {
	if len(key) >= 2 && key[0] == 'F' { // F1..F24 function keys
		if n, err := strconv.Atoi(key[1:]); err == nil && n >= 1 && n <= 24 {
			return uint16(0x70 + n - 1)
		}
	}
	switch key {
	case "Insert":
		return 0x2D
	case "CapsLock":
		return 0x14
	case " ", "Space":
		return 0x20
	case "Enter":
		return 0x0D
	case "Backspace":
		return 0x08
	case "Tab":
		return 0x09
	case "Escape":
		return 0x1B
	case "Delete":
		return 0x2E
	case "ArrowLeft":
		return 0x25
	case "ArrowUp":
		return 0x26
	case "ArrowRight":
		return 0x27
	case "ArrowDown":
		return 0x28
	case "Home":
		return 0x24
	case "End":
		return 0x23
	case "PageUp":
		return 0x21
	case "PageDown":
		return 0x22
	}
	return 0
}

// isLocked reports whether the workstation is locked: when the lock/secure
// desktop is active our process can't open the input desktop.
func isLocked() bool {
	h, _, _ := pOpenInputDesktop.Call(0, 0, 0x0100) // DESKTOP_SWITCHDESKTOP
	if h == 0 {
		return true
	}
	pCloseDesktop.Call(h)
	return false
}
