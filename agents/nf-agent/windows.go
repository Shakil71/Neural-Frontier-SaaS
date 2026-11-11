package main

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

// Windows support (Phase 4c). The Windows collector runs collect_windows.ps1 and
// updates_windows.ps1 with the built-in PowerShell; this file turns their JSON into the report.
// Pure functions only, so they are unit-tested on any OS (windows_test.go).

// WindowsSecurity is the security posture of a Windows host.
type WindowsSecurity struct {
	// Server is true on Windows Server editions.
	Server bool `json:"server"`
	// Antivirus products registered with Windows Security Center (client editions only).
	Antivirus []AntivirusProduct `json:"antivirus"`
	// Defender is null when Microsoft Defender Antivirus isn't installed or didn't answer.
	Defender *DefenderStatus `json:"defender"`
	// BitLocker on the system drive: on, off, suspended, encrypting, unavailable (the edition
	// has no BitLocker) or unknown.
	BitLocker   string            `json:"bitlocker"`
	SystemDrive string            `json:"systemDrive"`
	RDP         RDPStatus         `json:"rdp"`
	SMB1        *bool             `json:"smb1"`
	UAC         *bool             `json:"uac"`
	Guest       *bool             `json:"guestEnabled"`
	SecureBoot  *bool             `json:"secureBoot"`
	Admins      []string          `json:"admins"`
	Profiles    []FirewallProfile `json:"firewallProfiles"`
}

type AntivirusProduct struct {
	Name     string `json:"name"`
	Enabled  bool   `json:"enabled"`
	UpToDate bool   `json:"upToDate"`
}

type DefenderStatus struct {
	AntivirusEnabled   bool    `json:"antivirusEnabled"`
	RealTimeProtection bool    `json:"realTimeProtection"`
	TamperProtection   *bool   `json:"tamperProtection"`
	SignaturesUpdated  *string `json:"signaturesUpdatedAt"`
}

type RDPStatus struct {
	Enabled bool  `json:"enabled"`
	NLA     *bool `json:"nla"`
	Port    int   `json:"port"`
}

// FirewallProfile is one Windows Firewall profile (domain, private or public). Active means the
// host is connected to a network of that type now.
type FirewallProfile struct {
	Name                string `json:"name"`
	Active              bool   `json:"active"`
	Enabled             bool   `json:"enabled"`
	DefaultInboundAllow bool   `json:"defaultInboundAllow"`
}

const maxAdmins = 64

// winReport is the JSON collect_windows.ps1 prints. encoding/json matches keys without regard
// to case, so the script's camelCase keys fill these fields.
type winReport struct {
	MachineGUID string `json:"machineGuid"`
	OS          struct {
		Caption        string
		Version        string
		UBR            *int64
		DisplayVersion string
		ProductType    int
		TotalKb        int64
		FreeKb         int64
		Uptime         int64
		SystemDrive    string
	}
	CPU struct {
		Name    string
		Logical int
	}
	Disks []struct {
		ID, FS, Label string
		Size, Free    int64
	}
	Services []struct {
		Name, Display string
		PID           int
	}
	Programs  []struct{ Name, Version string }
	TCP       []winSocket
	UDP       []winSocket
	Processes []struct {
		PID              int
		Name, Path, User string
	}
	Firewall *struct {
		Current  int
		Profiles []struct {
			Type         int
			Enabled      bool
			InboundAllow bool
		}
		Rules []winRule
	}
	Security struct {
		Defender *struct {
			Antivirus  bool
			Realtime   bool
			Tamper     *bool
			Signatures *string
		}
		AV []struct {
			Name  string
			State int64
		}
		BitLocker struct {
			Protection int
			Conversion int
			Error      string
		}
		RDP struct {
			Deny, DenyPolicy, NLA, NLAPolicy, Port *int64
		}
		SMB1         *bool
		UAC          *int64
		GuestEnabled *bool
		Admins       []string
		SecureBoot   *bool
		Sshd         bool
	}
}

type winSocket struct {
	A   string
	P   int
	PID int
}

