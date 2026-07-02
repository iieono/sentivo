//go:build windows

package main

import (
	"errors"
	"net/url"
	"os/exec"
	"path/filepath"

	"github.com/skip2/go-qrcode"
)

// pairingURI builds the sentivo://pair link the phone scans — the relay base URL and
// the device token, derived from the agent's own RELAY_URL. No typing on the phone.
func pairingURI() string {
	u, err := url.Parse(relayURL)
	if err != nil || u.Host == "" {
		return ""
	}
	base := u.Scheme + "://" + u.Host
	tok := u.Query().Get("token")
	return "sentivo://pair?url=" + url.QueryEscape(base) + "&token=" + url.QueryEscape(tok)
}

// showPairQR writes the pairing QR to a PNG and opens it for the phone to scan.
func showPairQR() error {
	uri := pairingURI()
	if uri == "" {
		return errors.New("no relay url to pair from")
	}
	path := filepath.Join(agentDir(), "pair-qr.png")
	if err := qrcode.WriteFile(uri, qrcode.Medium, 512, path); err != nil {
		return err
	}
	return noWin(exec.Command("rundll32", "url.dll,FileProtocolHandler", path)).Start()
}
