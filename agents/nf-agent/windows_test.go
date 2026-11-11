package main

import (
	"reflect"
	"testing"
)

// A trimmed report in the shape collect_windows.ps1 prints (keys as PowerShell writes them).
const winSample = `{"machineGuid":"4C4C4544-0042-3510-8051-B4C04F4D3132",
"os":{"caption":"Microsoft Windows Server 2022 Standard","version":"10.0.20348","ubr":2700,"displayVersion":"21H2","productType":3,"totalKb":8388608,"freeKb":4194304,"uptime":3600,"systemDrive":"C:"},
"cpu":{"name":"Intel(R) Xeon(R) Gold 6338","logical":4},
"disks":[{"id":"C:","fs":"NTFS","label":"","size":107374182400,"free":53687091200},{"id":"E:","fs":"ReFS","label":"Data","size":0,"free":0}],
"services":[{"name":"TermService","display":"Remote Desktop Services","pid":1200},{"name":"LanmanServer","display":"Server","pid":1300},{"name":"MSSQLSERVER","display":"SQL Server (MSSQLSERVER)","pid":2000},{"name":"W3SVC","display":"World Wide Web Publishing Service","pid":1300}],
"programs":[{"name":"Microsoft SQL Server 2022 (64-bit)","version":"16.0.1000.6"},{"name":"7-Zip 23.01 (x64)","version":"23.01"},{"name":"","version":"1"}],
"tcp":[{"a":"0.0.0.0","p":3389,"pid":1200},{"a":"::","p":445,"pid":4},{"a":"0.0.0.0","p":1433,"pid":2000},{"a":"127.0.0.1","p":5000,"pid":3000},{"a":"0.0.0.0","p":8080,"pid":3100}],
"udp":[{"a":"0.0.0.0","p":3389,"pid":1200}],
"processes":[{"pid":1200,"name":"svchost","path":"C:\\Windows\\System32\\svchost.exe","user":"NT AUTHORITY\\NETWORK SERVICE"},{"pid":4,"name":"System","path":"","user":""},{"pid":2000,"name":"sqlservr","path":"C:\\Program Files\\Microsoft SQL Server\\sqlservr.exe","user":"NT SERVICE\\MSSQLSERVER"},{"pid":3100,"name":"node","path":"","user":"CORP\\dev"}],
"firewall":{"current":1,"profiles":[{"type":1,"enabled":true,"inboundAllow":false},{"type":2,"enabled":true,"inboundAllow":false},{"type":4,"enabled":false,"inboundAllow":false}],
 "rules":[
  {"proto":6,"ports":"3389","remote":"*","profiles":2147483647,"app":"C:\\Windows\\system32\\svchost.exe","svc":"termservice","pkg":"","group":"@FirewallAPI.dll,-28752"},
  {"proto":6,"ports":"445","remote":"LocalSubnet","profiles":1,"app":"System","svc":"","pkg":"","group":""},
  {"proto":6,"ports":"*","remote":"*","profiles":7,"app":"C:\\Program Files\\Microsoft SQL Server\\sqlservr.exe","svc":"","pkg":"","group":""},
  {"proto":6,"ports":"80,443,8000-8010","remote":"*","profiles":1,"app":"","svc":"","pkg":"","group":""},
  {"proto":6,"ports":"8080","remote":"*","profiles":1,"app":"C:\\tools\\node.exe","svc":"","pkg":"","group":""},
  {"proto":6,"ports":"RPC-EPMap","remote":"*","profiles":1,"app":"","svc":"","pkg":"","group":""},
  {"proto":256,"ports":"","remote":"*","profiles":2147483647,"app":"","svc":"","pkg":"S-1-15-2-1","group":""},
  {"proto":6,"ports":"*","remote":"*","profiles":2147483647,"app":"System","svc":"","pkg":"","group":"@wlansvc.dll,-36865"},
  {"proto":6,"ports":"9999","remote":"*","profiles":4,"app":"","svc":"","pkg":"","group":""},
  {"proto":1,"ports":"","remote":"*","profiles":7,"app":"","svc":"","pkg":"","group":""}
 ]},
"security":{"defender":{"antivirus":true,"realtime":false,"tamper":null,"signatures":"2026-11-01T02:00:00Z"},
 "av":[],
 "bitlocker":{"protection":0,"conversion":1,"error":""},
 "rdp":{"deny":0,"denyPolicy":null,"nla":1,"nlaPolicy":0,"port":3389},
 "smb1":true,"uac":0,"guestEnabled":false,"admins":["CORP\\Domain Admins","WIN-1\\Administrator"],"secureBoot":true,"sshd":false}}`