// winRule is an enabled inbound allow rule of Windows Firewall.
type winRule struct {
	Proto    int    // 6 TCP, 17 UDP, 256 any
	Ports    string // "80,443", "5000-5010", "*", "RPC", "RPC-EPMap", "IPHTTPS"…
	Remote   string // "*" or a list of addresses and keywords
	Profiles int    // bit mask: 1 domain, 2 private, 4 public
	App      string // full path (environment variables expanded), or ""
	Svc      string // service short name, "*" for any service, or ""
	Pkg      string // app container (Microsoft Store app) the rule is limited to, or ""
	Group    string // rule group, as a resource reference ("@wlansvc.dll,-36865")
}

// wifiDirectGroup is the "Wi-Fi Direct driver-only" rule group. Its rules read as "System, any
// port, any address", but Windows applies them to Wi-Fi Direct links only (with them enabled,
// SMB on a normal network stays blocked unless File and Printer Sharing is allowed).
const wifiDirectGroup = "@wlansvc.dll,-36865"

func parseWinReport(data []byte) (winReport, error) {
	var r winReport
	err := json.Unmarshal(bytes.TrimPrefix(bytes.TrimSpace(data), []byte("\xef\xbb\xbf")), &r)
	return r, err
}

// windowsMachineID turns the MachineGuid ("4c4c4544-0042-…") into 32 lowercase hex digits.
func windowsMachineID(guid string) string {
	return strings.ToLower(strings.NewReplacer("-", "", "{", "", "}", "").Replace(strings.TrimSpace(guid)))
}

func windowsOS(r winReport, arch string) OSInfo {
	name := strings.TrimSpace(strings.TrimPrefix(r.OS.Caption, "Microsoft "))
	if name == "" {
		name = "Windows"
	}
	kernel := r.OS.Version
	if r.OS.UBR != nil && kernel != "" {
		kernel += "." + strconv.FormatInt(*r.OS.UBR, 10)
	}
	version := r.OS.DisplayVersion
	if version == "" {
		version = r.OS.Version
	}
	pretty := name
	if r.OS.DisplayVersion != "" {
		pretty += " " + r.OS.DisplayVersion
	}
	return OSInfo{
		ID: "windows", Name: clip(name, 128), Version: clip(version, 64),
		PrettyName: clip(pretty, 256), Kernel: clip(kernel, 128), Arch: arch,
	}
}

