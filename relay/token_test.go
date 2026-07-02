package main

import "testing"

func reset() {
	accMu.Lock()
	byToken = map[string]*account{}
	accMu.Unlock()
	vtokMu.Lock()
	vtoks = map[string]vtok{}
	vtokMu.Unlock()
}

func TestBootstrapAccount(t *testing.T) {
	reset()
	a := bootstrapAccount("tok1")
	if a == nil || accountByToken("tok1") != a {
		t.Fatal("bootstrap should create and resolve the account")
	}
	if bootstrapAccount("tok1") != a {
		t.Fatal("bootstrapping the same token should return the same account")
	}
	if accountByToken("nope") != nil {
		t.Fatal("unknown token should resolve to nil")
	}
}

func TestViewerTokenAccountScope(t *testing.T) {
	reset()
	a := newAccount("tokV")
	tok := a.mintViewerToken()
	if accountForViewerToken(tok) != a {
		t.Fatal("viewer token should resolve to its account")
	}
	if accountForViewerToken("bogus") != nil {
		t.Fatal("unknown viewer token should be nil")
	}
}