func TestWindowsReport(t *testing.T) {
	r, err := parseWinReport([]byte("\xef\xbb\xbf" + winSample + "\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if id := windowsMachineID(r.MachineGUID); id != "4c4c4544004235108051b4c04f4d3132" || !validMachineID(id) {
		t.Fatalf("machine id %q", id)
	}
	osInfo := windowsOS(r, "amd64")
	if osInfo != (OSInfo{ID: "windows", Name: "Windows Server 2022 Standard", Version: "21H2",
		PrettyName: "Windows Server 2022 Standard 21H2", Kernel: "10.0.20348.2700", Arch: "amd64"}) {
		t.Fatalf("os %+v", osInfo)
	}
	disks := windowsDisks(r)
	if len(disks) != 1 || disks[0].Mount != `C:\` || disks[0].UsedBytes != 53687091200 {
		t.Fatalf("disks %+v", disks)
	}
	pkgs, hash := windowsPrograms(r)
	if len(pkgs) != 2 || pkgs[0].Name != "7-Zip 23.01 (x64)" || len(hash) != 64 {
		t.Fatalf("programs %+v %q", pkgs, hash)
	}
	if svcs := windowsServices(r); len(svcs) != 4 || svcs[0].Name != "LanmanServer" {
		t.Fatalf("services %+v", svcs)
	}
}

func TestWindowsListeners(t *testing.T) {
	r, _ := parseWinReport([]byte(winSample))
	got := windowsListeners(r)
	want := []Listener{
		{Proto: "tcp", Address: "::", Port: 445, Process: "System"},
		{Proto: "tcp", Address: "0.0.0.0", Port: 1433, User: `NT SERVICE\MSSQLSERVER`, Process: "sqlservr"},
		{Proto: "tcp", Address: "0.0.0.0", Port: 3389, User: `NT AUTHORITY\NETWORK SERVICE`, Process: "svchost (TermService)"},
		{Proto: "udp", Address: "0.0.0.0", Port: 3389, User: `NT AUTHORITY\NETWORK SERVICE`, Process: "svchost (TermService)"},
		{Proto: "tcp", Address: "127.0.0.1", Port: 5000},
		{Proto: "tcp", Address: "0.0.0.0", Port: 8080, User: `CORP\dev`, Process: "node"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
}

func TestWindowsFirewall(t *testing.T) {
	r, _ := parseWinReport([]byte(winSample))
	fw, profiles := windowsFirewall(r)
	if fw.Kind != "windows" || !fw.Active || fw.DefaultAllow || !fw.RulesKnown || !reflect.DeepEqual(fw.Zones, []string{"domain"}) {
		t.Fatalf("firewall %+v", fw)
	}
	want := []PortRange{
		{Proto: "tcp", From: 80, To: 80, Scope: "any"},
		{Proto: "tcp", From: 135, To: 135, Scope: "any"},     // RPC-EPMap keyword
		{Proto: "tcp", From: 443, To: 443, Scope: "any"},     // port list
		{Proto: "tcp", From: 445, To: 445, Scope: "limited"}, // System rule, LocalSubnet only
		{Proto: "tcp", From: 1433, To: 1433, Scope: "any"},   // program rule, any port: SQL Server's socket
		{Proto: "tcp", From: 3389, To: 3389, Scope: "any"},   // service rule matched through svchost's services
		{Proto: "tcp", From: 8000, To: 8010, Scope: "any"},
		{Proto: "tcp", From: 8080, To: 8080, Scope: "any"}, // program rule matched by file name (path unreadable)
	}
	// Not included: the Store app rule, the Wi-Fi Direct rule, the public-profile rule (not
	// connected to a public network) and the ICMP rule.
	if !reflect.DeepEqual(fw.Allowed, want) {
		t.Fatalf("allowed\n got  %+v\n want %+v", fw.Allowed, want)
	}
	if len(profiles) != 3 || !profiles[0].Active || profiles[2].Enabled || profiles[2].Active {
		t.Fatalf("profiles %+v", profiles)
	}

	// The connected profile is off: the firewall doesn't filter.
	r.Firewall.Current = 4
	if fw, _ := windowsFirewall(r); fw.Active || !reflect.DeepEqual(fw.Zones, []string{"public"}) {
		t.Fatalf("public profile off: %+v", fw)
	}
	r.Firewall = nil
	if fw, profiles := windowsFirewall(r); fw.Active || fw.RulesKnown || len(profiles) != 0 {
		t.Fatalf("no firewall data: %+v", fw)
	}
}

func TestRulePorts(t *testing.T) {
	if _, any := rulePorts("*"); !any {
		t.Fatal("* is every port")
	}
	if _, any := rulePorts(""); !any {
		t.Fatal("empty is every port")
	}
	got, any := rulePorts("RPC, 5985-5986 ,IPHTTPS,Teredo,junk")
	want := []portRange{{"tcp", 49152, 65535}, {"", 5985, 5986}, {"tcp", 443, 443}}
	if any || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestWindowsSecurity(t *testing.T) {
	r, _ := parseWinReport([]byte(winSample))
	_, profiles := windowsFirewall(r)
	s := windowsSecurity(r, profiles)
	if !s.Server || s.BitLocker != "suspended" || s.SystemDrive != "C:" {
		t.Fatalf("security %+v", s)
	}
	if !s.RDP.Enabled || s.RDP.NLA == nil || *s.RDP.NLA || s.RDP.Port != 3389 {
		t.Fatalf("rdp %+v (the NLA policy value 0 overrides the local 1)", s.RDP)
	}
	if s.UAC == nil || *s.UAC || s.SMB1 == nil || !*s.SMB1 || s.Guest == nil || *s.Guest {
		t.Fatalf("flags %+v", s)
	}
	if s.Defender == nil || s.Defender.RealTimeProtection || s.Defender.TamperProtection != nil {
		t.Fatalf("defender %+v", s.Defender)
	}
	if !reflect.DeepEqual(s.Admins, []string{`CORP\Domain Admins`, `WIN-1\Administrator`}) {
		t.Fatalf("admins %+v", s.Admins)
	}

	for _, c := range []struct {
		protection, conversion int
		errText, want          string
	}{
		{1, 1, "", "on"}, {0, 0, "", "off"}, {0, 2, "", "encrypting"},
		{-1, -1, "InvalidNamespace", "unavailable"}, {-1, -1, "AccessDenied", "unknown"},
	} {
		r.Security.BitLocker.Protection, r.Security.BitLocker.Conversion, r.Security.BitLocker.Error = c.protection, c.conversion, c.errText
		if got := windowsSecurity(r, nil).BitLocker; got != c.want {
			t.Errorf("bitlocker %+v: got %s", c, got)
		}
	}
	r.Security.UAC = nil
	if s := windowsSecurity(r, nil); s.UAC == nil || !*s.UAC {
		t.Fatal("EnableLUA absent means UAC is on")
	}
}

func TestDecodeProductState(t *testing.T) {
	for state, want := range map[int64][2]bool{
		397568: {true, true},   // 0x061100 Defender, on, current
		266240: {true, true},   // 0x041000 on, current
		262160: {false, false}, // 0x040010 off, out of date
		393472: {false, true},  // 0x060100 off (snoozed), current
		266256: {true, false},  // 0x041010 on, out of date
	} {
		on, current := decodeProductState(state)
		if on != want[0] || current != want[1] {
			t.Errorf("%d: got %v %v", state, on, current)
		}
	}
}

func TestWindowsUpdates(t *testing.T) {
	u := windowsUpdates([]byte(`{"ok":true,"error":"","pending":[
		{"title":"2026-11 Cumulative Update for Windows Server 2022 (KB5070001)","kb":["5070001"],"severity":"Critical","security":true},
		{"title":"Update for Microsoft Defender Antivirus antimalware platform (KB4052623)","kb":["4052623"],"severity":"","security":false},
		{"title":"2026-11 Security Update for .NET Framework (KB5070100)","kb":["5070100"],"severity":"","security":true}
	],"lastSearch":"2026-11-10T22:00:00Z","reboot":true}`), "2026-11-11T00:00:00Z", "10.0.20348.2700")
	if u.Status != "ok" || u.Manager != "windows-update" || u.RebootRequired == nil || !*u.RebootRequired ||
		u.MetadataAt == nil || *u.MetadataAt != "2026-11-10T22:00:00Z" || u.RunningKernel != "10.0.20348.2700" {
		t.Fatalf("updates %+v", u)
	}
	if len(u.Pending) != 3 || u.Pending[0].Advisory != "KB5070001" || u.Pending[0].Severity != "Critical" ||
		!u.Pending[1].Security || u.Pending[2].Security {
		t.Fatalf("pending %+v", u.Pending)
	}

	failed := windowsUpdates([]byte(`{"ok":false,"error":"Exception from HRESULT: 0x8024402C","pending":[]}`), "2026-11-11T00:00:00Z", "")
	if failed.Status != "unavailable" || failed.Error != "Exception from HRESULT: 0x8024402C" || failed.Pending == nil {
		t.Fatalf("failed %+v", failed)
	}
	if garbage := windowsUpdates([]byte("not json"), "2026-11-11T00:00:00Z", ""); garbage.Status != "unavailable" {
		t.Fatalf("garbage %+v", garbage)
	}
}
