<#
.SYNOPSIS
    构建、打包 GitButler fork 的 Release 版本，并更新 CHANGELOG 的构建产物数据。

.DESCRIPTION
    版本号来源为 crates/gitbutler-tauri/Cargo.toml，脚本只读取不修改。
    需要升版本时请手动编辑该文件（本 fork 使用 0.22.0+deepseek 这类语义化后缀，
    上游 CI 的版本号来自远程 API，与本地文件无关）。

    CHANGELOG 只有「发布包信息」到「### 安装方式」之间的构建产物数据会被覆写，
    问题分析、根因、修复方案等人工内容不受影响。

.PARAMETER Only
    限定编译范围：all(默认) / tauri / cli / none。
    none 表示跳过编译，直接用 target/release 下的现有产物打包。

.PARAMETER Install
    编译后替换 C:\Program Files\GitButler\ 下的 exe。会弹 UAC 提权，并先备份原文件。

.PARAMETER SkipPackage
    只编译，不生成 dist 目录和 zip。

.EXAMPLE
    .\build-release.ps1
    编译全部三个目标并打包。

.EXAMPLE
    .\build-release.ps1 -Only cli -Install
    只编译 but.exe 和 askpass，然后替换系统安装。

.EXAMPLE
    .\build-release.ps1 -Only none
    跳过编译，用现有产物重新打包。
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'tauri', 'cli', 'none')]
    [string]$Only = 'all',

    [switch]$Install,

    [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = $PSScriptRoot
$ReleaseDir = Join-Path $RepoRoot 'target\release'
$DistRoot = Join-Path $RepoRoot 'dist'
$ChangelogPath = Join-Path $RepoRoot 'CHANGELOG-webview2-fix.md'
$InstallDir = 'C:\Program Files\GitButler'

# 产物清单：源文件名 -> 说明（用于 CHANGELOG 表格）
$Artifacts = [ordered]@{
    'gitbutler-tauri.exe'       = '主程序 (含 WebView2 修复)'
    'but.exe'                   = 'CLI 工具'
    'gitbutler-git-askpass.exe' = 'Git askpass 工具'
}

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Format-Size($bytes) {
    if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    return "{0:N0} KB" -f ($bytes / 1KB)
}

# ---------------------------------------------------------------- 版本号

function Get-ProjectVersion {
    $cargoToml = Join-Path $RepoRoot 'crates\gitbutler-tauri\Cargo.toml'
    if (-not (Test-Path $cargoToml)) {
        throw "找不到 $cargoToml"
    }
    # 只取 [package] 段的第一个 version，避免命中依赖项
    $line = Select-String -Path $cargoToml -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
    if (-not $line) {
        throw "无法从 $cargoToml 解析 version 字段"
    }
    return $line.Matches[0].Groups[1].Value
}

# 0.22.0+deepseek -> 0.22.0-deepseek（+ 号在文件名和 URL 中不安全）
function ConvertTo-SafeVersion($version) {
    return ($version -replace '\+', '-')
}

# ---------------------------------------------------------------- 编译

function Invoke-Build($scope) {
    $targets = @()
    switch ($scope) {
        'all' { $targets = @('gitbutler-tauri', 'cli') }
        'tauri' { $targets = @('gitbutler-tauri') }
        'cli' { $targets = @('cli') }
    }

    foreach ($t in $targets) {
        if ($t -eq 'gitbutler-tauri') {
            Write-Step "编译 gitbutler-tauri (release)"
            $frontendBuild = Join-Path $RepoRoot 'apps\desktop\build'
            if (-not (Test-Path $frontendBuild)) {
                throw "前端构建产物不存在: $frontendBuild`n请先运行 pnpm build:desktop"
            }
            & cargo build --release -p gitbutler-tauri
        }
        else {
            Write-Step "编译 but + gitbutler-git-askpass (release)"
            & cargo build --release -p but -p gitbutler-git --bin but --bin gitbutler-git-askpass
        }

        # cargo 在沙箱环境下可能因缓存文件权限返回非零，以产物是否更新为准
        if ($LASTEXITCODE -ne 0) {
            Write-Warn2 "cargo 退出码 $LASTEXITCODE，继续校验产物"
        }
    }
}

function Assert-Artifacts {
    $missing = @()
    foreach ($name in $Artifacts.Keys) {
        $p = Join-Path $ReleaseDir $name
        if (-not (Test-Path $p)) { $missing += $name }
    }
    if ($missing.Count -gt 0) {
        throw "缺少构建产物: $($missing -join ', ')`n请检查编译是否成功，或先运行不带 -Only none 的完整编译"
    }
}

# ---------------------------------------------------------------- 打包

function New-DistPackage($safeVersion) {
    $distName = "gitbutler-$safeVersion-windows-x64"
    $distDir = Join-Path $DistRoot $distName
    $zipPath = Join-Path $DistRoot "$distName.zip"

    Write-Step "打包到 dist\$distName"

    if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null

    foreach ($name in $Artifacts.Keys) {
        Copy-Item (Join-Path $ReleaseDir $name) $distDir -Force
    }
    if (Test-Path $ChangelogPath) {
        Copy-Item $ChangelogPath $distDir -Force
    }

    return [PSCustomObject]@{
        DistDir = $distDir
        ZipPath = $zipPath
    }
}

function Compress-DistPackage($distDir, $zipPath) {
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    # ProgressPreference 会让 Compress-Archive 往 stdout 吐 CLIXML 噪音
    $prev = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Compress-Archive -Path "$distDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
    }
    finally {
        $ProgressPreference = $prev
    }
    Write-Ok "zip: $(Format-Size (Get-Item $zipPath).Length)"
}

