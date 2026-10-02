[CmdletBinding()]
param(
  [Parameter(Position=0,Mandatory=$true)][string]$Slug,
  [Parameter(Position=1)][string]$Command,
  [string]$Intent,[string]$Why,[ValidateSet('risky')][string]$Risk,[string]$File,
  [ValidateRange(1,600)][int]$Timeout,[ValidateSet('upload')][string]$Kind,
  [ValidateSet('json')][string]$Format,[string]$Field,[switch]$Quiet,[switch]$DryRun
)
$ErrorActionPreference='Stop'
function Read-FirstConfig([string[]]$paths) { foreach($p in $paths) { if(Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw).Trim() } } }
$Base=if($env:TEMPSHELL_BASE){$env:TEMPSHELL_BASE}elseif($env:CLIP_BASE){$env:CLIP_BASE}else{Read-FirstConfig @((Join-Path $HOME '.claude\tempshell-base'),(Join-Path $HOME '.claude\clip-base'))}
if(-not $Base){$Base='https://c.313b.be'}
$Token=if($env:TEMPSHELL_TOKEN){$env:TEMPSHELL_TOKEN}elseif($env:CLIP_TOKEN){$env:CLIP_TOKEN}else{Read-FirstConfig @((Join-Path $HOME '.claude\tempshell-token'),(Join-Path $HOME '.claude\clip-token'),(Join-Path $HOME '.claude\313b-token'))}
if(-not $Token){throw 'No TempShell API token found. Set TEMPSHELL_TOKEN or add ~/.claude/tempshell-token.'}
if($File){if(-not(Test-Path -LiteralPath $File -PathType Leaf)){throw "No such command file: $File"};$Command=Get-Content -LiteralPath $File -Raw}elseif(-not $Command){$Command=[Console]::In.ReadToEnd()}
if([string]::IsNullOrWhiteSpace($Command)){throw 'Empty command.'}
if($DryRun){Write-Output "DRY RUN, nothing was posted.`n  intent : $Intent`n  why    : $Why`n  command:`n$Command";return}
$pairs=@('lang=powershell');foreach($v in @(@('kind',$Kind),@('format',$Format),@('intent',$Intent),@('why',$Why),@('risk',$Risk),@('timeout_seconds',$Timeout))){if($v[1]){$pairs+=[uri]::EscapeDataString($v[0])+'='+[uri]::EscapeDataString([string]$v[1])}}
$headers=@{Authorization="Bearer $Token"};$postUrl=('{0}/api/sessions/{1}/command?{2}' -f $Base,$Slug,($pairs -join '&'))
try{$post=Invoke-RestMethod -Uri $postUrl -Method Post -Headers $headers -ContentType 'text/plain; charset=utf-8' -Body $Command -TimeoutSec 25}catch{throw "TempShell did not accept the command: $($_.Exception.Message)"}
$seq=[int]$post.seq;if($post.approval -eq 'pending'){Write-Error "tempshell: seq $seq is HELD FOR APPROVAL - $($post.risk_reason)"}else{Write-Error "tempshell: posted seq $seq, waiting for the result..."}
$since = $seq
$end = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $end) {
  $waitUrl = ('{0}/api/sessions/{1}/wait?since={2}&timeout=300&compact=1' -f $Base, $Slug, $since)
  try { $reply = Invoke-RestMethod -Uri $waitUrl -Headers $headers -TimeoutSec 315 } catch { continue }
  foreach ($entry in @($reply.entries)) {
    if ($entry.seq -gt $since) { $since = $entry.seq }
    $isAutoReply = $entry.author -eq 'auto' -and $entry.result -and $entry.in_reply_to -eq $seq
    $isManualReply = $entry.author -in @('guest', 'admin') -and $entry.kind -notin @('file', 'note')
    if (-not ($isAutoReply -or $isManualReply)) { continue }
    if ($Quiet) {
      $result = $entry.result
      $bits = @("status=$($result.status)")
      if ($null -ne $result.exit_code) { $bits += "exit=$($result.exit_code)" }
      if ($null -ne $result.duration_ms) { $bits += ('{0:N1}s' -f ($result.duration_ms / 1000)) }
      Write-Output ($bits -join '  ')
      if ($result.stdout) { Write-Output $result.stdout }
      if ($result.stderr) { Write-Output ('[stderr]' + [Environment]::NewLine + $result.stderr) }
    } elseif ($Field) {
      $value = $entry
      foreach ($part in $Field.Split('.')) { $value = $value.$part }
      if ($null -ne $value) {
        if ($value -is [string] -or $value -is [ValueType]) { Write-Output $value }
        else { $value | ConvertTo-Json -Compress -Depth 10 }
      }
    } else { $entry | ConvertTo-Json -Compress -Depth 10 }
    return
  }
}
[pscustomobject]@{ timed_out = $true; gave_up = $true; posted_seq = $seq } | ConvertTo-Json -Compress
exit 2

