package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Config is stored in /etc/nf-agent/agent.json (root-only, 0600).
type Config struct {
	Server   string `json:"server"`
	ServerID string `json:"serverId"`
	Token    string `json:"token"`
	// Pin is the SHA-256 of the server's TLS certificate (hex), for deployments that use a
	// self-signed certificate. When set, the certificate must match it exactly.
	Pin      string `json:"pin,omitempty"`
	Interval int    `json:"intervalSeconds"`
}

// newHTTPClient trusts the system CAs, or — when pin is set — exactly one certificate.
func newHTTPClient(pin string) *http.Client {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if pin != "" {
		want := strings.ToLower(strings.TrimPrefix(pin, "sha256:"))
		tlsCfg.InsecureSkipVerify = true // replaced by the exact-match check below
		tlsCfg.VerifyPeerCertificate = func(raw [][]byte, _ [][]*x509.Certificate) error {
			if len(raw) == 0 {
				return errors.New("no server certificate")
			}
			sum := sha256.Sum256(raw[0])
			if hex.EncodeToString(sum[:]) != want {
				return errors.New("server certificate does not match the pinned fingerprint")
			}
			return nil
		}
	}
	return &http.Client{
		Timeout:   60 * time.Second,
		Transport: &http.Transport{TLSClientConfig: tlsCfg, Proxy: http.ProxyFromEnvironment},
	}
}

type apiError struct {
	Status int
	Body   string
}

func (e *apiError) Error() string { return fmt.Sprintf("server answered %d: %s", e.Status, e.Body) }

func postJSON(ctx context.Context, c *http.Client, url, token string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nf-agent/"+version)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := c.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return &apiError{Status: res.StatusCode, Body: clip(strings.TrimSpace(string(data)), 400)}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}
