// nf-agent: the Neural Frontier Linux inventory agent.
//
//	nf-agent enroll --server https://host:8643 --key nfe_… [--pin sha256:…]
//	nf-agent run      # report now, then every interval (systemd service)
//	nf-agent once     # print the inventory as JSON and exit (no network)
//	nf-agent version
//
// It only reads system state (/proc, /etc, rpm/dpkg, systemctl). It never changes the host
// and accepts no commands from the server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// version is set at build time: -ldflags "-X main.version=…".
var version = "dev"

const defaultConfigPath = "/etc/nf-agent/agent.json"

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "enroll":
		os.Exit(cmdEnroll(os.Args[2:]))
	case "run":
		os.Exit(cmdRun(os.Args[2:]))
	case "once":
		inv := Collect(context.Background())
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(inv); err != nil {
			log.Fatal(err)
		}
	case "version", "--version", "-v":
		fmt.Println(version)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: nf-agent enroll --server URL --key KEY [--pin sha256:HEX] | run | once | version")
}

func loadConfig(path string) (Config, error) {
	var cfg Config
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	if cfg.Server == "" || cfg.Token == "" {
		return cfg, errors.New("config is incomplete; enroll again")
	}
	if cfg.Interval < 60 {
		cfg.Interval = 300
	}
	return cfg, nil
}

// saveConfig writes atomically with 0600 permissions: the token is a credential.
func saveConfig(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func cmdEnroll(args []string) int {
	fs := flag.NewFlagSet("enroll", flag.ExitOnError)
	server := fs.String("server", "", "Neural Frontier URL, e.g. https://nf.example.com")
	key := fs.String("key", "", "enrollment key from the Admin Center (Servers → Add server)")
	pin := fs.String("pin", "", "sha256:<hex> fingerprint of a self-signed server certificate")
	cfgPath := fs.String("config", defaultConfigPath, "where to store the agent credential")
	_ = fs.Parse(args)
	if *server == "" || *key == "" {
		log.Print("enroll: --server and --key are required")
		return 2
	}
	base := strings.TrimRight(*server, "/")
	if !strings.HasPrefix(base, "https://") {
		log.Print("enroll: the server URL must use https://")
		return 2
	}
	inv := Collect(context.Background())
	if !validMachineID(inv.MachineID) {
		log.Print("enroll: /etc/machine-id is missing or invalid (run systemd-machine-id-setup)")
		return 1
	}
	var res struct {
		ServerID        string `json:"serverId"`
		AgentToken      string `json:"agentToken"`
		IntervalSeconds int    `json:"intervalSeconds"`
	}
	err := postJSON(newHTTPClient(*pin), base+"/api/agent/v1/enroll", "", map[string]string{
		"enrollmentKey": *key, "machineId": inv.MachineID, "hostname": inv.Hostname,
	}, &res)
	if err != nil {
		log.Printf("enroll: %v", err)
		return 1
	}
	cfg := Config{Server: base, ServerID: res.ServerID, Token: res.AgentToken, Pin: *pin, Interval: res.IntervalSeconds}
	if err := saveConfig(*cfgPath, cfg); err != nil {
		log.Printf("enroll: saving %s: %v", *cfgPath, err)
		return 1
	}
	log.Printf("enrolled as server %s; reporting every %ds", res.ServerID, cfg.Interval)
	return 0
}

func cmdRun(args []string) int {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	cfgPath := fs.String("config", defaultConfigPath, "agent credential file")
	_ = fs.Parse(args)
	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		log.Printf("run: %v", err)
		return 1
	}
	client := newHTTPClient(cfg.Pin)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	lastHash := ""
	backoff := time.Duration(0)
	for {
		inv := Collect(ctx)
		if inv.PackagesHash == lastHash {
			inv.Packages = nil // unchanged: the server keeps the previous list
		}
		err := postJSON(client, cfg.Server+"/api/agent/v1/inventory", cfg.Token, inv, nil)
		var apiErr *apiError
		switch {
		case err == nil:
			lastHash = inv.PackagesHash
			backoff = 0
			log.Printf("reported inventory (%d packages, %d services)", inv.PackageCount, len(inv.Services))
		case errors.As(err, &apiErr) && apiErr.Status == 401:
			log.Printf("the server no longer accepts this agent (retired or re-enrolled); stopping")
			return 3
		case errors.As(err, &apiErr) && apiErr.Status == 409:
			lastHash = "" // the server wants the full package list
			log.Printf("server asked for a full report: %v", err)
		default:
			lastHash = ""
			if backoff == 0 {
				backoff = 30 * time.Second
			} else if backoff < 15*time.Minute {
				backoff *= 2
			}
			log.Printf("report failed (retrying in %s): %v", backoff, err)
		}
		wait := time.Duration(cfg.Interval) * time.Second
		if backoff > 0 {
			wait = backoff
		}
		select {
		case <-ctx.Done():
			log.Print("stopping")
			return 0
		case <-time.After(wait):
		}
	}
}
