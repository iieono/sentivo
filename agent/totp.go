package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"sync"
	"time"
)

// TOTP (RFC 6238) second factor. The secret lives only on this agent and in your
// authenticator app — never on the relay — so a compromised relay
// cannot forge a gated command. Codes are one-time within their window (replay-proof).

func hotp(key []byte, counter uint64) string {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := (uint32(sum[off]&0x7f) << 24) | (uint32(sum[off+1]) << 16) | (uint32(sum[off+2]) << 8) | uint32(sum[off+3])
	return fmt.Sprintf("%06d", v%1_000_000)
}

func normSecret(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "=", "")
	return strings.ToUpper(s)
}

func totpCandidates(secret string, t time.Time) []string {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(normSecret(secret))
	if err != nil {
		return nil
	}
	step := t.Unix() / 30
	out := make([]string, 0, 3)
	for _, d := range []int64{-1, 0, 1} { // ±1 window tolerates clock skew
		out = append(out, hotp(key, uint64(step+d)))
	}
	return out
}

var (
	usedMu   sync.Mutex
	usedCode = map[string]time.Time{}
)

// verifyCode returns true once for a valid, unused code; false if wrong or replayed.
func verifyCode(secret, code string) bool {
	code = strings.TrimSpace(code)
	if secret == "" || len(code) != 6 {
		return false
	}
	match := false
	for _, c := range totpCandidates(secret, time.Now()) {
		if subtle.ConstantTimeCompare([]byte(c), []byte(code)) == 1 {
			match = true
		}
	}
	if !match {
		return false
	}
	usedMu.Lock()
	defer usedMu.Unlock()
	now := time.Now()
	for k, exp := range usedCode {
		if now.After(exp) {
			delete(usedCode, k)
		}
	}
	if _, seen := usedCode[code]; seen {
		return false // replay within the validity window
	}
	usedCode[code] = now.Add(100 * time.Second)
	return true
}
