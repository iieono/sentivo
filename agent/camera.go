package main

import (
	"archive/zip"
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"sentivo/proto"
)

const gridN = 32 // downsample size for motion diffing

var errNoCam = errors.New("no camera/ffmpeg — set cam_device and ffmpeg_path in config, and install ffmpeg")

var (
	camMu       sync.Mutex
	camDeviceID string     // cached auto-detected dshow device name
	camCapMu    sync.Mutex // serializes actual webcam captures (dshow device is exclusive)
)

func ffmpegBin() string {
	if ffmpegPath != "" {
		return ffmpegPath
	}
	return "ffmpeg"
}

func agentDir() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	return "."
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// findFFmpeg locates an already-installed ffmpeg. A scheduled-task process often has a minimal
// PATH that misses the user's ffmpeg, so we also probe common install locations (winget, choco,
// C:\ffmpeg). Returns "" if none is found.
func findFFmpeg() string {
	if ffmpegPath != "" {
		return ffmpegPath
	}
	if p := filepath.Join(agentDir(), "ffmpeg.exe"); fileExists(p) {
		return p
	}
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	cands := []string{
		`C:\ffmpeg\bin\ffmpeg.exe`,
		filepath.Join(os.Getenv("ProgramData"), `chocolatey\bin\ffmpeg.exe`),
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Microsoft\WinGet\Links\ffmpeg.exe`),
	}
	for _, p := range cands {
		if fileExists(p) {
			return p
		}
	}
	// winget installs land under a versioned package dir
	if home := os.Getenv("USERPROFILE"); home != "" {
		if m, _ := filepath.Glob(filepath.Join(home, `AppData\Local\Microsoft\WinGet\Packages\*FFmpeg*\*\bin\ffmpeg.exe`)); len(m) > 0 {
			return m[0]
		}
	}
	// live user/system PATH from the registry — a logon-task process often captured a minimal
	// PATH that misses an ffmpeg installed later (or via a manager that only edits the registry).
	expand := strings.NewReplacer(
		"%SystemRoot%", os.Getenv("SystemRoot"), "%ProgramFiles%", os.Getenv("ProgramFiles"),
		"%LOCALAPPDATA%", os.Getenv("LOCALAPPDATA"), "%USERPROFILE%", os.Getenv("USERPROFILE"),
		"%ProgramData%", os.Getenv("ProgramData"),
	)
	for _, key := range []string{`HKCU\Environment`, `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`} {
		out, _ := noWin(exec.Command("reg", "query", key, "/v", "Path")).Output()
		s := string(out)
		i := strings.Index(s, "REG_")
		if i < 0 {
			continue
		}
		sp := strings.IndexAny(s[i:], " \t")
		if sp < 0 {
			continue
		}
		for _, dir := range strings.Split(strings.TrimSpace(s[i+sp:]), ";") {
			dir = expand.Replace(strings.TrimSpace(dir))
			if dir != "" {
				if p := filepath.Join(dir, "ffmpeg.exe"); fileExists(p) {
					return p
				}
			}
		}
	}
	return ""
}

// ffmpegReady reports whether ffmpeg is available without downloading; caches the path it finds.
func ffmpegReady() bool {
	if p := findFFmpeg(); p != "" {
		ffmpegPath = p
		return true
	}
	return false
}

// ensureFFmpeg downloads a static ffmpeg build next to the agent if none exists.
func ensureFFmpeg() error {
	if ffmpegReady() { // resolves + caches an existing install (PATH or common locations)
		return nil
	}
	local := filepath.Join(agentDir(), "ffmpeg.exe")
	resp, err := http.Get("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	tmp, err := os.CreateTemp("", "ffmpeg-*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		return err
	}
	tmp.Close()
	zr, err := zip.OpenReader(tmp.Name())
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if !strings.HasSuffix(strings.ToLower(f.Name), "bin/ffmpeg.exe") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(local)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
		ffmpegPath = local
		return nil
	}
	return errors.New("ffmpeg.exe not found in downloaded archive")
}

var videoLine = regexp.MustCompile(`"([^"]+)"`)

