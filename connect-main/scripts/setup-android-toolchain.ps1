$ErrorActionPreference = "Stop"

$userProfile = [System.Environment]::GetFolderPath('UserProfile')
$jdkDir = Join-Path $userProfile "jdk-17"
$javaExe = Join-Path $jdkDir "bin\java.exe"

# 1. Setup OpenJDK 17
if (-not (Test-Path $javaExe)) {
    Write-Host "Downloading OpenJDK 17..."
    $jdkZip = Join-Path $userProfile "jdk17.zip"
    $jdkUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
    curl.exe -L --retry 3 -o $jdkZip $jdkUrl

    Write-Host "Extracting OpenJDK 17..."
    $jdkTemp = Join-Path $userProfile "jdk-temp"
    if (Test-Path $jdkTemp) { Remove-Item $jdkTemp -Recurse -Force }
    New-Item -ItemType Directory -Path $jdkTemp -Force | Out-Null
    tar.exe -xf $jdkZip -C $jdkTemp

    $inner = Get-ChildItem $jdkTemp | Select-Object -First 1
    if (Test-Path $jdkDir) { Remove-Item $jdkDir -Recurse -Force }
    Move-Item $inner.FullName $jdkDir -Force

    Remove-Item $jdkTemp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $jdkZip -Force -ErrorAction SilentlyContinue
    Write-Host "OpenJDK 17 installed successfully!"
} else {
    Write-Host "OpenJDK 17 already installed."
}

& $javaExe -version

# 2. Setup Android SDK Command-line Tools
$androidHome = Join-Path $userProfile "android-sdk"
$cmdlineLatest = Join-Path $androidHome "cmdline-tools\latest"
$sdkmanager = Join-Path $cmdlineLatest "bin\sdkmanager.bat"

if (-not (Test-Path $sdkmanager)) {
    Write-Host "Downloading Android SDK Command-line Tools..."
    $cmdlineZip = Join-Path $userProfile "cmdline-tools.zip"
    $cmdlineUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    curl.exe -L --retry 3 -o $cmdlineZip $cmdlineUrl

    Write-Host "Extracting Command-line Tools..."
    $cmdlineTemp = Join-Path $userProfile "cmdline-temp"
    if (Test-Path $cmdlineTemp) { Remove-Item $cmdlineTemp -Recurse -Force }
    New-Item -ItemType Directory -Path $cmdlineTemp -Force | Out-Null
    tar.exe -xf $cmdlineZip -C $cmdlineTemp

    New-Item -ItemType Directory -Path (Join-Path $androidHome "cmdline-tools") -Force | Out-Null
    Move-Item (Join-Path $cmdlineTemp "cmdline-tools") $cmdlineLatest -Force

    Remove-Item $cmdlineTemp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $cmdlineZip -Force -ErrorAction SilentlyContinue
    Write-Host "Android Command-line Tools installed successfully!"
} else {
    Write-Host "Android Command-line Tools already installed."
}

# 3. Configure Environment Variables for Android SDK & Java
$env:JAVA_HOME = $jdkDir
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:PATH = "$jdkDir\bin;$cmdlineLatest\bin;$androidHome\platform-tools;$env:PATH"

Write-Host "Accepting Android SDK licenses and installing packages..."
# Accept licenses
cmd.exe /c "echo y | $sdkmanager --licenses"

# Install platform-tools, build-tools, platforms
cmd.exe /c "$sdkmanager --install `"platform-tools`" `"build-tools;34.0.0`" `"build-tools;35.0.0`" `"platforms;android-34`" `"platforms;android-35`""

Write-Host "Android SDK Toolchain setup complete!"
