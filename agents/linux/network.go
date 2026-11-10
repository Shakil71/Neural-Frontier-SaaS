package main

import (
	"bufio"
	"encoding/hex"
	"net"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Network exposure (Phase 4a): which ports the host listens on, what its firewall lets in and how
// SSH is configured. Pure parsers only; collection is in collect_network_linux.go.

// Listener is a socket waiting for connections (TCP LISTEN, or an unconnected bound UDP socket).
type Listener struct {
	Proto   string `json:"proto"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	// Process is empty when the agent may not inspect the owning process (it runs without
	// CAP_SYS_PTRACE on purpose).
	Process string `json:"process"`
	inode   string
	uid     int
}

// PortRange is traffic a firewall lets in. Scope "any" means from anywhere; "limited" means only
// from specific source addresses.
type PortRange struct {
	Proto string `json:"proto"`
	From  int    `json:"from"`
	To    int    `json:"to"`
	Scope string `json:"scope"`
}

type Firewall struct {
	// firewalld, ufw, nftables, iptables or none.
	Kind   string `json:"kind"`
	Active bool   `json:"active"`
	// RulesKnown is false when a firewall runs but the agent can't read its rules (raw nftables
	// and iptables need CAP_NET_ADMIN, which the agent deliberately doesn't have).
	RulesKnown bool `json:"rulesKnown"`
	// DefaultAllow: incoming traffic is accepted unless a rule blocks it.
	DefaultAllow bool        `json:"defaultAllow"`
	Zones        []string    `json:"zones"`
	Allowed      []PortRange `json:"allowed"`
}

// SSHConfig is the effective sshd configuration for the settings that matter most.
type SSHConfig struct {
	Present                      bool   `json:"present"`
	Ports                        []int  `json:"ports"`
	PermitRootLogin              string `json:"permitRootLogin"`
	PasswordAuthentication       string `json:"passwordAuthentication"`
	KbdInteractiveAuthentication string `json:"kbdInteractiveAuthentication"`
	UsePAM                       string `json:"usePam"`
	PermitEmptyPasswords         string `json:"permitEmptyPasswords"`
}

const (
	maxListeners  = 512
	maxPortRanges = 1024
	maxZones      = 64
)

// decodeProcAddr turns /proc/net/{tcp,udp}{,6} "0100007F:0035" into ("127.0.0.1", 53).
// The kernel prints each 32-bit word of the address in host (little-endian) byte order.
func decodeProcAddr(s string) (string, int, bool) {
	hexIP, hexPort, ok := strings.Cut(s, ":")
	if !ok {
		return "", 0, false
	}
	port, err := strconv.ParseUint(hexPort, 16, 16)
	if err != nil {
		return "", 0, false
	}
	raw, err := hex.DecodeString(hexIP)
	if err != nil || (len(raw) != 4 && len(raw) != 16) {
		return "", 0, false
	}
	ip := make(net.IP, len(raw))
	for w := 0; w < len(raw); w += 4 {
		ip[w], ip[w+1], ip[w+2], ip[w+3] = raw[w+3], raw[w+2], raw[w+1], raw[w]
	}
	if v4 := ip.To4(); v4 != nil && len(raw) == 16 && !ip.Equal(net.IPv6zero) {
		// IPv4-mapped IPv6 (::ffff:a.b.c.d): report the IPv4 form.
		return v4.String(), int(port), true
	}
	return ip.String(), int(port), true
}

// parseProcNet reads one /proc/net table. TCP sockets count when LISTEN (0A); UDP sockets when
// unconnected (07) with no remote peer.
func parseProcNet(text, proto string) []Listener {
	var out []Listener
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 10 || f[0] == "sl" {
			continue
		}
		switch proto {
		case "tcp":
			if f[3] != "0A" {
				continue
			}
		case "udp":
			_, rport, ok := decodeProcAddr(f[2])
			if f[3] != "07" || !ok || rport != 0 {
				continue
			}
		}
		addr, port, ok := decodeProcAddr(f[1])
		if !ok {
			continue
		}
		uid, _ := strconv.Atoi(f[7])
		out = append(out, Listener{Proto: proto, Address: addr, Port: port, uid: uid, inode: f[9]})
	}
	return out
}

// mergeListeners de-duplicates (SO_REUSEPORT gives several identical sockets), sorts by port and
// applies the size limit.
func mergeListeners(in []Listener) []Listener {
	seen := map[string]bool{}
	out := []Listener{}
	for _, l := range in {
		k := l.Proto + "|" + l.Address + "|" + strconv.Itoa(l.Port)
		if seen[k] {
			continue
		}
		seen[k] = true
		l.Address = clip(l.Address, 64)
		l.User = clip(l.User, 64)
		l.Process = clip(l.Process, 64)
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Port != b.Port {
			return a.Port < b.Port
		}
		if a.Proto != b.Proto {
			return a.Proto < b.Proto
		}
		return a.Address < b.Address
	})
	if len(out) > maxListeners {
		out = out[:maxListeners]
	}
	return out
}

// parsePasswd maps uid → user name from /etc/passwd.
func parsePasswd(text string) map[int]string {
	out := map[int]string{}
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		f := strings.Split(sc.Text(), ":")
		if len(f) < 3 {
			continue
		}
		if uid, err := strconv.Atoi(f[2]); err == nil {
			if _, dup := out[uid]; !dup {
				out[uid] = f[0]
			}
		}
	}
	return out
}

// parsePortSpec reads "22/tcp", "3000-3010/udp" (firewalld) into a range.
func parsePortSpec(spec, scope string) (PortRange, bool) {
	ports, proto, ok := strings.Cut(strings.TrimSpace(spec), "/")
	if !ok || (proto != "tcp" && proto != "udp") {
		return PortRange{}, false
	}
	from, to, ok := parseRange(ports, "-")
	if !ok {
		return PortRange{}, false
	}
	return PortRange{Proto: proto, From: from, To: to, Scope: scope}, true
}

func parseRange(s, sep string) (int, int, bool) {
	a, b, isRange := strings.Cut(s, sep)
	from, err := strconv.Atoi(a)
	if err != nil || from < 0 || from > 65535 {
		return 0, 0, false
	}
	to := from
	if isRange {
		to, err = strconv.Atoi(b)
		if err != nil || to < from || to > 65535 {
			return 0, 0, false
		}
	}
	return from, to, true
}

// firewalldZone is the part of `firewall-cmd --info-zone=Z` the agent uses.
type firewalldZone struct {
	Name       string
	Target     string
	Interfaces []string
	Sources    []string
	Services   []string
	Ports      []string
}

// parseActiveZones reads `firewall-cmd --get-active-zones`: zone names are the unindented lines
// (newer versions append " (default)").
func parseActiveZones(text string) []string {
	var out []string
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := sc.Text()
		if line == "" || line[0] == ' ' || line[0] == '\t' {
			continue
		}
		name, _, _ := strings.Cut(strings.TrimSpace(line), " ")
		if name != "" {
			out = append(out, name)
		}
	}
	return out
}

// parseFirewalldInfo reads `firewall-cmd --info-zone=Z` or `--info-service=S` ("key: values").
func parseFirewalldInfo(text string) map[string][]string {
	out := map[string][]string{}
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			continue
		}
		k, v, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		out[k] = strings.Fields(v)
	}
	return out
}

func zoneFromInfo(name, text string) firewalldZone {
	m := parseFirewalldInfo(text)
	z := firewalldZone{Name: name, Interfaces: m["interfaces"], Sources: m["sources"],
		Services: m["services"], Ports: m["ports"]}
	if t := m["target"]; len(t) > 0 {
		z.Target = t[0]
	}
	return z
}

// firewalldAllowed combines active zones into allowed ranges. A zone bound to interfaces admits
// traffic from anywhere; a zone bound only to source addresses admits it only from those.
// servicePorts resolves a service name to its "22/tcp" port specs.
func firewalldAllowed(zones []firewalldZone, servicePorts func(string) []string) (allowed []PortRange, defaultAllow bool) {
	for _, z := range zones {
		scope := "any"
		if len(z.Interfaces) == 0 && len(z.Sources) > 0 {
			scope = "limited"
		}
		if strings.EqualFold(z.Target, "ACCEPT") {
			if scope == "any" {
				defaultAllow = true
			}
			allowed = append(allowed, PortRange{Proto: "tcp", From: 0, To: 65535, Scope: scope},
				PortRange{Proto: "udp", From: 0, To: 65535, Scope: scope})
			continue
		}
		specs := append([]string{}, z.Ports...)
		for _, s := range z.Services {
			specs = append(specs, servicePorts(s)...)
		}
		for _, s := range specs {
			if r, ok := parsePortSpec(s, scope); ok {
				allowed = append(allowed, r)
			}
		}
	}
	return normaliseRanges(allowed), defaultAllow
}

// parseUfwRules reads /etc/ufw/user.rules and user6.rules "### tuple ###" comments:
// "### tuple ### allow tcp 22 0.0.0.0/0 any 0.0.0.0/0 in". Only incoming allow/limit rules count.
func parseUfwRules(text string) []PortRange {
	var out []PortRange
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		rest, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "### tuple ###")
		if !ok {
			continue
		}
		f := strings.Fields(rest)
		// action proto dport dst sport src [direction]
		if len(f) < 6 || (f[0] != "allow" && f[0] != "limit") {
			continue
		}
		if len(f) >= 7 && f[6] != "in" {
			continue
		}
		scope := "limited"
		if f[5] == "0.0.0.0/0" || f[5] == "::/0" {
			scope = "any"
		}
		protos := []string{f[1]}
		if f[1] == "any" {
			protos = []string{"tcp", "udp"}
		} else if f[1] != "tcp" && f[1] != "udp" {
			continue
		}
		var ranges [][2]int
		if f[2] == "any" {
			ranges = [][2]int{{0, 65535}}
		} else {
			for _, part := range strings.Split(f[2], ",") {
				if from, to, ok := parseRange(part, ":"); ok {
					ranges = append(ranges, [2]int{from, to})
				}
			}
		}
		for _, p := range protos {
			for _, r := range ranges {
				out = append(out, PortRange{Proto: p, From: r[0], To: r[1], Scope: scope})
			}
		}
	}
	return out
}

// parseKeyValueConf reads simple KEY=value files (/etc/ufw/ufw.conf, /etc/default/ufw).
func parseKeyValueConf(text string) map[string]string {
	return parseOSRelease(text)
}

// normaliseRanges removes duplicates, sorts and applies the size limit.
func normaliseRanges(in []PortRange) []PortRange {
	seen := map[PortRange]bool{}
	out := []PortRange{}
	for _, r := range in {
		if !seen[r] {
			seen[r] = true
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.From != b.From {
			return a.From < b.From
		}
		if a.Proto != b.Proto {
			return a.Proto < b.Proto
		}
		if a.To != b.To {
			return a.To < b.To
		}
		return a.Scope < b.Scope
	})
	if len(out) > maxPortRanges {
		out = out[:maxPortRanges]
	}
	return out
}

// OpenSSH defaults for settings the configuration doesn't mention.
var sshDefaults = map[string]string{
	"permitrootlogin":              "prohibit-password",
	"passwordauthentication":       "yes",
	"kbdinteractiveauthentication": "yes",
	"usepam":                       "no",
	"permitemptypasswords":         "no",
}

// parseSSHDConfig reads sshd_config the way sshd does for the global section: the first value
// of a keyword wins, Include is expanded in place (globs sorted, relative paths under
// /etc/ssh), and Match blocks are skipped because they only apply to some connections.
// readFile returns "" for a missing file; glob lists files matching a pattern.
func parseSSHDConfig(path string, readFile func(string) string, glob func(string) []string) SSHConfig {
	values := map[string]string{}
	var ports []int
	var visit func(p string, depth int)
	visit = func(p string, depth int) {
		if depth > 8 {
			return
		}
		sc := bufio.NewScanner(strings.NewReader(readFile(p)))
		inMatch := false
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || line[0] == '#' {
				continue
			}
			key, val := splitSSHLine(line)
			key = strings.ToLower(key)
			if key == "challengeresponseauthentication" {
				// Deprecated alias.
				key = "kbdinteractiveauthentication"
			}
			if key == "match" {
				inMatch = true
				continue
			}
			if inMatch {
				continue
			}
			switch key {
			case "include":
				for _, pat := range strings.Fields(val) {
					if !strings.HasPrefix(pat, "/") {
						pat = "/etc/ssh/" + pat
					}
					matches := glob(pat)
					sort.Strings(matches)
					for _, m := range matches {
						visit(m, depth+1)
					}
				}
			case "port":
				// Port may repeat; every occurrence applies.
				if n, err := strconv.Atoi(val); err == nil && n > 0 && n <= 65535 && len(ports) < 16 {
					ports = append(ports, n)
				}
			default:
				if _, known := sshDefaults[key]; known {
					if _, set := values[key]; !set {
						values[key] = strings.ToLower(val)
					}
				}
			}
		}
	}
	if readFile(path) == "" {
		return SSHConfig{Present: false, Ports: []int{}}
	}
	visit(path, 0)
	if len(ports) == 0 {
		ports = []int{22}
	}
	get := func(k string) string {
		if v, ok := values[k]; ok {
			return clip(v, 32)
		}
		return sshDefaults[k]
	}
	// "without-password" is the old spelling of "prohibit-password".
	root := get("permitrootlogin")
	if root == "without-password" {
		root = "prohibit-password"
	}
	return SSHConfig{
		Present:                      true,
		Ports:                        ports,
		PermitRootLogin:              root,
		PasswordAuthentication:       get("passwordauthentication"),
		KbdInteractiveAuthentication: get("kbdinteractiveauthentication"),
		UsePAM:                       get("usepam"),
		PermitEmptyPasswords:         get("permitemptypasswords"),
	}
}

// splitSSHLine splits "Keyword value", "Keyword=value" or "Keyword = value".
func splitSSHLine(line string) (string, string) {
	i := strings.IndexAny(line, " \t=")
	if i < 0 {
		return line, ""
	}
	key := line[:i]
	val := strings.TrimLeft(line[i:], " \t")
	val = strings.TrimPrefix(val, "=")
	val = strings.TrimSpace(val)
	if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
		val = val[1 : len(val)-1]
	}
	return key, val
}

// globFiles is filepath.Glob without the error.
func globFiles(pattern string) []string {
	m, _ := filepath.Glob(pattern)
	return m
}
