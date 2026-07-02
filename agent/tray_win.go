//go:build windows

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/atotto/clipboard"

	"fyne.io/systray"

	"sentivo/proto"
)

// icoSphere renders a matte "flat 3D" sphere tinted to the given color — the same
// Sentivo mark as the app icon, so tray and app match. The tint still encodes state
// (emerald armed / slate disarmed) and stays visible on any taskbar.
func icoSphere(base color.RGBA) []byte {
	const n, ss = 32, 4
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	cx, cy := float64(n)/2-0.5, float64(n)/2-0.5
	R := float64(n)/2 - 1.5
	lx, ly, lz := -0.45, -0.5, 0.74
	ll := math.Sqrt(lx*lx + ly*ly + lz*lz)
	lx, ly, lz = lx/ll, ly/ll, lz/ll
	for py := 0; py < n; py++ {
		for px := 0; px < n; px++ {
			var ar, ag, ab, aa float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					fx := float64(px) + (float64(sx)+0.5)/ss
					fy := float64(py) + (float64(sy)+0.5)/ss
					dx, dy := (fx-cx)/R, (fy-cy)/R
					if d2 := dx*dx + dy*dy; d2 <= 1 {
						z := math.Sqrt(1 - d2)
						diff := dx*lx + dy*ly + z*lz
						if diff < 0 {
							diff = 0
						}
						sh := 0.45 + 0.75*math.Pow(diff, 0.8) // dark base -> lit toward the color
						ar += clamp01(float64(base.R) / 255 * sh)
						ag += clamp01(float64(base.G) / 255 * sh)
						ab += clamp01(float64(base.B) / 255 * sh)
						aa++
					}
				}
			}
			if aa > 0 {
				k := float64(ss * ss)
				img.SetRGBA(px, py, color.RGBA{
					uint8(ar / aa * 255), uint8(ag / aa * 255), uint8(ab / aa * 255), uint8(aa / k * 255),
				})
			}
		}
	}
	return icoWrap(img)
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// icoWrap encodes a 32x32 image as a single-image PNG-payload .ico.
func icoWrap(img *image.RGBA) []byte {
	const n = 32
	var pb bytes.Buffer
	png.Encode(&pb, img)
	p := pb.Bytes()
	var ico bytes.Buffer
	binary.Write(&ico, binary.LittleEndian, uint16(0)) // reserved
	binary.Write(&ico, binary.LittleEndian, uint16(1)) // type: icon
	binary.Write(&ico, binary.LittleEndian, uint16(1)) // count
	ico.WriteByte(n)                                    // width
	ico.WriteByte(n)                                    // height
	ico.WriteByte(0)                                    // palette
	ico.WriteByte(0)                                    // reserved
	binary.Write(&ico, binary.LittleEndian, uint16(1))  // planes
	binary.Write(&ico, binary.LittleEndian, uint16(32)) // bpp
	binary.Write(&ico, binary.LittleEndian, uint32(len(p)))
	binary.Write(&ico, binary.LittleEndian, uint32(22)) // data offset (6+16)
	ico.Write(p)
	return ico.Bytes()
}

var (
	iconIdle  = icoSphere(color.RGBA{100, 116, 139, 255}) // slate: disarmed
	iconArmed = icoSphere(color.RGBA{16, 185, 129, 255})  // emerald: armed
)

// runTray shows the "visible mode" tray icon + menu (Windows). It reflects live
// state (armed/sensors) via the icon and tooltip. Blocks on the calling thread.
func runTray() {
	systray.Run(trayReady, func() {})
}

