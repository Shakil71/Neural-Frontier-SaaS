//go:build linux

package main

import (
	"context"
	"os/signal"
	"syscall"
)

const defaultConfigPath = "/etc/nf-agent/agent.json"

const machineIDHint = "/etc/machine-id is missing or invalid (run systemd-machine-id-setup)"

// serve runs fn until SIGTERM or SIGINT (systemd stops the unit with SIGTERM).
func serve(fn func(ctx context.Context) int) int {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	return fn(ctx)
}
