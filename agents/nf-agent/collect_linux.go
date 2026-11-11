//go:build linux

package main

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"time"
)

func readFile(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

// run executes a read-only command with a timeout; failures yield empty output.
func run(ctx context.Context, name string, args ...string) string {
	if _, err := exec.LookPath(name); err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil && len(out) == 0 {
		return ""
	}
	return string(out)
}

func kernelRelease() string {
	var u syscall.Utsname
	if err := syscall.Uname(&u); err != nil {
		return ""
	}
	b := make([]byte, 0, len(u.Release))
	for _, c := range u.Release {
		if c == 0 {
			break
		}
		b = append(b, byte(c))
	}
	return string(b)
}

func collectDisks() []Disk {
	var disks []Disk
	for _, m := range parseMounts(readFile("/proc/mounts")) {
		var st syscall.Statfs_t
		if err := syscall.Statfs(m.Mount, &st); err != nil {
			continue
		}
		size := int64(st.Blocks) * int64(st.Bsize)
		free := int64(st.Bfree) * int64(st.Bsize)
		if size <= 0 {
			continue
		}
		disks = append(disks, Disk{
			Mount: clip(m.Mount, 512), Device: clip(m.Device, 256), FsType: m.FsType,
			SizeBytes: size, UsedBytes: size - free,
		})
		if len(disks) >= maxDisks {
			break
		}
	}
	return disks
}

// collectPackages lists installed packages with whichever manager the distribution uses.
func collectPackages(ctx context.Context) (manager string, pkgs []Package, hash string) {
	if out := run(ctx, "rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}.%{ARCH}\n"); out != "" {
		pkgs, hash = parsePackages(out)
		return "rpm", pkgs, hash
	}
	if out := run(ctx, "dpkg-query", "-W", "-f", "${Package}\t${Version}\n"); out != "" {
		pkgs, hash = parsePackages(out)
		return "dpkg", pkgs, hash
	}
	pkgs, hash = parsePackages("")
	return "none", pkgs, hash
}

// Collect gathers the inventory. It only reads: /proc, /etc and read-only commands
// (rpm/dpkg, systemctl, firewall-cmd, dnf/apt from their local caches).
func Collect(ctx context.Context) Inventory {
	osr := parseOSRelease(readFile("/etc/os-release"))
	total, avail := parseMeminfo(readFile("/proc/meminfo"))
	model, cores := parseCPUInfo(readFile("/proc/cpuinfo"))
	if cores == 0 {
		cores = runtime.NumCPU()
	}
	hostname, _ := os.Hostname()
	manager, pkgs, hash := collectPackages(ctx)
	services := parseSystemctl(run(ctx, "systemctl", "list-units", "--type=service", "--state=running",
		"--plain", "--no-legend", "--no-pager"))
	if services == nil {
		services = []Service{}
	}
	disks := collectDisks()
	if disks == nil {
		disks = []Disk{}
	}
	ifaces := collectInterfaces()
	load := parseLoadavg(readFile("/proc/loadavg"))
	return Inventory{
		AgentVersion: version,
		CollectedAt:  time.Now().UTC().Format(time.RFC3339),
		Hostname:     clip(hostname, 253),
		MachineID:    strings.TrimSpace(readFile("/etc/machine-id")),
		OS: OSInfo{
			ID: clip(osr["ID"], 64), Name: clip(osr["NAME"], 128), Version: clip(osr["VERSION_ID"], 64),
			PrettyName: clip(osr["PRETTY_NAME"], 256), Kernel: clip(kernelRelease(), 128), Arch: runtime.GOARCH,
		},
		CPU:            CPUInfo{Model: clip(model, 256), Cores: cores},
		Memory:         MemoryInfo{TotalBytes: total, AvailableBytes: avail},
		UptimeSeconds:  parseUptime(readFile("/proc/uptime")),
		LoadAverage:    &load,
		Disks:          disks,
		Interfaces:     ifaces,
		Services:       services,
		Packages:       pkgs,
		PackageManager: manager,
		PackagesHash:   hash,
		PackageCount:   len(pkgs),
		Listeners:      collectListeners(),
		Firewall:       collectFirewall(ctx),
		SSH:            collectSSH(),
		Updates:        collectUpdates(ctx, manager, pkgs),
	}
}
