package main

import (
	"testing"
	"time"
)

// RFC 4226 Appendix D test vectors: key "12345678901234567890", counters 0..9.
func TestHOTPVectors(t *testing.T) {
	key := []byte("12345678901234567890")
	want := []string{"755224", "287082", "359152", "969429", "338314",
		"254676", "287922", "162583", "399871", "520489"}
	for i, w := range want {
		if got := hotp(key, uint64(i)); got != w {
			t.Errorf("hotp(%d) = %s, want %s", i, got, w)
		}
	}
}

func TestVerifyAndReplay(t *testing.T) {
	// base32("12345678901234567890") = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	usedMu.Lock()
	usedCode = map[string]time.Time{}
	usedMu.Unlock()

	code := totpCandidates(secret, time.Now())[1] // current window
	if !verifyCode(secret, code) {
		t.Fatal("a valid current code should pass")
	}
	if verifyCode(secret, code) {
		t.Fatal("the same code must not pass twice (replay)")
	}
	if verifyCode(secret, "12345") {
		t.Fatal("a malformed code must fail")
	}
	if verifyCode("", "755224") {
		t.Fatal("no secret configured must fail closed for gated use")
	}
}
