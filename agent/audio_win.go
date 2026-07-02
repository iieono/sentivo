//go:build windows

package main

import (
	"runtime"
	"strconv"
	"time"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"

	"sentivo/proto"
)

// watchMic polls the default mic's peak level and alerts while armed + micOn.
// It reads the Core Audio peak meter (no recording/decoding), so it's cheap.
// Note: if peak reads 0 on some systems, the capture endpoint may need an
// active session — fall back to an ffmpeg 1s capture then.
func watchMic(send func(proto.Msg)) {
	for {
		if !micOn.Load() { // idle cheaply — no COM, no locked thread while the sensor is off
			time.Sleep(2 * time.Second)
			continue
		}
		runMicSession(send)
	}
}

// runMicSession holds COM + a locked OS thread only while micOn stays true.
func runMicSession(send func(proto.Msg)) {
	runtime.LockOSThread() // COM is thread-affine
	defer runtime.UnlockOSThread()
	if ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED) != nil {
		return
	}
	defer ole.CoUninitialize()

	meter := newMicMeter()
	if meter == nil {
		time.Sleep(3 * time.Second) // no device/permission; back off before retrying
		return
	}
	defer meter.Release()

	fired := false
	zeros := 0
	var lastFF time.Time
	for micOn.Load() {
		time.Sleep(1 * time.Second)
		if !armed.Load() {
			fired = false
			zeros = 0
			continue
		}
		var peak float32
		if meter.GetPeakValue(&peak) != nil {
			return // meter died; re-acquire next session
		}
		if peak == 0 {
			zeros++
			// meter reads 0 on this system → fall back to a short ffmpeg capture, but THROTTLED:
			// without this it spawns ffmpeg every second on a silent/stuck meter (battery + mic drain).
			if zeros >= 3 && time.Since(lastFF) >= 12*time.Second {
				lastFF = time.Now()
				peak = micLevelFFmpeg()
				zeros = 0
			}
		} else {
			zeros = 0
		}
		if peak >= float32(getTune().Mic) {
			if !fired { // one alert per burst, not per second
				fired = true
				send(proto.Msg{Kind: "event", Text: "🎤 audio detected (peak " + strconv.Itoa(int(peak*100)) + "%)"})
			}
		} else {
			fired = false
		}
	}
}

// setMicMute mutes/unmutes the default microphone via Core Audio (IAudioEndpointVolume).
func setMicMute(mute bool) string {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED) != nil {
		return "mic: COM init failed"
	}
	defer ole.CoUninitialize()

	var de *wca.IMMDeviceEnumerator
	if wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &de) != nil {
		return "mic: no enumerator"
	}
	defer de.Release()
	var dev *wca.IMMDevice
	if de.GetDefaultAudioEndpoint(wca.ECapture, wca.EConsole, &dev) != nil {
		return "mic: no capture device"
	}
	defer dev.Release()
	var vol *wca.IAudioEndpointVolume
	if dev.Activate(wca.IID_IAudioEndpointVolume, wca.CLSCTX_ALL, nil, &vol) != nil {
		return "mic: no volume control"
	}
	defer vol.Release()
	if vol.SetMute(mute, nil) != nil {
		return "mic: couldn't set mute"
	}
	if mute {
		return "🎤 microphone muted"
	}
	return "🎤 microphone unmuted"
}

func newMicMeter() *wca.IAudioMeterInformation {
	var de *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &de); err != nil {
		return nil
	}
	defer de.Release()

	var dev *wca.IMMDevice
	if err := de.GetDefaultAudioEndpoint(wca.ECapture, wca.EConsole, &dev); err != nil {
		return nil
	}
	defer dev.Release()

	var meter *wca.IAudioMeterInformation
	if err := dev.Activate(wca.IID_IAudioMeterInformation, wca.CLSCTX_ALL, nil, &meter); err != nil {
		return nil
	}
	return meter
}
