$ErrorActionPreference = "Stop"

$goVersion = "go1.27.1"
$zipUrl = "https://go.dev/dl/$goVersion.windows-amd64.zip"
$userProfile = [System.Environment]::GetFolderPath('UserProfile')
$targetDir = Join-Path $userProfile "go"
$goExe = Join-Path $targetDir "bin\go.exe"

if (Test-Path $goExe) {
    Write-Host "Go already installed at $targetDir"
    & $goExe version
    exit 0
}

$tempZip = Join-Path $userProfile "go_download.zip"

Write-Host "Downloading Go from $zipUrl with curl..."
curl.exe -L --retry 3 -o $tempZip $zipUrl

Write-Host "Extracting archive with tar..."
tar.exe -xf $tempZip -C $userProfile

Write-Host "Cleaning up temporary zip..."
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue

Write-Host "Go successfully set up at $targetDir!"
& $goExe version
