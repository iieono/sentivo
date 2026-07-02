package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"sentivo/proto"
)

// A rule fires an action when an event happens: "on unplugged, do alarm".
// Persisted next to the agent so automations survive restarts and run autonomously.
type rule struct {
	On      string `json:"on"`      // event type, e.g. "unplugged", "usb", "activity"
	Do      string `json:"do"`      // action, e.g. "alarm", "photo", "lock", "screenshot"
	Enabled bool   `json:"enabled"`
}

var (
	rulesMu sync.Mutex
	rules   []rule
)

func rulesPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "rules.json"
	}
	return filepath.Join(filepath.Dir(exe), "rules.json")
}

func loadRules() {
	if b, err := os.ReadFile(rulesPath()); err == nil {
		rulesMu.Lock()
		json.Unmarshal(b, &rules)
		rulesMu.Unlock()
	}
}

func setRules(j string) {
	var r []rule
	if json.Unmarshal([]byte(j), &r) != nil {
		return
	}
	rulesMu.Lock()
	rules = r
	rulesMu.Unlock()
	os.WriteFile(rulesPath(), []byte(j), 0o644)
}

func rulesJSON() string {
	rulesMu.Lock()
	defer rulesMu.Unlock()
	if rules == nil {
		return "[]"
	}
	b, _ := json.Marshal(rules)
	return string(b)
}

// runRules fires the action of every enabled rule matching an event type.
func runRules(ev string) {
	rulesMu.Lock()
	var todo []string
	for _, r := range rules {
		if r.Enabled && r.On == ev {
			todo = append(todo, r.Do)
		}
	}
	rulesMu.Unlock()
	for _, act := range todo {
		doAction(act)
	}
}

// doAction replays an action as a command (pre-authorized when the rule was created).
func doAction(act string) {
	act = strings.TrimSpace(act)
	globalSendMu.Lock()
	f := globalSend
	globalSendMu.Unlock()
	if act == "" || f == nil {
		return
	}
	handle(proto.Msg{Kind: "cmd", Action: act}, f)
}
