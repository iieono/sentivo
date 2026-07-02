package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// sensorTune holds the tunable sensor thresholds — configurable from the app and
// persisted next to the agent so they survive restarts.
type sensorTune struct {
	Motion float64 `json:"motion"` // 0..1 luma diff to trip camera motion (lower = more sensitive)
	Idle   int     `json:"idle"`   // seconds idle before "away/activity"
	Mic    float64 `json:"mic"`    // 0..1 mic peak to trip "audio detected"
}

var (
	tuneMu  sync.Mutex
	tuneCur = sensorTune{Motion: 0.06, Idle: 60, Mic: 0.08} // Idle = quiet seconds before activity re-alerts
)

func getTune() sensorTune {
	tuneMu.Lock()
	defer tuneMu.Unlock()
	return tuneCur
}

func setTune(j string) {
	var t sensorTune
	if json.Unmarshal([]byte(j), &t) != nil {
		return
	}
	cur := getTune()
	if t.Motion <= 0 || t.Motion > 1 {
		t.Motion = cur.Motion
	}
	if t.Idle < 30 {
		t.Idle = cur.Idle
	}
	if t.Mic <= 0 || t.Mic > 1 {
		t.Mic = cur.Mic
	}
	tuneMu.Lock()
	tuneCur = t
	tuneMu.Unlock()
	os.WriteFile(tunePath(), []byte(tuneJSON()), 0o644)
}

func tuneJSON() string {
	b, _ := json.Marshal(getTune())
	return string(b)
}

func tunePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "tune.json"
	}
	return filepath.Join(filepath.Dir(exe), "tune.json")
}

func loadTune() {
	if b, err := os.ReadFile(tunePath()); err == nil {
		var t sensorTune
		if json.Unmarshal(b, &t) == nil && t.Motion > 0 && t.Idle >= 30 && t.Mic > 0 {
			tuneMu.Lock()
			tuneCur = t
			tuneMu.Unlock()
		}
	}
}
