package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
)

// Pure parsers for the files and command outputs the agent reads. No I/O here, so they are
// unit-tested on any OS (see parse_test.go).

// parseOSRelease reads /etc/os-release (KEY=value, optionally quoted).
func parseOSRelease(text string) map[string]string {
	out := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		out[strings.TrimSpace(k)] = strings.ReplaceAll(v, `\"`, `"`)
	}
	return out
}

// parseMeminfo returns MemTotal and MemAvailable in bytes from /proc/meminfo.
func parseMeminfo(text string) (total, available int64) {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		kb, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = kb * 1024
		case "MemAvailable:":
			available = kb * 1024
		}
	}
	return total, available
}

// parseCPUInfo returns the model name and the number of logical CPUs from /proc/cpuinfo.
func parseCPUInfo(text string) (model string, cores int) {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		switch k {
		case "processor":
			cores++
		case "model name", "Model", "cpu model", "Hardware":
			if model == "" {
				model = v
			}
		}
	}
	return model, cores
}

// parseUptime returns whole seconds from /proc/uptime.
func parseUptime(text string) int64 {
	f := strings.Fields(text)
	if len(f) == 0 {
		return 0
	}
	v, err := strconv.ParseFloat(f[0], 64)
	if err != nil {
		return 0
	}
	return int64(v)
}

// parseLoadavg returns the 1, 5 and 15 minute load averages from /proc/loadavg.
func parseLoadavg(text string) [3]float64 {
	var out [3]float64
	f := strings.Fields(text)
	for i := 0; i < 3 && i < len(f); i++ {
		v, err := strconv.ParseFloat(f[i], 64)
		if err == nil {
			out[i] = v
		}
	}
	return out
}

// Real, persistent filesystems worth reporting (skips proc, tmpfs, overlay, snaps…).
var realFS = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "zfs": true,
	"f2fs": true, "jfs": true, "reiserfs": true, "vfat": true, "exfat": true, "ntfs": true,
	"ntfs3": true, "nfs": true, "nfs4": true, "cifs": true, "smb3": true,
}

type mount struct{ Device, Mount, FsType string }

// parseMounts returns real filesystems from /proc/mounts, one entry per device.
func parseMounts(text string) []mount {
	seen := map[string]bool{}
	var out []mount
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 3 || !realFS[f[2]] || seen[f[0]] {
			continue
		}
		seen[f[0]] = true
		// /proc/mounts escapes spaces and tabs as octal.
		mp := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\134`, `\`).Replace(f[1])
		out = append(out, mount{Device: f[0], Mount: mp, FsType: f[2]})
	}
	return out
}

// parsePackages reads "name<TAB>version" lines (rpm -qa --qf / dpkg-query -W output),
// sorted by name, with a stable hash so unchanged lists needn't be re-sent.
func parsePackages(text string) ([]Package, string) {
	var pkgs []Package
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		name, version, ok := strings.Cut(strings.TrimSpace(sc.Text()), "\t")
		if !ok || name == "" || strings.HasPrefix(name, "gpg-pubkey") {
			continue
		}
		pkgs = append(pkgs, Package{Name: clip(name, 256), Version: clip(version, 128)})
	}
	sort.Slice(pkgs, func(i, j int) bool {
		if pkgs[i].Name == pkgs[j].Name {
			return pkgs[i].Version < pkgs[j].Version
		}
		return pkgs[i].Name < pkgs[j].Name
	})
	if len(pkgs) > maxPackages {
		pkgs = pkgs[:maxPackages]
	}
	h := sha256.New()
	for _, p := range pkgs {
		h.Write([]byte(p.Name + "\t" + p.Version + "\n"))
	}
	return pkgs, hex.EncodeToString(h.Sum(nil))
}

// parseSystemctl reads `systemctl list-units --type=service --state=running --plain
// --no-legend --no-pager` output: "unit load active sub description…".
func parseSystemctl(text string) []Service {
	var out []Service
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 4 || !strings.HasSuffix(f[0], ".service") {
			continue
		}
		desc := ""
		if len(f) > 4 {
			desc = strings.Join(f[4:], " ")
		}
		out = append(out, Service{Name: clip(f[0], 256), Description: clip(desc, 512)})
		if len(out) >= maxServices {
			break
		}
	}
	return out
}

// validMachineID reports whether s looks like /etc/machine-id (32 lowercase hex).
func validMachineID(s string) bool {
	if len(s) != 32 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
