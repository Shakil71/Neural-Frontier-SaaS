package main

// Inventory is the report sent to POST /api/agent/v1/inventory. Field names and limits
// match AgentInventorySchema in packages/contracts/src/servers.ts.
type Inventory struct {
	AgentVersion   string      `json:"agentVersion"`
	CollectedAt    string      `json:"collectedAt"`
	Hostname       string      `json:"hostname"`
	MachineID      string      `json:"machineId"`
	OS             OSInfo      `json:"os"`
	CPU            CPUInfo     `json:"cpu"`
	Memory         MemoryInfo  `json:"memory"`
	UptimeSeconds  int64       `json:"uptimeSeconds"`
	LoadAverage    [3]float64  `json:"loadAverage"`
	Disks          []Disk      `json:"disks"`
	Interfaces     []Interface `json:"interfaces"`
	Services       []Service   `json:"services"`
	Packages       []Package   `json:"packages,omitempty"`
	PackageManager string      `json:"packageManager"`
	PackagesHash   string      `json:"packagesHash"`
	PackageCount   int         `json:"packageCount"`
}

type OSInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Version    string `json:"version"`
	PrettyName string `json:"prettyName"`
	Kernel     string `json:"kernel"`
	Arch       string `json:"arch"`
}

type CPUInfo struct {
	Model string `json:"model"`
	Cores int    `json:"cores"`
}

type MemoryInfo struct {
	TotalBytes     int64 `json:"totalBytes"`
	AvailableBytes int64 `json:"availableBytes"`
}

type Disk struct {
	Mount     string `json:"mount"`
	Device    string `json:"device"`
	FsType    string `json:"fsType"`
	SizeBytes int64  `json:"sizeBytes"`
	UsedBytes int64  `json:"usedBytes"`
}

type Interface struct {
	Name      string   `json:"name"`
	MAC       string   `json:"mac"`
	Addresses []string `json:"addresses"`
}

type Service struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Limits mirror the server-side schema so a large host never produces a rejected report.
const (
	maxServices = 2000
	maxPackages = 10000
	maxDisks    = 128
	maxIfaces   = 64
	maxAddrs    = 32
)

// clip shortens s to at most n bytes without splitting a UTF-8 sequence.
func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := n
	for cut > 0 && (s[cut]&0xC0) == 0x80 {
		cut--
	}
	return s[:cut]
}
