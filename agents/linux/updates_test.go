package main

import (
	"reflect"
	"testing"
)

func TestRpmvercmp(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0", "1.0", 0},
		{"1.0", "2.0", -1},
		{"2.0.1", "2.0", 1},
		{"1.10", "1.9", 1},
		{"1.010", "1.10", 0},
		{"1.0a", "1.0", 1},
		{"1.0", "1.0a", -1},
		{"1a", "1.1", -1}, // a number is newer than letters
		{"1.0~rc1", "1.0", -1},
		{"1.0~rc1", "1.0~rc2", -1},
		{"1.0^20230101", "1.0", 1},
		{"1.0^20230101", "1.0.1", -1},
		{"5.15.0-326.222.4.el9uek.x86_64", "5.15.0-325.221.6.6.el9uek.x86_64", 1},
		{"5.14.0-687.66.1.el9_8.x86_64", "5.14.0-687.61.1.el9_8.x86_64", 1},
		{"5.14.0-687.9.1.el9_8", "5.14.0-687.10.1.el9_8", -1},
	}
	for _, c := range cases {
		if got := rpmvercmp(c.a, c.b); got != c.want {
			t.Errorf("rpmvercmp(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
		if got := rpmvercmp(c.b, c.a); got != -c.want {
			t.Errorf("rpmvercmp(%q, %q) = %d, want %d (antisymmetry)", c.b, c.a, got, -c.want)
		}
	}
}

func TestNewestKernel(t *testing.T) {
	pkgs := []Package{
		{Name: "bash", Version: "5.1.8-9.el9.x86_64"},
		{Name: "kernel", Version: "5.14.0-687.61.1.el9_8.x86_64"},
		{Name: "kernel", Version: "5.14.0-687.66.1.el9_8.x86_64"},
		{Name: "kernel-uek", Version: "5.15.0-325.221.6.6.el9uek.x86_64"},
		{Name: "kernel-uek-core", Version: "5.15.0-326.222.4.el9uek.x86_64"},
	}
	// Running UEK: only UEK kernels count.
	if got := newestKernel(pkgs, "5.15.0-325.221.6.6.el9uek.x86_64"); got != "5.15.0-326.222.4.el9uek.x86_64" {
		t.Fatalf("UEK: got %q", got)
	}
	if got := newestKernel(pkgs, "5.14.0-687.61.1.el9_8.x86_64"); got != "5.14.0-687.66.1.el9_8.x86_64" {
		t.Fatalf("RHCK: got %q", got)
	}
	if got := newestKernel([]Package{{Name: "bash", Version: "1"}}, "6.1.0"); got != "" {
		t.Fatalf("no kernel packages: got %q", got)
	}
}

func TestSplitNVRA(t *testing.T) {
	for in, want := range map[string][2]string{
		"kernel-uek-core-5.15.0-326.222.4.el9uek.x86_64": {"kernel-uek-core", "x86_64"},
		"openssl-libs-1:3.0.7-27.el9.x86_64":             {"openssl-libs", "x86_64"},
		"tzdata-2024a-1.el9.noarch":                      {"tzdata", "noarch"},
	} {
		name, arch, ok := splitNVRA(in)
		if !ok || name != want[0] || arch != want[1] {
			t.Errorf("%s: got %q %q %v", in, name, arch, ok)
		}
	}
	for _, bad := range []string{"", "noarch", "a.b", "name-1.x86_64"} {
		if _, _, ok := splitNVRA(bad); ok {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

const dnfCheckUpdate = `
Security: kernel-uek-core-5.15.0-326.222.4.el9uek.x86_64 is an installed security update
openssl.x86_64                       1:3.0.7-28.el9_4                 ol9_baseos_latest
openssl-libs.x86_64                  1:3.0.7-28.el9_4                 ol9_baseos_latest
python3-a-very-long-package-name-that-wraps.noarch
                                     2.4.1-3.el9                      ol9_appstream
tzdata.noarch                        2024b-2.el9                      ol9_baseos_latest
Obsoleting Packages
grub2-tools.x86_64                   1:2.06-80.0.1.el9                ol9_baseos_latest
`

const dnfUpdateinfo = `ELSA-2026-1001 Important/Sec. openssl-1:3.0.7-28.el9_4.x86_64
ELSA-2026-1002 Moderate/Sec.  openssl-libs-1:3.0.7-28.el9_4.x86_64
ELSA-2026-1003 Critical/Sec.  openssl-libs-1:3.0.7-28.el9_4.x86_64
ELBA-2026-2001 bugfix         tzdata-2024b-2.el9.noarch
`

func TestDnfParsing(t *testing.T) {
	pending := parseDnfCheckUpdate(dnfCheckUpdate)
	if len(pending) != 4 {
		t.Fatalf("want 4 updates (wrapped name joined, obsoletes ignored), got %+v", pending)
	}
	if pending[2].Name != "python3-a-very-long-package-name-that-wraps" || pending[2].Version != "2.4.1-3.el9" {
		t.Fatalf("wrapped line: %+v", pending[2])
	}
	got := mergeAdvisories(pending, parseDnfUpdateinfo(dnfUpdateinfo))
	want := []PendingUpdate{
		{Name: "openssl-libs", Arch: "x86_64", Version: "1:3.0.7-28.el9_4", Security: true, Severity: "Critical", Advisory: "ELSA-2026-1003"},
		{Name: "openssl", Arch: "x86_64", Version: "1:3.0.7-28.el9_4", Security: true, Severity: "Important", Advisory: "ELSA-2026-1001"},
		{Name: "python3-a-very-long-package-name-that-wraps", Arch: "noarch", Version: "2.4.1-3.el9"},
		{Name: "tzdata", Arch: "noarch", Version: "2024b-2.el9"}, // bugfix advisory: not security
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
	if empty := mergeAdvisories(parseDnfCheckUpdate(""), nil); empty == nil || len(empty) != 0 {
		t.Fatal("no updates must be an empty slice (JSON []), not nil")
	}
}

func TestParseAptUpgradable(t *testing.T) {
	got := parseAptUpgradable(`Listing...
curl/jammy-updates 7.81.0-1ubuntu1.17 amd64 [upgradable from: 7.81.0-1ubuntu1.16]
openssl/jammy-updates,jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.10]
libssl3/bookworm-security 3.0.15-1~deb12u1 amd64 [upgradable from: 3.0.14-1~deb12u2]
`)
	want := []PendingUpdate{
		{Name: "libssl3", Arch: "amd64", Version: "3.0.15-1~deb12u1", Security: true},
		{Name: "openssl", Arch: "amd64", Version: "3.0.2-0ubuntu1.15", Security: true},
		{Name: "curl", Arch: "amd64", Version: "7.81.0-1ubuntu1.17"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
}
