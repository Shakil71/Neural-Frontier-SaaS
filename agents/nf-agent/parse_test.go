package main

import (
	"strings"
	"testing"
)

func TestParseOSRelease(t *testing.T) {
	m := parseOSRelease(`NAME="Oracle Linux Server"
VERSION="9.8"
ID="ol"
# comment
VERSION_ID='9.8'
PRETTY_NAME="Oracle Linux Server 9.8"
BROKEN
`)
	if m["ID"] != "ol" || m["VERSION_ID"] != "9.8" || m["PRETTY_NAME"] != "Oracle Linux Server 9.8" {
		t.Fatalf("unexpected: %#v", m)
	}
	if _, ok := m["BROKEN"]; ok {
		t.Fatal("line without = must be ignored")
	}
}

func TestParseMeminfo(t *testing.T) {
	total, avail := parseMeminfo("MemTotal:       16303112 kB\nMemFree:  100 kB\nMemAvailable:   12000000 kB\n")
	if total != 16303112*1024 || avail != 12000000*1024 {
		t.Fatalf("got %d %d", total, avail)
	}
}

func TestParseCPUInfo(t *testing.T) {
	text := strings.Repeat("processor\t: 0\nmodel name\t: Intel(R) Xeon(R) Gold 6338\n\n", 4)
	model, cores := parseCPUInfo(text)
	if model != "Intel(R) Xeon(R) Gold 6338" || cores != 4 {
		t.Fatalf("got %q %d", model, cores)
	}
}

func TestUptimeAndLoad(t *testing.T) {
	if parseUptime("12345.67 99999.00\n") != 12345 {
		t.Fatal("uptime")
	}
	if parseUptime("garbage") != 0 {
		t.Fatal("uptime garbage")
	}
	if got := parseLoadavg("0.52 0.41 0.30 2/345 6789"); got != [3]float64{0.52, 0.41, 0.30} {
		t.Fatalf("load %v", got)
	}
}

func TestParseMounts(t *testing.T) {
	m := parseMounts(`/dev/mapper/ol-root / xfs rw 0 0
proc /proc proc rw 0 0
tmpfs /run tmpfs rw 0 0
/dev/sda6 /license_monitoring xfs rw 0 0
/dev/sda6 /bind/again xfs rw 0 0
/dev/sdb1 /mnt/my\040disk ext4 rw 0 0
overlay /var/lib/containers overlay rw 0 0
`)
	if len(m) != 3 {
		t.Fatalf("want 3 real, de-duplicated mounts, got %#v", m)
	}
	if m[2].Mount != "/mnt/my disk" {
		t.Fatalf("octal escapes not decoded: %q", m[2].Mount)
	}
}

func TestParsePackagesIsSortedAndStable(t *testing.T) {
	a, ha := parsePackages("zlib\t1.2.11\nbash\t5.1.8\ngpg-pubkey\tabc\n\nnoversion\n")
	b, hb := parsePackages("bash\t5.1.8\nzlib\t1.2.11\n")
	if len(a) != 2 || a[0].Name != "bash" || a[1].Name != "zlib" {
		t.Fatalf("got %#v", a)
	}
	if ha != hb || len(ha) != 64 {
		t.Fatal("hash must not depend on input order")
	}
	_, hc := parsePackages("bash\t5.1.9\nzlib\t1.2.11\n")
	if hc == ha {
		t.Fatal("hash must change when a version changes")
	}
	_ = b
}

func TestParseSystemctl(t *testing.T) {
	s := parseSystemctl(`nginx.service      loaded active running The nginx HTTP and reverse proxy server
sshd.service       loaded active running OpenSSH server daemon
something.socket   loaded active running Not a service
`)
	if len(s) != 2 || s[0].Name != "nginx.service" || s[0].Description != "The nginx HTTP and reverse proxy server" {
		t.Fatalf("got %#v", s)
	}
}

func TestClipKeepsUTF8Valid(t *testing.T) {
	if got := clip("héllo", 2); got != "h" {
		t.Fatalf("clip split a rune: %q", got)
	}
	if clip("abc", 10) != "abc" {
		t.Fatal("short strings unchanged")
	}
}

func TestValidMachineID(t *testing.T) {
	if !validMachineID("0123456789abcdef0123456789abcdef") || validMachineID("XYZ") || validMachineID(strings.Repeat("g", 32)) {
		t.Fatal("machine-id validation")
	}
}