func windowsDisks(r winReport) []Disk {
	out := []Disk{}
	for _, d := range r.Disks {
		if d.Size <= 0 || len(out) >= maxDisks {
			continue
		}
		device := d.ID
		if d.Label != "" {
			device = d.Label + " (" + d.ID + ")"
		}
		used := d.Size - d.Free
		if used < 0 {
			used = 0
		}
		out = append(out, Disk{
			Mount: clip(d.ID+`\`, 512), Device: clip(device, 256), FsType: clip(d.FS, 32),
			SizeBytes: d.Size, UsedBytes: used,
		})
	}
	return out
}

func windowsServices(r winReport) []Service {
	out := []Service{}
	for _, s := range r.Services {
		if len(out) >= maxServices {
			break
		}
		out = append(out, Service{Name: clip(s.Name, 256), Description: clip(s.Display, 512)})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

// windowsPrograms reuses the Linux package list format ("name\tversion" lines) so the list is
// sorted, de-duplicated and hashed the same way.
func windowsPrograms(r winReport) ([]Package, string) {
	clean := strings.NewReplacer("\t", " ", "\n", " ", "\r", " ")
	var b strings.Builder
	for _, p := range r.Programs {
		name := strings.TrimSpace(clean.Replace(p.Name))
		if name == "" {
			continue
		}
		b.WriteString(name + "\t" + strings.TrimSpace(clean.Replace(p.Version)) + "\n")
	}
	return parsePackages(b.String())
}

type winProcess struct{ name, path, user string }

func (r winReport) processes() map[int]winProcess {
	out := map[int]winProcess{}
	for _, p := range r.Processes {
		out[p.PID] = winProcess{name: p.Name, path: p.Path, user: p.User}
	}
	return out
}

func (r winReport) servicesByPID() map[int][]string {
	out := map[int][]string{}
	for _, s := range r.Services {
		if s.PID > 0 {
			out[s.PID] = append(out[s.PID], s.Name)
		}
	}
	for _, names := range out {
		sort.Strings(names)
	}
	return out
}

// windowsListeners reports listening sockets. A shared svchost process is named after the
// services it hosts, which is what an administrator recognises.
func windowsListeners(r winReport) []Listener {
	procs, services := r.processes(), r.servicesByPID()
	var all []Listener
	add := func(list []winSocket, proto string) {
		for _, s := range list {
			if s.P <= 0 || s.P > 65535 || s.A == "" {
				continue
			}
			p := procs[s.PID]
			name := p.name
			if svc := services[s.PID]; len(svc) > 0 && (name == "" || strings.EqualFold(name, "svchost")) {
				name = "svchost (" + strings.Join(svc, ", ") + ")"
			} else if s.PID == 4 && name == "" {
				name = "System"
			}
			all = append(all, Listener{Proto: proto, Address: s.A, Port: s.P, User: p.user, Process: name})
		}
	}
	add(r.TCP, "tcp")
	add(r.UDP, "udp")
	return mergeListeners(all)
}

var profileNames = []struct {
	bit  int
	name string
}{{1, "domain"}, {2, "private"}, {4, "public"}}

// windowsFirewall maps Windows Firewall to the common model: active when every profile the
// host is connected to is on, default-allow when one of them admits unmatched traffic, and the
// allowed ports from the enabled inbound allow rules of those profiles.
//
// Rules limited to a program or a service apply to that program's sockets only, so they are
// expanded to the ports the program listens on now. Block rules (which win over allow rules)
// aren't evaluated, so a port may be reported as allowed when a block rule closes it.
func windowsFirewall(r winReport) (Firewall, []FirewallProfile) {
	fw := Firewall{Kind: "windows", Zones: []string{}, Allowed: []PortRange{}}
	profiles := []FirewallProfile{}
	if r.Firewall == nil {
		return fw, profiles
	}
	current := r.Firewall.Current
	if current == 0 {
		current = 7 // not connected to any network: all profiles apply
	}
	fw.Active = true
	for _, pn := range profileNames {
		for _, p := range r.Firewall.Profiles {
			if p.Type != pn.bit {
				continue
			}
			active := current&pn.bit != 0
			profiles = append(profiles, FirewallProfile{Name: pn.name, Active: active, Enabled: p.Enabled, DefaultInboundAllow: p.InboundAllow})
			if active {
				fw.Zones = append(fw.Zones, pn.name)
				fw.Active = fw.Active && p.Enabled
				fw.DefaultAllow = fw.DefaultAllow || p.InboundAllow
			}
		}
	}
	if len(fw.Zones) == 0 {
		fw.Active = false
		return fw, profiles
	}
	fw.RulesKnown = true

	procs, services := r.processes(), r.servicesByPID()
	type sock struct {
		proto string
		port  int
		pid   int
	}
	var socks []sock
	for _, s := range r.TCP {
		socks = append(socks, sock{"tcp", s.P, s.PID})
	}
	for _, s := range r.UDP {
		socks = append(socks, sock{"udp", s.P, s.PID})
	}
	var allowed []PortRange
	for _, rule := range r.Firewall.Rules {
		// Rules for a Store app's container admit only that app, which doesn't serve the
		// network, so they open nothing for the sockets reported here.
		if rule.Profiles&current == 0 || strings.TrimSpace(rule.Pkg) != "" || strings.EqualFold(rule.Group, wifiDirectGroup) {
			continue
		}
		protos := ruleProtocols(rule.Proto)
		if len(protos) == 0 {
			continue
		}
		scope := "any"
		if rem := strings.TrimSpace(rule.Remote); rem != "" && rem != "*" {
			scope = "limited"
		}
		ranges, wildcard := rulePorts(rule.Ports)
		app := strings.TrimSpace(rule.App)
		svc := strings.TrimSpace(rule.Svc)
		if svc == "*" {
			svc = ""
		}
		if app == "" && svc == "" {
			for _, proto := range protos {
				if wildcard {
					allowed = append(allowed, PortRange{Proto: proto, From: 1, To: 65535, Scope: scope})
				}
				for _, rg := range ranges {
					if rg.proto == "" || rg.proto == proto {
						allowed = append(allowed, PortRange{Proto: proto, From: rg.from, To: rg.to, Scope: scope})
					}
				}
			}
			continue
		}
		// Program or service rule: only that program's current sockets.
		for _, s := range socks {
			if !containsString(protos, s.proto) {
				continue
			}
			if app != "" && !ruleProgramMatches(app, s.pid, procs[s.pid]) {
				continue
			}
			if svc != "" && !containsFold(services[s.pid], svc) {
				continue
			}
			in := wildcard
			for _, rg := range ranges {
				if (rg.proto == "" || rg.proto == s.proto) && s.port >= rg.from && s.port <= rg.to {
					in = true
				}
			}
			if in {
				allowed = append(allowed, PortRange{Proto: s.proto, From: s.port, To: s.port, Scope: scope})
			}
		}
	}
	fw.Allowed = normaliseRanges(allowed)
	return fw, profiles
}

// ruleProgramMatches says whether a rule's program is the process with this pid. "System" is
// the kernel (pid 4, which serves SMB and HTTP.sys). When the process path can't be read, the
// file name is compared instead.
func ruleProgramMatches(app string, pid int, p winProcess) bool {
	if strings.EqualFold(app, "System") {
		return pid == 4
	}
	if p.path != "" {
		return strings.EqualFold(p.path, app)
	}
	base := app[strings.LastIndexAny(app, `\/`)+1:]
	return p.name != "" && strings.EqualFold(base, p.name+".exe")
}

func ruleProtocols(p int) []string {
	switch p {
	case 6:
		return []string{"tcp"}
	case 17:
		return []string{"udp"}
	case 256:
		return []string{"tcp", "udp"}
	}
	return nil
}

type portRange struct {
	proto    string // "" for the rule's own protocols
	from, to int
}

// rulePorts parses a rule's LocalPorts. Keywords stand for the ports Windows assigns them:
// RPC is the dynamic RPC range, RPC-EPMap the endpoint mapper, IPHTTPS port 443.
func rulePorts(spec string) (ranges []portRange, wildcard bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" || spec == "*" {
		return nil, true
	}
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		switch strings.ToLower(part) {
		case "*":
			return nil, true
		case "rpc":
			ranges = append(ranges, portRange{"tcp", 49152, 65535})
			continue
		case "rpc-epmap":
			ranges = append(ranges, portRange{"tcp", 135, 135})
			continue
		case "iphttps", "iphttpsin", "iphttpsout":
			ranges = append(ranges, portRange{"tcp", 443, 443})
			continue
		}
		if from, to, ok := parseRange(part, "-"); ok {
			ranges = append(ranges, portRange{"", from, to})
		}
	}
	return ranges, false
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func containsFold(list []string, s string) bool {
	for _, v := range list {
		if strings.EqualFold(v, s) {
			return true
		}
	}
	return false
}

// decodeProductState reads Security Center's productState: the middle byte says whether the
// product is on (0x10 or 0x11), the low byte whether its signatures are current (0x00).
func decodeProductState(state int64) (enabled, upToDate bool) {
	mid := (state >> 8) & 0xFF
	return mid == 0x10 || mid == 0x11, state&0xFF == 0
}

func boolPtr(b bool) *bool { return &b }

// regFlag reads a DWORD flag; a policy value wins over the local setting.
func regFlag(policy, local *int64) *int64 {
	if policy != nil {
		return policy
	}
	return local
}

func windowsSecurity(r winReport, profiles []FirewallProfile) *WindowsSecurity {
	s := r.Security
	out := &WindowsSecurity{
		Server:      r.OS.ProductType > 1,
		Antivirus:   []AntivirusProduct{},
		SystemDrive: clip(r.OS.SystemDrive, 8),
		SMB1:        s.SMB1,
		Guest:       s.GuestEnabled,
		SecureBoot:  s.SecureBoot,
		Admins:      []string{},
		Profiles:    profiles,
	}
	for _, av := range s.AV {
		if len(out.Antivirus) >= 16 {
			break
		}
		on, current := decodeProductState(av.State)
		out.Antivirus = append(out.Antivirus, AntivirusProduct{Name: clip(av.Name, 128), Enabled: on, UpToDate: current})
	}
	if d := s.Defender; d != nil {
		out.Defender = &DefenderStatus{
			AntivirusEnabled: d.Antivirus, RealTimeProtection: d.Realtime,
			TamperProtection: d.Tamper, SignaturesUpdated: d.Signatures,
		}
	}
	switch {
	case s.BitLocker.Error == "InvalidNamespace" || s.BitLocker.Error == "InvalidClass":
		out.BitLocker = "unavailable"
	case s.BitLocker.Error != "":
		out.BitLocker = "unknown"
	case s.BitLocker.Protection == 1:
		out.BitLocker = "on"
	case s.BitLocker.Conversion == 2:
		out.BitLocker = "encrypting"
	case s.BitLocker.Protection == 0 && s.BitLocker.Conversion == 1:
		out.BitLocker = "suspended"
	case s.BitLocker.Protection == 0:
		out.BitLocker = "off"
	default:
		out.BitLocker = "unknown"
	}
	deny := regFlag(s.RDP.DenyPolicy, s.RDP.Deny)
	out.RDP.Enabled = deny != nil && *deny == 0
	if nla := regFlag(s.RDP.NLAPolicy, s.RDP.NLA); nla != nil {
		out.RDP.NLA = boolPtr(*nla != 0)
	}
	out.RDP.Port = 3389
	if s.RDP.Port != nil && *s.RDP.Port > 0 && *s.RDP.Port <= 65535 {
		out.RDP.Port = int(*s.RDP.Port)
	}
	// EnableLUA defaults to on when the value is absent.
	out.UAC = boolPtr(s.UAC == nil || *s.UAC != 0)
	for _, a := range s.Admins {
		if a = strings.TrimSpace(a); a != "" && len(out.Admins) < maxAdmins {
			out.Admins = append(out.Admins, clip(a, 128))
		}
	}
	sort.Strings(out.Admins)
	return out
}

// winUpdates is the JSON updates_windows.ps1 prints.
type winUpdates struct {
	OK      bool
	Error   string
	Pending []struct {
		Title    string
		KB       []string
		Severity string
		Security bool
	}
	LastSearch *string
	Reboot     *bool
}

// windowsUpdates maps the Windows Update Agent's answer to the common patch model. A pending
// update counts as a security update when Microsoft classifies it as one or rates its severity.
func windowsUpdates(data []byte, checkedAt, build string) Updates {
	u := Updates{
		Status: "unavailable", Manager: "windows-update", Pending: []PendingUpdate{},
		CheckedAt: checkedAt, RunningKernel: clip(build, 128),
	}
	var w winUpdates
	if err := json.Unmarshal(bytes.TrimPrefix(bytes.TrimSpace(data), []byte("\xef\xbb\xbf")), &w); err != nil {
		u.Error = "Windows Update gave no readable answer"
		return u
	}
	if !w.OK {
		u.Error = clip(firstNonEmptyString(strings.TrimSpace(w.Error), "Windows Update search failed"), 300)
		return u
	}
	var pending []PendingUpdate
	for _, p := range w.Pending {
		kb := ""
		if len(p.KB) > 0 && p.KB[0] != "" {
			kb = "KB" + strings.TrimPrefix(p.KB[0], "KB")
		}
		severity := p.Severity
		pending = append(pending, PendingUpdate{
			Name: clip(p.Title, 256), Version: clip(kb, 128), Advisory: clip(kb, 64),
			Security: p.Security || severity != "", Severity: clip(severity, 32),
		})
	}
	u.Status, u.Pending = "ok", sortPending(pending)
	u.MetadataAt = w.LastSearch
	u.RebootRequired = w.Reboot
	return u
}

func firstNonEmptyString(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
