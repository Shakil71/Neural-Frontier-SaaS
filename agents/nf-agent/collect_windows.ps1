# Neural Frontier agent: Windows inventory and security posture, read-only.
# Run by nf-agent.exe through the built-in Windows PowerShell; prints one JSON object.
# Only reads: CIM/WMI, the registry, Windows Firewall (HNetCfg.FwPolicy2) and Defender status.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Iso($d) {
  if ($d -is [datetime] -and $d.Year -gt 1601) { $d.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $null }
}
function Reg($path, $name) {
  try { (Get-ItemProperty -LiteralPath $path -Name $name -ErrorAction Stop).$name } catch { $null }
}

$r = [ordered]@{}
$r.machineGuid = [string](Reg 'HKLM:\SOFTWARE\Microsoft\Cryptography' 'MachineGuid')

$os = Get-CimInstance Win32_OperatingSystem
$cv = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$uptime = 0
if ($os.LastBootUpTime) { $uptime = [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds }
$r.os = [ordered]@{
  caption        = [string]$os.Caption
  version        = [string]$os.Version
  ubr            = Reg $cv 'UBR'
  displayVersion = [string](Reg $cv 'DisplayVersion')
  productType    = [int]$os.ProductType
  totalKb        = [int64]$os.TotalVisibleMemorySize
  freeKb         = [int64]$os.FreePhysicalMemory
  uptime         = $uptime
  systemDrive    = [string]$env:SystemDrive
}
$cpu = @(Get-CimInstance Win32_Processor)
$r.cpu = [ordered]@{
  name    = if ($cpu.Count) { ([string]$cpu[0].Name).Trim() } else { '' }
  logical = [int](($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum)
}

$r.disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [ordered]@{ id = [string]$_.DeviceID; fs = [string]$_.FileSystem; label = [string]$_.VolumeName; size = [int64]$_.Size; free = [int64]$_.FreeSpace }
})

$services = @(Get-CimInstance Win32_Service -Filter "State='Running'")
$r.services = @($services | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; display = [string]$_.DisplayName; pid = [int]$_.ProcessId }
})

# Installed programs (Programs and Features), without system components and update entries.
$uninstall = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$r.programs = @(Get-ItemProperty -Path $uninstall | Where-Object {
  $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and -not $_.ReleaseType
} | ForEach-Object { [ordered]@{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion } })

# Listening sockets and the processes that own them.
$r.tcp = @(Get-NetTCPConnection -State Listen | ForEach-Object {
  [ordered]@{ a = [string]$_.LocalAddress; p = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
})
$r.udp = @(Get-NetUDPEndpoint | ForEach-Object {
  [ordered]@{ a = [string]$_.LocalAddress; p = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
})
$pids = @(@($r.tcp) + @($r.udp) | ForEach-Object { $_.pid } | Sort-Object -Unique)
# The owner needs elevation (the service runs as LocalSystem); without it, names only.
$procs = $null
try { $procs = Get-Process -Id $pids -IncludeUserName -ErrorAction SilentlyContinue } catch { }
if (-not $procs) { $procs = Get-Process -Id $pids -ErrorAction SilentlyContinue }
$r.processes = @($procs | ForEach-Object {
  [ordered]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; path = [string]$_.Path; user = [string]$_.UserName }
})

# Windows Defender Firewall: profiles and the enabled inbound allow rules.
try {
  $fw = New-Object -ComObject HNetCfg.FwPolicy2
  $r.firewall = [ordered]@{
    current  = [int]$fw.CurrentProfileTypes
    profiles = @(1, 2, 4 | ForEach-Object {
      [ordered]@{ type = $_; enabled = [bool]$fw.FirewallEnabled($_); inboundAllow = ([int]$fw.DefaultInboundAction($_) -eq 1) }
    })
    rules    = @($fw.Rules | Where-Object { $_.Enabled -and $_.Direction -eq 1 -and $_.Action -eq 1 } | ForEach-Object {
      [ordered]@{
        proto    = [int]$_.Protocol
        ports    = [string]$_.LocalPorts
        remote   = [string]$_.RemoteAddresses
        profiles = [int]$_.Profiles
        app      = [Environment]::ExpandEnvironmentVariables([string]$_.ApplicationName)
        svc      = [string]$_.ServiceName
        pkg      = [string]$_.LocalAppPackageId
        group    = [string]$_.Grouping
      }
    })
  }
} catch { $r.firewall = $null }

# Security posture.
$sec = [ordered]@{}
try {
  $mp = Get-MpComputerStatus -ErrorAction Stop
  $sec.defender = [ordered]@{
    antivirus  = [bool]$mp.AntivirusEnabled
    realtime   = [bool]$mp.RealTimeProtectionEnabled
    tamper     = $mp.IsTamperProtected
    signatures = Iso $mp.AntivirusSignatureLastUpdated
  }
} catch { $sec.defender = $null }
# Security Center lists every registered antivirus product (Windows client editions only).
$sec.av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object {
  [ordered]@{ name = [string]$_.displayName; state = [int64]$_.productState }
})
try {
  $v = Get-CimInstance -Namespace root/cimv2/Security/MicrosoftVolumeEncryption -ClassName Win32_EncryptableVolume -Filter "DriveLetter='$($env:SystemDrive)'" -ErrorAction Stop
  if ($v) {
    $sec.bitlocker = [ordered]@{ protection = [int]$v.ProtectionStatus; conversion = [int]$v.ConversionStatus; error = '' }
  } else {
    $sec.bitlocker = [ordered]@{ protection = -1; conversion = -1; error = 'NotFound' }
  }
} catch {
  $sec.bitlocker = [ordered]@{ protection = -1; conversion = -1; error = [string]$_.Exception.NativeErrorCode }
}
$ts = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
$tsPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
$sec.rdp = [ordered]@{
  deny       = Reg $ts 'fDenyTSConnections'
  denyPolicy = Reg $tsPolicy 'fDenyTSConnections'
  nla        = Reg "$ts\WinStations\RDP-Tcp" 'UserAuthentication'
  nlaPolicy  = Reg $tsPolicy 'UserAuthentication'
  port       = Reg "$ts\WinStations\RDP-Tcp" 'PortNumber'
}
try { $sec.smb1 = [bool](Get-SmbServerConfiguration -ErrorAction Stop).EnableSMB1Protocol } catch { $sec.smb1 = $null }
$sec.uac = Reg 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'EnableLUA'
$guest = Get-CimInstance Win32_UserAccount -Filter "LocalAccount=True AND SID LIKE '%-501'"
$sec.guestEnabled = if ($guest) { -not [bool]@($guest)[0].Disabled } else { $null }
try {
  $group = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544').Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
  $sec.admins = @(([ADSI]"WinNT://./$group,group").psbase.Invoke('Members') | ForEach-Object {
    $p = ([string]$_.GetType().InvokeMember('ADsPath', 'GetProperty', $null, $_, $null)).Split('/')
    if ($p.Count -ge 2) { $p[-2] + '\' + $p[-1] } else { $p[-1] }
  })
} catch { $sec.admins = $null }
try { $sec.secureBoot = [bool](Confirm-SecureBootUEFI -ErrorAction Stop) } catch { $sec.secureBoot = $null }
$sec.sshd = [bool](Get-Service -Name sshd -ErrorAction SilentlyContinue)
$r.security = $sec

$r | ConvertTo-Json -Depth 6 -Compress
