//go:build windows

package main

import (
	"testing"
	"unsafe"
)

func TestCharVK(t *testing.T) {
	cases := map[rune]uint16{'a': 0x41, 'z': 0x5A, 'C': 0x43, '0': 0x30, '9': 0x39, '!': 0}
	for r, want := range cases {
		if got := charVK(r); got != want {
			t.Errorf("charVK(%q) = %#x, want %#x", r, got, want)
		}
	}
}

// SendInput requires cbSize == sizeof(INPUT), which is 40 bytes on 64-bit.
// Both union variants must match or key/mouse injection silently corrupts memory.
func TestInputStructSize(t *testing.T) {
	if got := unsafe.Sizeof(inputMouseT{}); got != 40 {
		t.Fatalf("inputMouseT = %d bytes, want 40", got)
	}
	if got := unsafe.Sizeof(inputKbdT{}); got != 40 {
		t.Fatalf("inputKbdT = %d bytes, want 40", got)
	}
}
