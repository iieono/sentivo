package main

import (
	"time"

	"github.com/atotto/clipboard"

	"sentivo/proto"
)

// watchClipboard pushes each new clipboard text to the app while clip sync is on.
func watchClipboard(send func(proto.Msg)) {
	last := ""
	for {
		time.Sleep(1500 * time.Millisecond)
		if !clipOn.Load() {
			last = ""
			continue
		}
		s, err := clipboard.ReadAll()
		if err != nil || s == "" || s == last {
			continue
		}
		last = s
		if len(s) > 3800 {
			s = s[:3800] + "..."
		}
		send(proto.Msg{Kind: "event", Action: "clip", Text: s}) // tagged so the app routes it to the clipboard feed
	}
}

// clipText returns the raw clipboard text ("" if empty/unavailable).
func clipText() string {
	s, err := clipboard.ReadAll()
	if err != nil {
		return ""
	}
	return s
}

func clipWrite(s string) string {
	if s == "" {
		return "usage:  /setclip <text>"
	}
	if clipboard.WriteAll(s) != nil {
		return "setclip failed"
	}
	return "📋 laptop clipboard set"
}
