//go:build linux

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

// collectListeners reads the kernel's socket tables. Socket owners come from /etc/passwd; the
// owning process is resolved only where /proc/<pid>/fd is readable, which without
// CAP_SYS_PTRACE is just the agent's own kind of process, so Process is usually empty.
func collectListeners() []Listener {
	var all []Listener
	for _, t := range []struct{ file, proto string }{
		{"/proc/net/tcp", "tcp"}, {"/proc/net/tcp6", "tcp"},
		{"/proc/net/udp", "udp"}, {"/proc/net/udp6", "udp"},
	} {
		all = append(all, parseProcNet(readFile(t.file), t.proto)...)
	}
	users := parsePasswd(readFile("/etc/passwd"))
	procs := socketProcesses(all)
	for i := range all {
		all[i].User = users[all[i].uid]
		all[i].Process = procs[all[i].inode]
	}
	return mergeListeners(all)
}

// socketProcesses maps socket inodes to process names, best effort.
func socketProcesses(ls []Listener) map[string]string {
	want := map[string]bool{}
	for _, l := range ls {
		want["socket:["+l.inode+"]"] = true
	}
	out := map[string]string{}
	pids, _ := filepath.Glob("/proc/[0-9]*")
	for _, pid := range pids {
		fds, err := os.ReadDir(pid + "/fd")
		if err != nil {
			continue
		}
		var comm string
		for _, fd := range fds {
			target, err := os.Readlink(pid + "/fd/" + fd.Name())
			if err != nil || !want[target] {
				continue
			}
			if comm == "" {
				comm = strings.TrimSpace(readFile(pid + "/comm"))
			}
			out[strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]")] = comm
		}
	}
	return out
}

func unitActive(ctx context.Context, unit string) bool {
	return strings.TrimSpace(run(ctx, "systemctl", "is-active", unit)) == "active"
}

// collectFirewall reports the host firewall. firewalld is asked over D-Bus (firewall-cmd); ufw
// is read from its rule files; raw nftables/iptables rules need CAP_NET_ADMIN, so for those
// only "a firewall is running" is reported.
func collectFirewall(ctx context.Context) Firewall {
	fw := Firewall{Kind: "none", Zones: []string{}, Allowed: []PortRange{}}
	switch {
	case unitActive(ctx, "firewalld"):
		fw.Kind, fw.Active = "firewalld", true
		// Interfaces not assigned to any zone use the default zone, so it always counts.
		names := parseActiveZones(run(ctx, "firewall-cmd", "--get-active-zones"))
		if def := strings.TrimSpace(run(ctx, "firewall-cmd", "--get-default-zone")); def != "" && !contains(names, def) {
			names = append(names, def)
		}
		if len(names) == 0 {
			return fw
		}
		cache := map[string][]string{}
		servicePorts := func(s string) []string {
			if p, ok := cache[s]; ok {
				return p
			}
			p := parseFirewalldInfo(run(ctx, "firewall-cmd", "--info-service="+s))["ports"]
			cache[s] = p
			return p
		}
		var zones []firewalldZone
		for _, n := range names {
			info := run(ctx, "firewall-cmd", "--info-zone="+n)
			if info == "" {
				return fw
			}
			zones = append(zones, zoneFromInfo(n, info))
			if len(fw.Zones) < maxZones {
				fw.Zones = append(fw.Zones, clip(n, 64))
			}
		}
		fw.Allowed, fw.DefaultAllow = firewalldAllowed(zones, servicePorts)
		fw.RulesKnown = true
	case strings.EqualFold(parseKeyValueConf(readFile("/etc/ufw/ufw.conf"))["ENABLED"], "yes"):
		fw.Kind, fw.Active = "ufw", true
		policy := parseKeyValueConf(readFile("/etc/default/ufw"))["DEFAULT_INPUT_POLICY"]
		fw.DefaultAllow = strings.EqualFold(policy, "ACCEPT")
		rules := readFile("/etc/ufw/user.rules") + "\n" + readFile("/etc/ufw/user6.rules")
		fw.Allowed = normaliseRanges(parseUfwRules(rules))
		fw.RulesKnown = policy != ""
	case unitActive(ctx, "nftables"):
		fw.Kind, fw.Active = "nftables", true
	case unitActive(ctx, "iptables") || unitActive(ctx, "netfilter-persistent"):
		fw.Kind, fw.Active = "iptables", true
	}
	return fw
}

func collectSSH() SSHConfig {
	return parseSSHDConfig("/etc/ssh/sshd_config", readFile, globFiles)
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
