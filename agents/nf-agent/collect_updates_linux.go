//go:build linux

package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// How often the package manager is asked. Reports in between reuse the last answer: dnf and apt
// read large metadata, and the metadata itself only refreshes every few hours.
const updatesInterval = time.Hour

var (
	updatesMu    sync.Mutex
	updatesCache *Updates
	updatesAt    time.Time
)

// collectUpdates returns the patch state, refreshing it at most once per updatesInterval.
func collectUpdates(ctx context.Context, manager string, pkgs []Package) Updates {
	updatesMu.Lock()
	defer updatesMu.Unlock()
	if updatesCache == nil || time.Since(updatesAt) >= updatesInterval {
		u := checkUpdates(ctx, manager, pkgs)
		updatesCache, updatesAt = &u, time.Now()
	}
	return *updatesCache
}

// runCode runs a read-only command with a timeout and the C locale, returning stdout, a short
// stderr and the exit code (-1 when it couldn't run).
func runCode(ctx context.Context, name string, args ...string) (string, string, int) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", "", -1
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	code := 0
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code = exitErr.ExitCode()
	} else if err != nil {
		code = -1
	}
	return stdout.String(), clip(strings.TrimSpace(stderr.String()), 300), code
}

func mtime(paths ...string) *string {
	for _, p := range paths {
		if st, err := os.Stat(p); err == nil {
			s := st.ModTime().UTC().Format(time.RFC3339)
			return &s
		}
	}
	return nil
}

func checkUpdates(ctx context.Context, manager string, pkgs []Package) Updates {
	u := Updates{
		Status: "unsupported", Manager: manager, Pending: []PendingUpdate{},
		CheckedAt: time.Now().UTC().Format(time.RFC3339), RunningKernel: clip(kernelRelease(), 128),
	}
	switch manager {
	case "rpm":
		// -C: answer from the local metadata cache only (no network). dnf still takes a lock in
		// its cache directory, which the agent's unit allows; its log goes to the private /tmp.
		dnf := []string{"-C", "-q", "--setopt=logdir=/tmp"}
		out, errText, code := runCode(ctx, "dnf", append(dnf, "check-update")...)
		if code != 0 && code != 100 {
			u.Status, u.Error = "unavailable", firstNonEmpty(errText, "dnf check-update failed")
			return u
		}
		pending := parseDnfCheckUpdate(out)
		adv := map[string]advisory{}
		if info, _, c := runCode(ctx, "dnf", append(dnf, "updateinfo", "list", "--updates")...); c == 0 {
			adv = parseDnfUpdateinfo(info)
		}
		u.Status, u.Pending = "ok", mergeAdvisories(pending, adv)
		u.MetadataAt = mtime("/var/cache/dnf/last_makecache", "/var/cache/yum/last_makecache")
		if newest := newestKernel(pkgs, u.RunningKernel); newest != "" {
			u.NewestKernel = clip(newest, 128)
			reboot := rpmvercmp(newest, u.RunningKernel) > 0
			u.RebootRequired = &reboot
		}
	case "dpkg":
		out, errText, code := runCode(ctx, "apt", "list", "--upgradable")
		if code != 0 {
			u.Status, u.Error = "unavailable", firstNonEmpty(errText, "apt list failed")
			return u
		}
		u.Status, u.Pending = "ok", parseAptUpgradable(out)
		u.MetadataAt = mtime("/var/lib/apt/periodic/update-success-stamp", "/var/cache/apt/pkgcache.bin")
		_, err := os.Stat("/run/reboot-required")
		reboot := err == nil
		u.RebootRequired = &reboot
	}
	return u
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
