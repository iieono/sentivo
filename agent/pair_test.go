//go:build windows

package main

import "testing"

func TestPairingURI(t *testing.T) {
	relayURL = "wss://sentivo.relayt.uz/agent?token=abc123"
	got := pairingURI()
	want := "sentivo://pair?url=wss%3A%2F%2Fsentivo.relayt.uz&token=abc123"
	if got != want {
		t.Fatalf("pairingURI() = %q, want %q", got, want)
	}
}
