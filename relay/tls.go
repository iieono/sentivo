package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"log"
	"math/big"
	"net/http"
	"os"
	"time"
)

// serveTLS serves with a self-signed cert (generated once, then reused) and
// logs its SHA-256 fingerprint. Put that fingerprint in the agent's RELAY_FP —
// the agent pins it, so no CA, domain, or reverse proxy is needed and a MITM
// can't present a different cert.
func serveTLS(addr string, h http.Handler) error {
	cert := loadOrGenCert()
	sum := sha256.Sum256(cert.Certificate[0])
	fp := hex.EncodeToString(sum[:])
	log.Printf("TLS fingerprint (set agent RELAY_FP to this): %s", fp)
	os.WriteFile("fingerprint.txt", []byte(fp), 0600) // installers read this
	srv := &http.Server{
		Addr:      addr,
		Handler:   h,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}
	return srv.ListenAndServeTLS("", "")
}

func loadOrGenCert() tls.Certificate {
	if c, err := tls.LoadX509KeyPair("cert.pem", "key.pem"); err == nil {
		return c
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "control-relay"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(10, 0, 0),
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		log.Fatal(err)
	}
	writePEM("cert.pem", "CERTIFICATE", der)
	kb, _ := x509.MarshalECPrivateKey(key)
	writePEM("key.pem", "EC PRIVATE KEY", kb)

	c, err := tls.LoadX509KeyPair("cert.pem", "key.pem")
	if err != nil {
		log.Fatal(err)
	}
	return c
}

func writePEM(path, typ string, der []byte) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) // key.pem must not be world-readable
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	pem.Encode(f, &pem.Block{Type: typ, Bytes: der})
}
