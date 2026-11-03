param([string]$AgentPath, [string]$FramesPath, [string]$TestUrl)
$ErrorActionPreference = 'Stop'
# Load only the generated agent's initialization and functions, never arm or run
# the main loop. All terminal output is our own StringWriter, not a screen grab.
$source = Get-Content -LiteralPath $AgentPath -Raw -Encoding UTF8
$start = $source.IndexOf('& {') + 3
$end = $source.IndexOf('# ---- arm (on a clean alternate screen when fancy)')
. ([scriptblock]::Create($source.Substring($start, $end - $start)))
$ErrorActionPreference = 'Stop'
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
$global:testCols = 100; $global:testRows = 30
function Console-Size { return @{ cols = $global:testCols; rows = $global:testRows } }
function Width { return [Math]::Min($global:testCols - 6, 132) }
# Inject a key queue at the console boundary; exercise the REAL input pump.
$global:testKeys = New-Object 'System.Collections.Generic.Queue[System.ConsoleKey]'
function Next-ApprovalKey { if ($global:testKeys.Count) { return $global:testKeys.Dequeue() }; return $null }
function Capture-Frame {
  $writer = New-Object System.IO.StringWriter
  $previous = [Console]::Out
  try { [Console]::SetOut($writer); Draw } finally { [Console]::SetOut($previous) }
  return $writer.ToString()
}
$fancy = $true
$global:inAlt = $true
$hostName = 'TEST-PC'; $userName = 'Martin'; $title = 'Investigate time sync'
$instance = 'c.313b.be'; $state = 'waiting'
$body = @('Get-Service -Name w32time', 'Restart-Service -Name w32time') + @(1..24 | ForEach-Object { 'Write-Output "Diagnostic line ' + $_ + '"' }) + 'Write-Output "END_OF_COMMAND"'
$held = [pscustomobject]@{ seq = 42; intent = 'Restart Windows Time'; why = 'The service is stopped; restore clock synchronization.'; body = ($body -join [char]10) }
Show-Approval $held
$global:approvalNotice = 'Choose A or D, then Enter. Esc cancels.'
$global:approvalKeyboard = $true
$frames = @()
$first = Capture-Frame
$spinBefore = $global:spin
$second = Capture-Frame
Assert ($global:spin -gt $spinBefore) 'Animation must advance while approval is visible'
Assert ($first -ne $second) 'Consecutive pending-approval frames must animate'
Assert ($second.Contains('APPROVAL NEEDED')) 'Popup title missing'
Assert ($second.Contains('Restart Windows Time')) 'Request intent missing'
Assert ($second.Contains('ran 0')) 'Visible background stats must still render beside the popup'
Assert (-not $second.Contains('ready for the next step')) 'Occluded dashboard text must never be emitted through the popup'
Assert (-not $second.Contains('[2J')) 'Steady popup frames must not clear the screen'
Assert ($global:inAlt) 'Approval must not leave the alternate screen'
Assert (-not $second.Contains('[?1049l')) 'Approval switched to the plain screen'
Assert (-not $second.Contains('[?1049h')) 'Approval restarted the alternate screen'
$frames += @{ name = 'pending'; cols = 100; rows = 30; ansi = $first + $second }
Handle-ApprovalKey ([ConsoleKey]::A)
Assert ($global:approvalSelection -eq 'approve') 'A must select approve'
$selected = Capture-Frame
Assert ($selected.Contains('[48;5;40m')) 'Approve selection must be highlighted'
$frames += @{ name = 'selected'; cols = 100; rows = 30; ansi = $selected }
Handle-ApprovalKey ([ConsoleKey]::Escape)
Assert (-not $global:approvalSelection) 'Esc must clear selection'
Handle-ApprovalKey ([ConsoleKey]::Enter)
Assert ($global:approvalVisible) 'Enter alone must not decide'
# A fast burst must be handled together, not replayed at one key per frame.
foreach ($i in 1..150) {
  foreach ($key in @([ConsoleKey]::A, [ConsoleKey]::D, [ConsoleKey]::PageDown, [ConsoleKey]::PageUp)) { $global:testKeys.Enqueue($key) }
}
$global:testKeys.Enqueue([ConsoleKey]::End)
$global:testKeys.Enqueue([ConsoleKey]::A)
$inputWatch = [Diagnostics.Stopwatch]::StartNew()
Read-ApprovalKey
$inputWatch.Stop()
Assert ($global:testKeys.Count -eq 0) 'Burst keys are left queued to replay on later animation frames'
Assert ($global:approvalSelection -eq 'approve') 'The final selection in a burst must win'
Assert ($global:approvalScroll -eq $global:approvalMaxScroll) 'The final scroll position in a burst must win'
Assert ($inputWatch.ElapsedMilliseconds -lt 2000) 'Input processing unexpectedly stalled'
$burstMs = $inputWatch.ElapsedMilliseconds
Handle-ApprovalKey ([ConsoleKey]::Escape)
Handle-ApprovalKey ([ConsoleKey]::Home)
Handle-ApprovalKey ([ConsoleKey]::PageDown)
Assert ($global:approvalScroll -eq $global:approvalPageSize) 'PageDown should scroll by one page'
Handle-ApprovalKey ([ConsoleKey]::End)
$tail = Capture-Frame
Assert ($tail.Contains('END_OF_COMMAND')) 'The entire command must remain accessible'
Assert ($global:approvalScroll -eq $global:approvalMaxScroll) 'End must reach the last line'
$frames += @{ name = 'scrolled'; cols = 100; rows = 30; ansi = $tail }
Handle-ApprovalKey ([ConsoleKey]::Home)
Assert ($global:approvalScroll -eq 0) 'Home must return to the start'
foreach ($size in @(@(80,25), @(48,16), @(32,12), @(160,45))) {
  $global:testCols = $size[0]; $global:testRows = $size[1]
  $renderedFrame = Capture-Frame
  foreach ($cursor in [regex]::Matches($renderedFrame, ([char]27 + '\[(\d+);(\d+)H'))) {
    Assert ([int]$cursor.Groups[1].Value -le $global:testRows) 'Popup draws below the viewport'
    Assert ([int]$cursor.Groups[2].Value -le $global:testCols) 'Popup draws beyond the viewport width'
  }
  $frames += @{ name = ('resized-' + $size[0] + 'x' + $size[1]); cols = $size[0]; rows = $size[1]; ansi = $renderedFrame }
}
$global:testCols = 100; $global:testRows = 30
$null = Capture-Frame
# Real async HTTP POST against a disposable loopback server, with a deliberate
# delay. Buffer output and assert the popup continues animating during submission.
$global:approvalBusy = $true
$spinBefore = $global:spin
$writer = New-Object System.IO.StringWriter; $previous = [Console]::Out
try {
  [Console]::SetOut($writer)
  $reply = Get-Async $TestUrl @{} 6 'POST' '{"approve":true}'
} finally { [Console]::SetOut($previous); $global:approvalBusy = $false }
Assert ($reply.ok) 'Async decision POST failed'
Assert ($global:spin -gt $spinBefore) 'Animation froze during the decision POST'
Assert ($writer.ToString().Contains('Recording decision')) 'Submission state must be visible'
# Exercise the real handler's success/failure paths without live session tokens.
$global:postOK = $false; $global:lastDecision = $null; $global:postCount = 0
function Get-Async($url, $headers, $timeout, $method, $json) {
  $global:lastDecision = $json | ConvertFrom-Json
  $global:postCount++
  return @{ ok = $global:postOK; code = 409 }
}
# Oversized stale typeahead stays discard-only across capped pump iterations;
# even an Enter at the tail must not approve the current or next request.
foreach ($i in 1..4096) { $global:testKeys.Enqueue([ConsoleKey]::A) }
$global:testKeys.Enqueue([ConsoleKey]::Enter)
$global:approvalDiscardPending = $true
Read-ApprovalKey
Assert ($global:testKeys.Count -eq 2049) 'A discard batch must remain bounded'
Assert ($global:approvalDiscardPending) 'An oversized stale queue must stay discard-only'
Read-ApprovalKey
Read-ApprovalKey
Assert ($global:testKeys.Count -eq 0) 'Stale queue was not fully discarded'
Assert (-not $global:approvalDiscardPending) 'Discard state should clear after the queue is empty'
Assert ($global:postCount -eq 0) 'Stale typeahead must never submit a decision'
Assert (-not $global:approvalSelection) 'Discarded typeahead must not select approval'
# Enter alone is inert. The first explicit D+Enter submits once; queued A+Enter
# behind it must be discarded even if the submission fails and the modal stays.
foreach ($key in @([ConsoleKey]::Enter, [ConsoleKey]::D, [ConsoleKey]::Enter, [ConsoleKey]::A, [ConsoleKey]::Enter)) { $global:testKeys.Enqueue($key) }
Read-ApprovalKey
Assert ($global:postCount -eq 1) 'A burst must not submit twice after a confirmation boundary'
Assert ($global:testKeys.Count -eq 0) 'Post-confirmation typeahead must be discarded'
Assert ($global:lastDecision.approve -eq $false) 'D+Enter must post a denial'
Assert ($global:approvalVisible) 'Unconfirmed decision must keep the request visible'
Assert (-not $global:approvalSelection) 'Failed decision must not retain a selection'
$frames += @{ name = 'unconfirmed'; cols = 100; rows = 30; ansi = (Capture-Frame) }
$global:postOK = $true
Handle-ApprovalKey ([ConsoleKey]::A)
Handle-ApprovalKey ([ConsoleKey]::Enter)
Assert ($global:lastDecision.approve -eq $true) 'A+Enter must post approval'
Assert (-not $global:approvalVisible) 'Confirmed decision must dismiss the popup'
Assert ($global:inAlt) 'Dismissing a popup must preserve the dashboard buffer'
$cleared = Capture-Frame
Assert (-not $cleared.Contains('APPROVAL NEEDED')) 'Dismissed popup remains visible'
Assert ($cleared.Contains('[2J')) 'Dismissal must erase popup/shadow remnants'
$frames += @{ name = 'cleared'; cols = 100; rows = 30; ansi = $cleared }
# Plain terminals must still show readable full text, not raw ANSI drawing.
$fancy = $false
$hostText = & { Show-Approval $held } 6>&1 | Out-String
Assert ($hostText.Contains('END_OF_COMMAND')) 'Plain fallback must show the complete command'
Assert (-not $hostText.Contains(([string][char]27))) 'Plain fallback leaked ANSI controls'
$frames | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $FramesPath -Encoding UTF8
Write-Output ('Terminal popup checks passed (animation, layout, resize, scroll, confirmation, async POST, fallback; 602-key burst: ' + $burstMs + ' ms).')