func trayReady() {
	systray.SetIcon(iconIdle)
	systray.SetTitle("Sentivo")
	systray.SetTooltip("Sentivo")

	// --- Sentivo status (display only) ---
	mHost := systray.AddMenuItem("Sentivo", "")
	mHost.Disable()
	mConn := systray.AddMenuItem("...", "Relay connection")
	mConn.Disable()
	mFeat := systray.AddMenuItem("...", "What's enabled")
	mFeat.Disable()
	systray.AddSeparator()

	// --- Sentivo settings (the tray is for settings; the phone controls the PC) ---
	mArm := systray.AddMenuItem("Arm", "Arm / disarm nearby-mode alerts")
	mMic := systray.AddMenuItem("Enable mic", "Audio detection")
	mCam := systray.AddMenuItem("Enable camera", "Camera motion detection")
	mClip := systray.AddMenuItem("Enable clipboard", "Copied text goes to the app")
	systray.AddSeparator()

	mPair := systray.AddMenuItem("📲 Pair a phone", "Show a QR to pair the app")
	mTest := systray.AddMenuItem("🔔 Send test alert to phone", "Verify notifications reach your phone")
	systray.AddSeparator()

	mRecent := systray.AddMenuItem("📨 Messages", "Texts you sent — click to copy or open")
	mMsg := make([]*systray.MenuItem, 8)
	for i := range mMsg {
		mMsg[i] = mRecent.AddSubMenuItem("", "")
		mMsg[i].Hide()
	}
	systray.AddSeparator()

	mQuit := systray.AddMenuItem("Quit", "Stop the agent")

	host, _ := os.Hostname()
	mHost.SetTitle("🖥  " + host)

	refresh := func() {
		a := armed.Load()
		if a {
			systray.SetIcon(iconArmed)
		} else {
			systray.SetIcon(iconIdle)
		}
		systray.SetTooltip("Sentivo — " + onOff(a, "Armed", "Disarmed"))
		mConn.SetTitle(onOff(connected.Load(), "🟢 Connected", "🔴 Reconnecting"))
		mFeat.SetTitle(fmt.Sprintf("%s · 🎤 %s · 📷 %s · 📋 %s",
			onOff(a, "🛡 armed", "😴 off"),
			onOff(micOn.Load(), "on", "off"),
			onOff(camOn.Load(), "on", "off"),
			onOff(clipOn.Load(), "on", "off")))
		mArm.SetTitle(onOff(a, "Disarm", "Arm"))
		mMic.SetTitle(onOff(micOn.Load(), "Disable mic", "Enable mic"))
		mCam.SetTitle(onOff(camOn.Load(), "Disable camera", "Enable camera"))
		mClip.SetTitle(onOff(clipOn.Load(), "Disable clipboard", "Enable clipboard"))
		msgs := recentChat()
		for i := range mMsg {
			if i < len(msgs) {
				t := msgs[i]
				if r := []rune(t); len(r) > 42 {
					t = string(r[:42]) + "..."
				}
				mMsg[i].SetTitle(t)
				mMsg[i].Show()
			} else {
				mMsg[i].Hide()
			}
		}
	}

	// fan the 8 message slots' clicks into one channel
	msgClick := make(chan int, len(mMsg))
	for i := range mMsg {
		i := i
		go func() {
			for range mMsg[i].ClickedCh {
				msgClick <- i
			}
		}()
	}
	openOrCopy := func(i int) {
		msgs := recentChat()
		if i >= len(msgs) {
			return
		}
		if s := msgs[i]; strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
			noWin(exec.Command("rundll32", "url.dll,FileProtocolHandler", s)).Start() // open link
		} else {
			clipboard.WriteAll(msgs[i]) // copy to clipboard
		}
	}

	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				refresh()
			case <-mArm.ClickedCh:
				armed.Store(!armed.Load())
				refresh()
			case <-mMic.ClickedCh:
				micOn.Store(!micOn.Load())
				refresh()
			case <-mCam.ClickedCh:
				camOn.Store(!camOn.Load())
				refresh()
			case <-mClip.ClickedCh:
				clipOn.Store(!clipOn.Load())
				refresh()
			case <-mPair.ClickedCh:
				go showPairQR()
			case <-mTest.ClickedCh:
				emitEvent(proto.Msg{Kind: "event", Text: "🔔 Sentivo test from your laptop — notifications work"})
			case i := <-msgClick:
				openOrCopy(i)
			case <-mQuit.ClickedCh:
				systray.Quit()
				os.Exit(0)
			}
		}
	}()
	refresh()
}