// camDeviceName returns the dshow video device — configured, else the first one
// ffmpeg reports. Empty means none/ffmpeg missing.
func camDeviceName() string {
	if camDevice != "" {
		return camDevice
	}
	camMu.Lock()
	defer camMu.Unlock()
	if camDeviceID != "" {
		return camDeviceID
	}
	// ffmpeg exits non-zero after listing (opening "dummy" fails) — output is on stderr.
	out, _ := noWin(exec.Command(ffmpegBin(), "-hide_banner", "-list_devices", "true",
		"-f", "dshow", "-i", "dummy")).CombinedOutput()
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "(video)") {
			if m := videoLine.FindStringSubmatch(line); m != nil {
				camDeviceID = m[1]
				return camDeviceID
			}
		}
	}
	return ""
}

var micDeviceID string
var maxVolRe = regexp.MustCompile(`max_volume:\s*(-?[\d.]+) dB`)

// micDeviceName returns the first dshow audio (microphone) device ffmpeg reports.
func micDeviceName() string {
	camMu.Lock()
	defer camMu.Unlock()
	if micDeviceID != "" {
		return micDeviceID
	}
	out, _ := noWin(exec.Command(ffmpegBin(), "-hide_banner", "-list_devices", "true",
		"-f", "dshow", "-i", "dummy")).CombinedOutput()
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "(audio)") {
			if m := videoLine.FindStringSubmatch(line); m != nil {
				micDeviceID = m[1]
				return micDeviceID
			}
		}
	}
	return ""
}

// micLevelFFmpeg captures ~1s from the mic and returns a 0..1 level. Fallback for systems
// where the Core Audio peak meter reads 0 (no active capture session).
func micLevelFFmpeg() float32 {
	if !ffmpegReady() {
		return 0
	}
	dev := micDeviceName()
	if dev == "" {
		return 0
	}
	out, _ := noWin(exec.Command(ffmpegBin(), "-hide_banner", "-f", "dshow", "-i", "audio="+dev,
		"-t", "1", "-af", "volumedetect", "-f", "null", "-")).CombinedOutput()
	m := maxVolRe.FindStringSubmatch(string(out))
	if m == nil {
		return 0
	}
	db, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0
	}
	lvl := (db + 60) / 60 // map -60..0 dB → 0..1
	if lvl < 0 {
		lvl = 0
	} else if lvl > 1 {
		lvl = 1
	}
	return float32(lvl)
}

// snapCam grabs one JPEG frame from the webcam via ffmpeg (auto-installing it once).
func snapCam() ([]byte, error) {
	ensureFFmpeg()
	dev := camDeviceName()
	if dev == "" {
		return nil, errNoCam
	}
	camCapMu.Lock() // motion watcher, tamper snapshot and the photo command share one exclusive webcam
	defer camCapMu.Unlock()
	var out bytes.Buffer
	cmd := noWin(exec.Command(ffmpegBin(), "-hide_banner", "-loglevel", "error",
		"-f", "dshow", "-i", "video="+dev, "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", "pipe:1"))
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil || out.Len() == 0 {
		return nil, errNoCam
	}
	return out.Bytes(), nil
}

// watchCamera trips on motion while armed + camOn: grab a frame, diff its luma
// grid against the previous one, alert with the frame on a big enough change.
// Note: spawns ffmpeg per grab (simple); switch to a persistent pipe if you
// need a faster cadence than a few seconds.
func watchCamera(send func(proto.Msg)) {
	var prev []float64
	fired := false
	for {
		time.Sleep(3 * time.Second)
		if !camOn.Load() || !armed.Load() {
			prev, fired = nil, false
			continue
		}
		data, err := snapCam()
		if err != nil {
			continue
		}
		img, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil {
			continue
		}
		g := lumaGrid(img)
		if prev != nil && gridDiff(prev, g) >= getTune().Motion {
			if !fired {
				fired = true
				send(proto.Msg{Kind: "event", Text: "📷 camera motion", Data: data})
			}
		} else {
			fired = false
		}
		prev = g
	}
}

func lumaGrid(img image.Image) []float64 {
	b := img.Bounds()
	g := make([]float64, gridN*gridN)
	for gy := 0; gy < gridN; gy++ {
		for gx := 0; gx < gridN; gx++ {
			x := b.Min.X + gx*b.Dx()/gridN
			y := b.Min.Y + gy*b.Dy()/gridN
			r, gg, bb, _ := img.At(x, y).RGBA()
			g[gy*gridN+gx] = (0.299*float64(r) + 0.587*float64(gg) + 0.114*float64(bb)) / 65535
		}
	}
	return g
}

func gridDiff(a, b []float64) float64 {
	if len(a) != len(b) {
		return 1
	}
	var s float64
	for i := range a {
		s += math.Abs(a[i] - b[i])
	}
	return s / float64(len(a))
}
