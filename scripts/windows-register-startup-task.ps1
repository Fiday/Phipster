param(
    [string]$TaskName = "phipster Server"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ServerEntry = Join-Path $ProjectRoot "server\dist\index.js"
$Node = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path $ServerEntry)) {
    throw "Build phipster first with npm run build before registering the startup task."
}

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator to register the startup task."
}

# v1.1 used "phipster Server". If the default phipster task is being installed,
# remove that legacy task first so two startup tasks cannot compete for port 3000.
if ($TaskName -eq "phipster Server") {
    $LegacyTaskName = "phipster Server"
    $LegacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    if ($LegacyTask) {
        Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
        Write-Host "Migrated legacy startup task '$LegacyTaskName'." -ForegroundColor Yellow
    }
}

$Action = New-ScheduledTaskAction `
    -Execute $Node `
    -Argument ('"' + $ServerEntry + '"') `
    -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

# SYSTEM can start phipster before anyone logs in. C:\phipster is recommended for
# new installs; an existing C:\phipster installation can remain where it is.
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -User "SYSTEM" `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "Registered startup task '$TaskName'." -ForegroundColor Green
Write-Host "It will run: $Node $ServerEntry"
Write-Host "Start it now with: Start-ScheduledTask -TaskName '$TaskName'"
