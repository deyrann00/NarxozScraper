param(
    [string]$Time = "09:00",
    [string]$TaskName = "NarxozThreadsScraper"
)

$Runner = Join-Path $PSScriptRoot "run-scrape.cmd"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path $Runner)) {
    throw "Missing $Runner"
}

# schtasks needs extra quotes when the path contains spaces.
$Tr = '"{0}"' -f $Runner
schtasks /Create /TN $TaskName /SC DAILY /ST $Time /F /TR $Tr
if ($LASTEXITCODE -ne 0) {
    throw "Failed to register scheduled task '$TaskName'"
}
Write-Host "Registered daily task '$TaskName' at $Time"
Write-Host "Posts will be saved under $Root\data"
Write-Host "Task log: $Root\logs\task.log"
