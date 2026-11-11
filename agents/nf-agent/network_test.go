package main

import (
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestDecodeProcAddr(t *testing.T) {
	cases := []struct {
		in   string
		ip   string
		port int
	}{
		{"0100007F:0035", "127.0.0.1", 53},
		{"00000000:0016", "0.0.0.0", 22},
		{"00000000000000000000000000000000:21C3", "::", 8643},
		{"00000000000000000000000001000000:0CEA", "::1", 3306},
		// IPv4-mapped IPv6 (::ffff:192.168.1.10) is reported as IPv4.
		{"0000000000000000FFFF00000A01A8C0:1F90", "192.168.1.10", 8080},
		{"000080FE00000000FF5D15022C1B3AFE:0050", "fe80::215:5dff:fe3a:1b2c", 80},
	}
	for _, c := range cases {
		ip, port, ok := decodeProcAddr(c.in)
		if !ok || ip != c.ip || port != c.port {
			t.Errorf("%s: got %s %d %v, want %s %d", c.in, ip, port, ok, c.ip, c.port)
		}
	}
	for _, bad := range []string{"", "0100007F", "XYZ:0035", "0100007F:ZZ", "01007F:0035"} {
		if _, _, ok := decodeProcAddr(bad); ok {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

const procTCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 21001 1 0000000000000000 100 0 0 10 0
   1: 0100007F:0CEA 00000000:0000 0A 00000000:00000000 00:00000000 00000000    27        0 21002 1 0000000000000000 100 0 0 10 0
   2: 0A01A8C0:0016 0B01A8C0:D2F0 01 00000000:00000000 02:000A7B2E 00000000     0        0 21003 4 0000000000000000 20 4 29 10 -1
`

const procUDP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  10: 0100007F:0143 00000000:0000 07 00000000:00000000 00:00000000 00000000   990        0 31001 2 0000000000000000 0
  11: 0A01A8C0:A1B2 08080808:0035 01 00000000:00000000 00:00000000 00000000     0        0 31002 2 0000000000000000 0
`

func TestParseProcNet(t *testing.T) {
	tcp := parseProcNet(procTCP, "tcp")
	if len(tcp) != 2 {
		t.Fatalf("want 2 listening TCP sockets (established one skipped), got %+v", tcp)
	}
	if tcp[0].Address != "0.0.0.0" || tcp[0].Port != 22 || tcp[0].uid != 0 || tcp[0].inode != "21001" {
		t.Errorf("unexpected first socket: %+v", tcp[0])
	}
	if tcp[1].Address != "127.0.0.1" || tcp[1].Port != 3306 || tcp[1].uid != 27 {
		t.Errorf("unexpected second socket: %+v", tcp[1])
	}
	udp := parseProcNet(procUDP, "udp")
	if len(udp) != 1 || udp[0].Port != 323 || udp[0].Proto != "udp" {
		t.Fatalf("want only the unconnected UDP socket, got %+v", udp)
	}
}

func TestMergeListeners(t *testing.T) {
	in := []Listener{
		{Proto: "tcp", Address: "::", Port: 443},
		{Proto: "tcp", Address: "0.0.0.0", Port: 22},
		{Proto: "tcp", Address: "::", Port: 443}, // SO_REUSEPORT duplicate
		{Proto: "udp", Address: "0.0.0.0", Port: 22},
	}
	out := mergeListeners(in)
	got := []string{}
	for _, l := range out {
		got = append(got, l.Proto+"/"+l.Address+"/"+strconv.Itoa(l.Port))
	}
	want := []string{"tcp/0.0.0.0/22", "udp/0.0.0.0/22", "tcp/::/443"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if mergeListeners(nil) == nil {
		t.Fatal("must return an empty slice, not nil (JSON [] not null)")
	}
}

func TestParsePasswd(t *testing.T) {
	m := parsePasswd("root:x:0:0:root:/root:/bin/bash\nmysql:x:27:27::/var/lib/mysql:/sbin/nologin\nbroken\n")
	if m[0] != "root" || m[27] != "mysql" || len(m) != 2 {
		t.Fatalf("got %v", m)
	}
}

const zonePublic = `public (default, active)
  target: default
  icmp-block-inversion: no
  interfaces: eth0
  sources:
  services: cockpit dhcpv6-client ssh
  ports: 8643/tcp 6000-6010/udp bogus
  protocols:
  forward: yes
  masquerade: no
  rich rules:
`

const zoneTrusted = `trusted (active)
  target: ACCEPT
  interfaces:
  sources: 10.0.0.0/8
  services:
  ports:
`

func TestFirewalldAllowed(t *testing.T) {
	if got := parseActiveZones("public (default)\n  interfaces: eth0\ntrusted\n  sources: 10.0.0.0/8\n"); !reflect.DeepEqual(got, []string{"public", "trusted"}) {
		t.Fatalf("active zones: %v", got)
	}
	services := map[string][]string{"ssh": {"22/tcp"}, "cockpit": {"9090/tcp"}, "dhcpv6-client": {"546/udp"}}
	zones := []firewalldZone{zoneFromInfo("public", zonePublic), zoneFromInfo("trusted", zoneTrusted)}
	allowed, defaultAllow := firewalldAllowed(zones, func(s string) []string { return services[s] })
	if defaultAllow {
		t.Fatal("a source-bound ACCEPT zone must not make the whole host default-allow")
	}
	want := []PortRange{
		{"tcp", 0, 65535, "limited"},
		{"udp", 0, 65535, "limited"},
		{"tcp", 22, 22, "any"},
		{"udp", 546, 546, "any"},
		{"udp", 6000, 6010, "any"},
		{"tcp", 8643, 8643, "any"},
		{"tcp", 9090, 9090, "any"},
	}
	if !reflect.DeepEqual(allowed, want) {
		t.Fatalf("got %+v\nwant %+v", allowed, want)
	}
	_, all := firewalldAllowed([]firewalldZone{{Name: "trusted", Target: "ACCEPT", Interfaces: []string{"eth0"}}},
		func(string) []string { return nil })
	if !all {
		t.Fatal("an interface-bound ACCEPT zone admits everything")
	}
}

func TestParseUfwRules(t *testing.T) {
	text := `*filter
### tuple ### allow tcp 22 0.0.0.0/0 any 0.0.0.0/0 in
-A ufw-user-input -p tcp --dport 22 -j ACCEPT
### tuple ### limit tcp 2222 0.0.0.0/0 any 0.0.0.0/0 in
### tuple ### allow any 53 0.0.0.0/0 any 192.168.0.0/16 in
### tuple ### allow tcp 80,443,8000:8010 ::/0 any ::/0 in
### tuple ### deny tcp 3306 0.0.0.0/0 any 0.0.0.0/0 in
### tuple ### allow tcp 25 0.0.0.0/0 any 0.0.0.0/0 out
`
	got := normaliseRanges(parseUfwRules(text))
	want := []PortRange{
		{"tcp", 22, 22, "any"},
		{"tcp", 53, 53, "limited"},
		{"udp", 53, 53, "limited"},
		{"tcp", 80, 80, "any"},
		{"tcp", 443, 443, "any"},
		{"tcp", 2222, 2222, "any"},
		{"tcp", 8000, 8010, "any"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestParseSSHDConfig(t *testing.T) {
	files := map[string]string{
		"/etc/ssh/sshd_config": `# main
Include /etc/ssh/sshd_config.d/*.conf
PermitRootLogin yes
Port 22
Port 2222
PasswordAuthentication yes
Match User backup
  PasswordAuthentication yes
  PermitEmptyPasswords yes
`,
		// Included first, so its values win (first value of a keyword wins).
		"/etc/ssh/sshd_config.d/50-redhat.conf":  "ChallengeResponseAuthentication no\nUsePAM yes\n",
		"/etc/ssh/sshd_config.d/10-harden.conf":  "PasswordAuthentication=no\nPermitRootLogin without-password\n",
		"/etc/ssh/sshd_config.d/ignored.disable": "PermitRootLogin yes\n",
	}
	read := func(p string) string { return files[p] }
	glob := func(pat string) []string {
		var out []string
		for p := range files {
			if strings.HasPrefix(p, "/etc/ssh/sshd_config.d/") && strings.HasSuffix(p, ".conf") && pat == "/etc/ssh/sshd_config.d/*.conf" {
				out = append(out, p)
			}
		}
		return out
	}
	got := parseSSHDConfig("/etc/ssh/sshd_config", read, glob)
	want := SSHConfig{
		Present: true, Ports: []int{22, 2222},
		PermitRootLogin:              "prohibit-password",
		PasswordAuthentication:       "no",
		KbdInteractiveAuthentication: "no",
		UsePAM:                       "yes",
		PermitEmptyPasswords:         "no", // only inside a Match block
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}

	defaults := parseSSHDConfig("/etc/ssh/sshd_config", func(string) string { return "# nothing set\n" }, glob)
	if defaults.PermitRootLogin != "prohibit-password" || defaults.PasswordAuthentication != "yes" ||
		!reflect.DeepEqual(defaults.Ports, []int{22}) {
		t.Fatalf("OpenSSH defaults expected, got %+v", defaults)
	}
	if missing := parseSSHDConfig("/nope", func(string) string { return "" }, glob); missing.Present {
		t.Fatal("no sshd_config means no SSH server configuration")
	}
}
