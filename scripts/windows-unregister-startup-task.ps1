param(
    [string]$TaskName = "phipster Server"
)

$ErrorActionPreference = "Stop"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed startup task '$TaskName'." -ForegroundColor Green
    exit 0
}

# Also support removing the v1.1 legacy label when the default name is used.
if ($TaskName -eq "phipster Server") {
    $LegacyTaskName = "phipster Server"
    $LegacyTask = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
    if ($LegacyTask) {
        Stop-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
        Write-Host "Removed legacy startup task '$LegacyTaskName'." -ForegroundColor Green
        exit 0
    }
}

Write-Host "Startup task '$TaskName' is not registered."
