//go:build windows

package main

import (
	"bytes"
	"context"
	_ "embed"
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed collect_windows.ps1
var collectScript string

//go:embed updates_windows.ps1
var updatesScript string

// powershell runs a script with the built-in Windows PowerShell 5.1 (present on every supported
// Windows) and returns its standard output. The script goes in on standard input and is read
// whole before it runs, so there is no temporary file and no command-line length limit.
func powershell(ctx context.Context, script string, timeout time.Duration) ([]byte, error) {
	exe := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if _, err := os.Stat(exe); err != nil {
		exe = "powershell.exe"
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; "+
			"Invoke-Expression ([Console]::In.ReadToEnd())")
	cmd.Stdin = strings.NewReader(script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	if stdout.Len() == 0 {
		if err == nil {
			err = errors.New("no output")
		}
		return nil, errors.New(clip(strings.TrimSpace(err.Error()+": "+stderr.String()), 300))
	}
	return stdout.Bytes(), nil
}

// Windows Update is asked at most hourly, like dnf and apt on Linux.
const updatesInterval = time.Hour

var (
	updatesMu    sync.Mutex
	updatesCache *Updates
	updatesAt    time.Time
)

func collectWindowsUpdates(ctx context.Context, build string) Updates {
	updatesMu.Lock()
	defer updatesMu.Unlock()
	if updatesCache == nil || time.Since(updatesAt) >= updatesInterval {
		now := time.Now().UTC().Format(time.RFC3339)
		var u Updates
		if out, err := powershell(ctx, updatesScript, 10*time.Minute); err != nil {
			u = Updates{Status: "unavailable", Error: clip(err.Error(), 300), Manager: "windows-update",
				Pending: []PendingUpdate{}, CheckedAt: now, RunningKernel: clip(build, 128)}
		} else {
			u = windowsUpdates(out, now, build)
		}
		updatesCache, updatesAt = &u, time.Now()
	}
	return *updatesCache
}

// Collect gathers the inventory through the built-in PowerShell. It only reads.
func Collect(ctx context.Context) Inventory {
	hostname, _ := os.Hostname()
	inv := Inventory{
		AgentVersion:   version,
		CollectedAt:    time.Now().UTC().Format(time.RFC3339),
		Hostname:       clip(hostname, 253),
		OS:             OSInfo{ID: "windows", Name: "Windows", Arch: runtime.GOARCH},
		CPU:            CPUInfo{Cores: runtime.NumCPU()},
		Disks:          []Disk{},
		Interfaces:     collectInterfaces(),
		Services:       []Service{},
		Listeners:      []Listener{},
		Firewall:       Firewall{Kind: "windows", Zones: []string{}, Allowed: []PortRange{}},
		SSH:            SSHConfig{Ports: []int{}},
		PackageManager: "windows",
	}
	inv.Packages, inv.PackagesHash = parsePackages("")
	out, err := powershell(ctx, collectScript, 3*time.Minute)
	var r winReport
	if err == nil {
		r, err = parseWinReport(out)
	}
	if err != nil {
		log.Printf("collect: %v", err)
	} else {
		inv.MachineID = windowsMachineID(r.MachineGUID)
		inv.OS = windowsOS(r, runtime.GOARCH)
		if name := strings.TrimSpace(r.CPU.Name); name != "" {
			inv.CPU.Model = clip(name, 256)
		}
		if r.CPU.Logical > 0 {
			inv.CPU.Cores = r.CPU.Logical
		}
		inv.Memory = MemoryInfo{TotalBytes: r.OS.TotalKb * 1024, AvailableBytes: r.OS.FreeKb * 1024}
		if r.OS.Uptime > 0 {
			inv.UptimeSeconds = r.OS.Uptime
		}
		inv.Disks = windowsDisks(r)
		inv.Services = windowsServices(r)
		inv.Packages, inv.PackagesHash = windowsPrograms(r)
		inv.Listeners = windowsListeners(r)
		fw, profiles := windowsFirewall(r)
		inv.Firewall = fw
		inv.Windows = windowsSecurity(r, profiles)
		if r.Security.Sshd {
			inv.SSH = collectWindowsSSH()
		}
	}
	inv.PackageCount = len(inv.Packages)
	inv.Updates = collectWindowsUpdates(ctx, inv.OS.Kernel)
	return inv
}

// collectWindowsSSH reads the OpenSSH Server configuration. Windows has no root account, so
// PermitRootLogin doesn't apply and is reported empty.
func collectWindowsSSH() SSHConfig {
	path := filepath.Join(programData(), "ssh", "sshd_config")
	read := func(p string) string {
		b, err := os.ReadFile(p)
		if err != nil {
			return ""
		}
		return string(b)
	}
	cfg := parseSSHDConfig(path, read, func(string) []string { return nil })
	cfg.PermitRootLogin = ""
	return cfg
}