# ---------------------------------------------------------------- CHANGELOG

function Update-Changelog($version, $safeVersion, $zipPath) {
    if (-not (Test-Path $ChangelogPath)) {
        Write-Warn2 "CHANGELOG 不存在，跳过更新"
        return
    }

    $content = Get-Content $ChangelogPath -Raw -Encoding UTF8

    # 头部的 **版本**: 行也要跟随 Cargo.toml，否则会与下方发布包信息不一致
    $headerPattern = '(?m)^\*\*版本\*\*: `[^`]*`'
    if ($content -match $headerPattern) {
        $content = [regex]::Replace($content, $headerPattern, "**版本**: ``$version``", 1)
    }
    else {
        Write-Warn2 "未找到头部「**版本**:」行，仅更新发布包信息章节"
    }

    $startMarker = '## 发布包信息'
    $endMarker = '### 安装方式'

    $startIdx = $content.IndexOf($startMarker)
    $endIdx = $content.IndexOf($endMarker)

    if ($startIdx -lt 0 -or $endIdx -lt 0 -or $endIdx -le $startIdx) {
        Write-Warn2 "CHANGELOG 中未找到「$startMarker」...「$endMarker」区间，跳过章节更新以免破坏内容"
        # 头部版本号的替换已完成，仍需落盘
        [System.IO.File]::WriteAllText($ChangelogPath, $content, (New-Object System.Text.UTF8Encoding($false)))
        return
    }

    $zipItem = Get-Item $zipPath
    $rows = foreach ($name in $Artifacts.Keys) {
        $f = Get-Item (Join-Path $ReleaseDir $name)
        "| ``$name`` | $(Format-Size $f.Length) | Release | $($Artifacts[$name]) |"
    }
    $changelogSize = Format-Size (Get-Item $ChangelogPath).Length

    $newSection = @"
$startMarker

**文件**: ``dist/gitbutler-$safeVersion-windows-x64.zip``  
**版本**: ``$version``  
**大小**: $(Format-Size $zipItem.Length) (压缩后)  
**平台**: Windows x86_64  
**构建时间**: $(Get-Date -Format 'yyyy-MM-dd HH:mm')

### 包含文件

| 文件 | 大小 | 构建类型 | 说明 |
|------|------|---------|------|
$($rows -join "`n")
| ``CHANGELOG-webview2-fix.md`` | $changelogSize | - | 变更日志 |

> 全部三个可执行文件均为 Release (optimized) 构建，由 ``build-release.ps1`` 生成。
> 版本号来源为 ``crates/gitbutler-tauri/Cargo.toml``，需升版本时请手动编辑该文件。


"@

    $updated = $content.Substring(0, $startIdx) + $newSection + $content.Substring($endIdx)

    # 保持无 BOM 的 UTF-8，避免 git 显示整文件变更
    [System.IO.File]::WriteAllText($ChangelogPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "已更新「发布包信息」章节（人工内容未改动）"
}

# ---------------------------------------------------------------- 安装

function Install-ToSystem {
    Write-Step "替换系统安装 ($InstallDir)"

    if (-not (Test-Path $InstallDir)) {
        Write-Warn2 "$InstallDir 不存在，跳过"
        return
    }

    $running = Get-Process -Name 'gitbutler-tauri' -ErrorAction SilentlyContinue
    if ($running) {
        Write-Warn2 "GitButler 正在运行，先关闭"
        $running | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    $backupDir = Join-Path $InstallDir ("backup_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))
    $logPath = Join-Path $env:TEMP 'gb-install.log'
    if (Test-Path $logPath) { Remove-Item $logPath -Force }

    # 提权脚本：先备份再覆盖，全程写日志供父进程读取
    $elevated = @"
`$ErrorActionPreference = 'Stop'
try {
    New-Item -ItemType Directory -Path '$backupDir' -Force | Out-Null
"@
    foreach ($name in $Artifacts.Keys) {
        $src = Join-Path $ReleaseDir $name
        $dst = Join-Path $InstallDir $name
        $elevated += @"

    if (Test-Path '$dst') { Copy-Item '$dst' '$backupDir' -Force }
    Copy-Item '$src' '$dst' -Force
"@
    }
    $elevated += @"

    'SUCCESS' | Out-File '$logPath' -Encoding UTF8
} catch {
    "FAILED: `$_" | Out-File '$logPath' -Encoding UTF8
}
"@

    $tmpScript = Join-Path $env:TEMP 'gb-install.ps1'
    [System.IO.File]::WriteAllText($tmpScript, $elevated, (New-Object System.Text.UTF8Encoding($false)))

    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tmpScript
        )
        Start-Sleep -Milliseconds 500

        if (Test-Path $logPath) {
            $result = (Get-Content $logPath -Raw).Trim()
            if ($result -like 'SUCCESS*') {
                Write-Ok "已替换，原文件备份至 $backupDir"
            }
            else {
                Write-Warn2 $result
            }
        }
        else {
            Write-Warn2 "未获取到安装结果（可能被取消 UAC）"
        }
    }
    finally {
        Remove-Item $tmpScript -Force -ErrorAction SilentlyContinue
        Remove-Item $logPath -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- 主流程

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$version = Get-ProjectVersion
$safeVersion = ConvertTo-SafeVersion $version

Write-Host "GitButler Release Build" -ForegroundColor White
Write-Host "  版本: $version (来自 Cargo.toml，脚本不修改)"
Write-Host "  范围: $Only"

if ($Only -ne 'none') {
    Invoke-Build $Only
}
else {
    Write-Step "跳过编译，使用现有产物"
}

Assert-Artifacts
Write-Step "产物校验"
foreach ($name in $Artifacts.Keys) {
    $f = Get-Item (Join-Path $ReleaseDir $name)
    Write-Ok ("{0,-28} {1,10}  {2}" -f $name, (Format-Size $f.Length), $f.LastWriteTime.ToString('MM-dd HH:mm'))
}

if (-not $SkipPackage) {
    $pkg = New-DistPackage $safeVersion
    # 先更新 CHANGELOG，再复制进 dist 并压缩，保证包内是最新版
    Compress-DistPackage $pkg.DistDir $pkg.ZipPath
    Update-Changelog $version $safeVersion $pkg.ZipPath
    Copy-Item $ChangelogPath $pkg.DistDir -Force
    Compress-DistPackage $pkg.DistDir $pkg.ZipPath
    Write-Ok "输出: $($pkg.ZipPath)"
}

if ($Install) {
    Install-ToSystem
}

$sw.Stop()
Write-Host "`n完成，耗时 $([math]::Round($sw.Elapsed.TotalMinutes, 1)) 分钟" -ForegroundColor Green
