# Neural Frontier agent: pending Windows updates, read-only.
# Asks the Windows Update Agent for the result of its last scan (offline search: no download,
# no network), the same way the Linux agent reads dnf and apt from their local caches.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$o = [ordered]@{ ok = $false; error = ''; pending = @(); lastSearch = $null; reboot = $null }
$securityCategory = '0fa1201d-4330-4fa8-8ae9-b877473b6441'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $searcher.Online = $false
  $result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
  $o.pending = @(foreach ($u in $result.Updates) {
    $security = $false
    foreach ($c in $u.Categories) { if ($c.CategoryID -eq $securityCategory) { $security = $true } }
    [ordered]@{
      title    = [string]$u.Title
      kb       = @($u.KBArticleIDs | ForEach-Object { [string]$_ })
      severity = [string]$u.MsrcSeverity
      security = $security
    }
  })
  $o.ok = $true
} catch {
  $o.error = [string]$_.Exception.Message
}
try {
  # LastSearchSuccessDate is in UTC.
  $d = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastSearchSuccessDate
  if ($d -is [datetime] -and $d.Year -gt 1601) { $o.lastSearch = $d.ToString('yyyy-MM-ddTHH:mm:ssZ') }
} catch { }
try {
  $o.reboot = [bool](New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired
} catch { }
if (-not $o.reboot) {
  foreach ($k in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
  )) {
    if (Test-Path -LiteralPath $k) { $o.reboot = $true }
  }
}
$o | ConvertTo-Json -Depth 5 -Compress
