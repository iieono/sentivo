package main

import (
	"strings"
	"testing"
)

func TestParseLocate(t *testing.T) {
	ok := []byte(`{"status":"success","country":"Ctry","regionName":"Reg","city":"Cty","lat":1.5,"lon":2.5,"isp":"MyISP","query":"1.2.3.4"}`)
	s := parseLocate(ok)
	if !strings.Contains(s, "Cty, Reg, Ctry") {
		t.Fatalf("missing place: %q", s)
	}
	if !strings.Contains(s, "1.50000,2.50000") {
		t.Fatalf("missing coords: %q", s)
	}
	if !strings.Contains(s, "1.2.3.4") {
		t.Fatalf("missing ip: %q", s)
	}
	if got := parseLocate([]byte(`{"status":"fail"}`)); got != "locate failed" {
		t.Fatalf("fail status = %q", got)
	}
	if got := parseLocate([]byte(`not json`)); got != "locate failed" {
		t.Fatalf("bad json = %q", got)
	}
}
