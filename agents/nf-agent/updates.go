package main

import (
	"bufio"
	"sort"
	"strings"
)

// Patch compliance (Phase 4b): pending package updates, which of them fix security issues, and
// whether a reboot is needed to run an installed kernel. Pure parsers only; collection is in
// collect_updates_linux.go.

// PendingUpdate is one package with a newer version available.
type PendingUpdate struct {
	Name     string `json:"name"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
	Security bool   `json:"security"`
	// Severity of the most severe security advisory (Critical, Important, Moderate, Low), or ""
	// when the distribution doesn't publish one (Debian and Ubuntu).
	Severity string `json:"severity"`
	Advisory string `json:"advisory"`
}

// Updates is the patch state of the host.
type Updates struct {
	// ok, unavailable (the package manager couldn't answer; see Error) or unsupported.
	Status  string `json:"status"`
	Error   string `json:"error"`
	Manager string `json:"manager"`
	// When this check ran, and when the package metadata was last refreshed (by dnf-makecache
	// or apt update). Results can only be as fresh as the metadata.
	CheckedAt      string          `json:"checkedAt"`
	MetadataAt     *string         `json:"metadataAt"`
	Pending        []PendingUpdate `json:"pending"`
	RebootRequired *bool           `json:"rebootRequired"`
	RunningKernel  string          `json:"runningKernel"`
	NewestKernel   string          `json:"newestKernel"`
}

const maxPending = 5000

var severityRank = map[string]int{"critical": 4, "important": 3, "moderate": 2, "low": 1}

// splitNVRA splits "name-version-release.arch" (version may carry an epoch, "1:3.0.7").
func splitNVRA(nvra string) (name, arch string, ok bool) {
	dot := strings.LastIndexByte(nvra, '.')
	if dot <= 0 {
		return "", "", false
	}
	nvr, arch := nvra[:dot], nvra[dot+1:]
	r := strings.LastIndexByte(nvr, '-')
	if r <= 0 {
		return "", "", false
	}
	v := strings.LastIndexByte(nvr[:r], '-')
	if v <= 0 {
		return "", "", false
	}
	return nvr[:v], arch, true
}

// parseDnfCheckUpdate reads `dnf -q check-update`: "name.arch  version  repo", where a long
// name may push the rest onto the next line. Stops at "Obsoleting Packages".
func parseDnfCheckUpdate(text string) []PendingUpdate {
	var out []PendingUpdate
	var carry []string
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "Obsoleting") {
			break
		}
		if line == "" || strings.HasPrefix(line, "Security:") || strings.HasPrefix(line, "Last metadata") {
			continue
		}
		f := append(carry, strings.Fields(line)...)
		if len(f) < 3 {
			carry = f
			continue
		}
		carry = nil
		dot := strings.LastIndexByte(f[0], '.')
		if dot <= 0 {
			continue
		}
		out = append(out, PendingUpdate{Name: clip(f[0][:dot], 256), Arch: clip(f[0][dot+1:], 32), Version: clip(f[1], 128)})
	}
	return out
}

type advisory struct{ id, severity string }

// parseDnfUpdateinfo reads `dnf -q updateinfo list --updates`:
// "ELSA-2026-500574 Important/Sec. kernel-uek-5.15.0-326.el9uek.x86_64". Returns the most
// severe security advisory per name.arch.
func parseDnfUpdateinfo(text string) map[string]advisory {
	out := map[string]advisory{}
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 3 || !strings.HasSuffix(f[1], "/Sec.") {
			continue
		}
		name, arch, ok := splitNVRA(f[2])
		if !ok {
			continue
		}
		sev := strings.TrimSuffix(f[1], "/Sec.")
		if sev == "None" || sev == "Unknown" {
			sev = ""
		}
		key := name + "." + arch
		if cur, seen := out[key]; !seen || severityRank[strings.ToLower(sev)] > severityRank[strings.ToLower(cur.severity)] {
			out[key] = advisory{id: f[0], severity: sev}
		}
	}
	return out
}

// mergeAdvisories marks pending updates that fix security issues and sorts them: security
// first (most severe first), then by name.
func mergeAdvisories(pending []PendingUpdate, adv map[string]advisory) []PendingUpdate {
	for i := range pending {
		if a, ok := adv[pending[i].Name+"."+pending[i].Arch]; ok {
			pending[i].Security = true
			pending[i].Severity = clip(a.severity, 32)
			pending[i].Advisory = clip(a.id, 64)
		}
	}
	return sortPending(pending)
}

func sortPending(p []PendingUpdate) []PendingUpdate {
	if p == nil {
		p = []PendingUpdate{}
	}
	sort.SliceStable(p, func(i, j int) bool {
		a, b := p[i], p[j]
		if a.Security != b.Security {
			return a.Security
		}
		ra, rb := severityRank[strings.ToLower(a.Severity)], severityRank[strings.ToLower(b.Severity)]
		if ra != rb {
			return ra > rb
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.Arch < b.Arch
	})
	if len(p) > maxPending {
		p = p[:maxPending]
	}
	return p
}

// parseAptUpgradable reads `apt list --upgradable`:
// "openssl/jammy-updates,jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: …]".
// A package is a security update when any of its suites is a -security suite.
func parseAptUpgradable(text string) []PendingUpdate {
	var out []PendingUpdate
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 3 || !strings.Contains(f[0], "/") {
			continue
		}
		name, suites, _ := strings.Cut(f[0], "/")
		security := false
		for _, s := range strings.Split(suites, ",") {
			if strings.HasSuffix(s, "-security") {
				security = true
			}
		}
		out = append(out, PendingUpdate{Name: clip(name, 256), Arch: clip(f[2], 32), Version: clip(f[1], 128), Security: security})
	}
	return sortPending(out)
}

// rpmvercmp compares two version or release strings the way rpm does: alternating numeric and
// alphabetic segments, numbers compared as numbers and newer than letters, "~" sorting before
// anything (pre-releases) and "^" after the base version (post-releases).
func rpmvercmp(a, b string) int {
	if a == b {
		return 0
	}
	isAlnum := func(c byte) bool {
		return c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
	}
	isDigit := func(c byte) bool { return c >= '0' && c <= '9' }
	for len(a) > 0 || len(b) > 0 {
		for len(a) > 0 && !isAlnum(a[0]) && a[0] != '~' && a[0] != '^' {
			a = a[1:]
		}
		for len(b) > 0 && !isAlnum(b[0]) && b[0] != '~' && b[0] != '^' {
			b = b[1:]
		}
		// Tilde: sorts before everything, even the end of the string.
		if strings.HasPrefix(a, "~") || strings.HasPrefix(b, "~") {
			if !strings.HasPrefix(a, "~") {
				return 1
			}
			if !strings.HasPrefix(b, "~") {
				return -1
			}
			a, b = a[1:], b[1:]
			continue
		}
		// Caret: sorts after the end of the string but before any other segment.
		if strings.HasPrefix(a, "^") || strings.HasPrefix(b, "^") {
			if a == "" {
				return -1
			}
			if b == "" {
				return 1
			}
			if !strings.HasPrefix(a, "^") {
				return 1
			}
			if !strings.HasPrefix(b, "^") {
				return -1
			}
			a, b = a[1:], b[1:]
			continue
		}
		if a == "" || b == "" {
			break
		}
		numeric := isDigit(a[0])
		take := func(s string) (string, string) {
			i := 0
			for i < len(s) && isAlnum(s[i]) && isDigit(s[i]) == numeric {
				i++
			}
			return s[:i], s[i:]
		}
		var sa, sb string
		sa, a = take(a)
		sb, b = take(b)
		if sb == "" {
			// Different segment types: a number is newer than letters.
			if numeric {
				return 1
			}
			return -1
		}
		if numeric {
			sa = strings.TrimLeft(sa, "0")
			sb = strings.TrimLeft(sb, "0")
			if len(sa) != len(sb) {
				if len(sa) > len(sb) {
					return 1
				}
				return -1
			}
		}
		if c := strings.Compare(sa, sb); c != 0 {
			return c
		}
	}
	switch {
	case a == "" && b == "":
		return 0
	case a == "":
		return -1
	default:
		return 1
	}
}

// newestKernel returns the newest installed kernel of the same flavour as the running one
// (UEK or the distribution kernel) from the rpm package list, as "version-release.arch" (the
// form `uname -r` prints).
func newestKernel(pkgs []Package, running string) string {
	names := map[string]bool{"kernel": true, "kernel-core": true}
	if strings.Contains(running, "uek") {
		names = map[string]bool{"kernel-uek": true, "kernel-uek-core": true}
	}
	newest := ""
	for _, p := range pkgs {
		if !names[p.Name] {
			continue
		}
		if newest == "" || rpmvercmp(p.Version, newest) > 0 {
			newest = p.Version
		}
	}
	return newest
}
