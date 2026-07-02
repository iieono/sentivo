//go:build windows

package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var (
	pGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	pGetTickCount64       = kernel32.NewProc("GetTickCount64")
	pGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	pGetDiskFreeSpaceEx   = kernel32.NewProc("GetDiskFreeSpaceExW")
)

// gpuPct is sampled by a background goroutine (typeperf/Get-Counter is slow), and only
// while the app is actively viewing stats (lastStatReq) — resource discipline.
var (
	gpuPct      atomic.Int32
	cpuTemp     atomic.Int32
	gpuTemp     atomic.Int32
	lastStatReq atomic.Int64
)

type diskEntry struct {
	Drive string  `json:"drive"`
	Used  float64 `json:"used"`
	Total float64 `json:"total"`
	Pct   int     `json:"pct"`
}

type wifiStat struct {
	SSID      string `json:"ssid"`
	Signal    int    `json:"signal"`
	Connected bool   `json:"connected"`
}

// allDisks returns every fixed drive with usage.
func allDisks() []diskEntry {
	var out []diskEntry
	mask, _, _ := pGetLogicalDrives.Call()
	const gb = 1 << 30
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		lp, err := syscall.UTF16PtrFromString(string(rune('A'+i)) + `:\`)
		if err != nil {
			continue
		}
		if dt, _, _ := pGetDriveType.Call(uintptr(unsafe.Pointer(lp))); dt != 3 { // DRIVE_FIXED
			continue
		}
		var freeAvail, total, totalFree uint64
		pGetDiskFreeSpaceEx.Call(uintptr(unsafe.Pointer(lp)),
			uintptr(unsafe.Pointer(&freeAvail)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
		if total == 0 {
			continue
		}
		used, tot := float64(total-totalFree)/gb, float64(total)/gb
		out = append(out, diskEntry{Drive: string(rune('A'+i)) + ":", Used: used, Total: tot, Pct: int(used / tot * 100)})
	}
	return out
}

// wifiInfo parses the active wireless interface (best-effort, via netsh).
func wifiInfo() wifiStat {
	var w wifiStat
	out, err := noWin(exec.Command("netsh", "wlan", "show", "interfaces")).Output()
	if err != nil {
		return w
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		low := strings.ToLower(line)
		i := strings.Index(line, ":")
		if i < 0 {
			continue
		}
		val := strings.TrimSpace(line[i+1:])
		switch {
		case strings.HasPrefix(low, "ssid") && !strings.HasPrefix(low, "bssid"):
			w.SSID = val
		case strings.HasPrefix(low, "signal"):
			w.Signal, _ = strconv.Atoi(strings.TrimSuffix(val, "%"))
		case strings.HasPrefix(low, "state"):
			w.Connected = strings.Contains(low, "connected") && !strings.Contains(low, "disconnected")
		}
	}
	return w
}

// startGPUSampler polls GPU utilization in the background while stats are being viewed.
func startGPUSampler() {
	gpuPct.Store(-1)
	cpuTemp.Store(-1)
	gpuTemp.Store(-1)
	go func() {
		// GPU util + best-effort CPU temp (ACPI thermal zone) + GPU temp (nvidia-smi), one call.
		const script = `$g=(Get-Counter '\GPU Engine(*)\Utilization Percentage' -EA SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum
$gpu=[int][math]::Min(100,[math]::Round($g.Sum))
$ct=-1; try { $t=(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -EA Stop | Select-Object -First 1).CurrentTemperature; if($t){$ct=[int](($t/10)-273.15)} } catch {}
$gt=-1; try { $v=nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1; if($v){$gt=[int]$v} } catch {}
[pscustomobject]@{gpu=$gpu;ct=$ct;gt=$gt}|ConvertTo-Json -Compress`
		for {
			if time.Now().Unix()-lastStatReq.Load() > 15 { // nobody watching -> back off
				time.Sleep(6 * time.Second)
				continue
			}
			if out, err := noWin(exec.Command("powershell", "-NoProfile", "-Command", script)).Output(); err == nil {
				var r struct{ Gpu, Ct, Gt int }
				if json.Unmarshal([]byte(strings.TrimSpace(string(out))), &r) == nil {
					gpuPct.Store(int32(r.Gpu))
					cpuTemp.Store(int32(r.Ct))
					gpuTemp.Store(int32(r.Gt))
				}
			}
			time.Sleep(4 * time.Second)
		}
	}()
}

type memoryStatusEx struct {
	length     uint32
	memoryLoad uint32
	totalPhys  uint64
	availPhys  uint64
	totalPage  uint64
	availPage  uint64
	totalVirt  uint64
	availVirt  uint64
	availExt   uint64
}

func memInfo() (usedGB, totalGB float64, pct int) {
	m := memoryStatusEx{}
	m.length = uint32(unsafe.Sizeof(m))
	pGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	const gb = 1 << 30
	return float64(m.totalPhys-m.availPhys) / gb, float64(m.totalPhys) / gb, int(m.memoryLoad)
}

func uptime() time.Duration {
	r, _, _ := pGetTickCount64.Call()
	return time.Duration(r) * time.Millisecond
}

func systemTimes() (idle, kernel, user uint64) {
	pGetSystemTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
	return
}

// cpuPercent samples system times over 200ms. Kernel time includes idle.
func cpuPercent() int {
	i0, k0, u0 := systemTimes()
	time.Sleep(200 * time.Millisecond)
	i1, k1, u1 := systemTimes()
	total := (k1 - k0) + (u1 - u0)
	if total == 0 {
		return 0
	}
	return int(100 * (total - (i1 - i0)) / total)
}

func diskInfo() (usedGB, totalGB float64) {
	var freeAvail, total, totalFree uint64
	p, err := syscall.UTF16PtrFromString(`C:\`)
	if err != nil {
		return 0, 0
	}
	pGetDiskFreeSpaceEx.Call(uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&freeAvail)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
	const gb = 1 << 30
	return float64(total-totalFree) / gb, float64(total) / gb
}

// processList returns the top RAM consumers via tasklist.
func processList() string {
	out, err := noWin(exec.Command("tasklist", "/fo", "csv", "/nh")).Output()
	if err != nil {
		return "process list failed"
	}
	type proc struct {
		name  string
		pid   int
		memKB int
	}
	var ps []proc
	r := csv.NewReader(bytes.NewReader(out))
	r.FieldsPerRecord = -1
	for {
		rec, err := r.Read()
		if err != nil || len(rec) < 5 {
			if err != nil {
				break
			}
			continue
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(rec[1]))
		mem, _ := strconv.Atoi(strings.NewReplacer(",", "", "K", "", " ", "").Replace(rec[4]))
		ps = append(ps, proc{rec[0], pid, mem})
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].memKB > ps[j].memKB })
	var b strings.Builder
	b.WriteString("🧩 Top processes by RAM\n\n")
	for i, p := range ps {
		if i >= 12 {
			break
		}
		b.WriteString(fmt.Sprintf("`%6d` · %5d MB · %s\n", p.pid, p.memKB/1024, p.name))
	}
	b.WriteString("\nEnd one:  /kill <pid> <2FA-code>")
	return b.String()
}

// statJSON returns live device stats as JSON — the app renders it as gauges/charts.
func statJSON() string {
	lastStatReq.Store(time.Now().Unix()) // tells the GPU sampler someone's watching
	ru, rt, rp := memInfo()
	du, dt := diskInfo()
	diskPct := 0
	if dt > 0 {
		diskPct = int(du / dt * 100)
	}
	ac, batt, powerOK := getPowerStatus()
	s := struct {
		Host     string  `json:"host"`
		CPU      int     `json:"cpu"`
		RAMUsed  float64 `json:"ramUsed"`
		RAMTot   float64 `json:"ramTotal"`
		RAMPct   int     `json:"ramPct"`
		DiskUsed float64 `json:"diskUsed"`
		DiskTot  float64 `json:"diskTotal"`
		DiskPct  int     `json:"diskPct"`
		Uptime   int64   `json:"uptime"`
		Battery  int     `json:"battery"`
		Charging bool    `json:"charging"`
		Locked   bool    `json:"locked"`
		Armed    bool    `json:"armed"`
		Mic      bool    `json:"mic"`
		Cam      bool    `json:"cam"`
		Clip     bool    `json:"clip"`
		Notify   bool        `json:"notify"`
		Visible  bool        `json:"visible"`
		GPU      int         `json:"gpu"`
		CPUTemp  int         `json:"cpuTemp"`
		GPUTemp  int         `json:"gpuTemp"`
		Fps      int         `json:"fps"`
		Quality  int         `json:"quality"`
		Disks    []diskEntry `json:"disks"`
		Wifi     wifiStat    `json:"wifi"`
	}{CPU: cpuPercent(), RAMUsed: ru, RAMTot: rt, RAMPct: rp,
		DiskUsed: du, DiskTot: dt, DiskPct: diskPct,
		Uptime: int64(uptime().Seconds()), Battery: -1, Charging: ac == 1, Locked: isLocked(),
		Armed: armed.Load(), Mic: micOn.Load(), Cam: camOn.Load(), Clip: clipOn.Load(),
		Notify: notifyOn.Load(), Visible: visibleMode,
		GPU: int(gpuPct.Load()), CPUTemp: int(cpuTemp.Load()), GPUTemp: int(gpuTemp.Load()),
		Fps: int(streamFPS.Load()), Quality: int(streamQuality.Load()), Disks: allDisks(), Wifi: wifiInfo()}
	s.Host, _ = os.Hostname()
	if powerOK && batt <= 100 {
		s.Battery = int(batt)
	}
	b, _ := json.Marshal(s)
	return string(b)
}

// processListJSON returns the top RAM consumers as JSON [{name,pid,mem}] (mem in MB) —
// the app renders this as a live bar chart with kill buttons.
func processListJSON() string {
	out, err := noWin(exec.Command("tasklist", "/fo", "csv", "/nh")).Output()
	if err != nil {
		return "[]"
	}
	type proc struct {
		Name string `json:"name"`
		PID  int    `json:"pid"`
		Mem  int    `json:"mem"`
	}
	var ps []proc
	r := csv.NewReader(bytes.NewReader(out))
	r.FieldsPerRecord = -1
	for {
		rec, err := r.Read()
		if err != nil {
			break
		}
		if len(rec) < 5 {
			continue
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(rec[1]))
		memKB, _ := strconv.Atoi(strings.NewReplacer(",", "", "K", "", " ", "").Replace(rec[4]))
		ps = append(ps, proc{rec[0], pid, memKB / 1024})
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].Mem > ps[j].Mem })
	if len(ps) > 20 {
		ps = ps[:20]
	}
	b, _ := json.Marshal(ps)
	return string(b)
}

func killPID(pidStr string) string {
	pidStr = strings.TrimSpace(pidStr)
	if _, err := strconv.Atoi(pidStr); err != nil {
		return "usage:  /kill <pid> <2FA-code>"
	}
	out, err := noWin(exec.Command("taskkill", "/F", "/PID", pidStr)).CombinedOutput()
	if err != nil {
		return "kill failed: " + strings.TrimSpace(string(out))
	}
	return "☠️ killed PID " + pidStr
}
