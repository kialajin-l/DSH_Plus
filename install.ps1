# DHS_Plus 插件工具箱一键安装脚本
# 用法：
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-ProfileDir <DSH profile 目录>] [-NoModelPickerPatch]
# 功能：
#   1. 为本目录下所有插件（含 dsh.bundle.patch 声明的包）创建 junction
#   2. 注册 profile package.json 依赖 + bundles
#   3. 默认应用 dsh-model-picker 所需的原生选择器禁用 patch（-NoModelPickerPatch 跳过）
#   4. 修改前自动备份 package.json / cordis.patch.yml
# 幂等：重复执行只补缺失项。完成后需重启 DeepSeek Harness 生效。

param(
    [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
    [string]$SourceDir = $PSScriptRoot,
    [switch]$NoModelPickerPatch
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd-HHmmss"

if (-not (Test-Path (Join-Path $ProfileDir "package.json"))) {
    Write-Error "Profile 目录不存在或缺少 package.json: $ProfileDir"
    exit 1
}

# ---- 收集插件（含 dsh.bundle.patch 声明的包）----
$plugins = @()
Get-ChildItem $SourceDir -Directory | ForEach-Object {
    $pkgPath = Join-Path $_.FullName "package.json"
    if (Test-Path $pkgPath) {
        try {
            $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $pkg.dsh -and $null -ne $pkg.dsh.bundle -and $null -ne $pkg.name) {
                $plugins += [pscustomobject]@{ Name = $pkg.name; Dir = $_.FullName }
            }
        } catch { Write-Warning "跳过无法解析的包: $($_.Name)" }
    }
}
Write-Host "发现插件 $($plugins.Count) 个"

# ---- 备份 ----
$pkgFile = Join-Path $ProfileDir "package.json"
Copy-Item $pkgFile "$pkgFile.bak-install-$ts" -Force
Write-Host "备份: $pkgFile.bak-install-$ts"

# ---- junction ----
$nm = Join-Path $ProfileDir "node_modules"
New-Item -ItemType Directory -Force -Path $nm | Out-Null
foreach ($p in $plugins) {
    $link = Join-Path $nm $p.Name
    # scoped 包名（@scope/name）需先建 scope 父目录
    $linkParent = Split-Path $link -Parent
    if (-not (Test-Path $linkParent)) { New-Item -ItemType Directory -Force -Path $linkParent | Out-Null }
    if (Test-Path $link) {
        $item = Get-Item $link -Force
        if ($item.LinkType -eq "Junction") { Write-Host "  junction 已存在: $($p.Name)"; continue }
        Write-Warning "  $link 已存在且非 junction，跳过（请手动处理）"
        continue
    }
    New-Item -ItemType Junction -Path $link -Target $p.Dir | Out-Null
    Write-Host "  junction 创建: $($p.Name)"
}

# ---- package.json：dependencies + bundles ----
$json = Get-Content $pkgFile -Raw | ConvertFrom-Json
if ($null -eq $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$changed = $false
foreach ($p in $plugins) {
    $dep = ($p.Dir -replace "\\", "/")
    $existing = $json.dependencies.PSObject.Properties[$p.Name]
    if ($null -eq $existing) {
        $json.dependencies | Add-Member -NotePropertyName $p.Name -NotePropertyValue "file:$dep"
        $changed = $true; Write-Host "  dependency +: $($p.Name)"
    } elseif ($existing.Value -ne "file:$dep") {
        $existing.Value = "file:$dep"; $changed = $true; Write-Host "  dependency 更新: $($p.Name)"
    }
}
if ($null -eq $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $json.dsh.profile.bundles) { $json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
$bundles = [System.Collections.Generic.List[string]]($json.dsh.profile.bundles)
foreach ($p in $plugins) {
    if (-not $bundles.Contains($p.Name)) { $bundles.Add($p.Name); $changed = $true; Write-Host "  bundle +: $($p.Name)" }
}
$json.dsh.profile.bundles = @($bundles)
if ($changed) {
    $json | ConvertTo-Json -Depth 32 | Set-Content $pkgFile -Encoding UTF8
    Write-Host "package.json 已更新"
} else {
    Write-Host "package.json 无需变更"
}

# ---- model-picker patch ----
if (-not $NoModelPickerPatch) {
    $patchFile = Join-Path $ProfileDir "cordis.patch.yml"
    if (Test-Path $patchFile) {
        $hasPatch = (Select-String -Path $patchFile -Pattern "ui-model-selection" -Quiet)
        if ($hasPatch) {
            Write-Host "cordis.patch.yml 已含 ui-model-selection 条目，跳过"
        } else {
            Copy-Item $patchFile "$patchFile.bak-install-$ts" -Force
            Write-Host "备份: cordis.patch.yml.bak-install-$ts"
            Add-Content $patchFile "`n- id: ui-model-selection`n  disabled: true"
            Write-Host "已追加 model-picker 所需 patch（禁用原生模型选择器）"
        }
    } else {
        Write-Warning "未找到 cordis.patch.yml，跳过 model-picker patch"
    }
}

Write-Host "`n完成。重启 DeepSeek Harness 后生效。"
Write-Host "MCP 类整合（flowforge / ruleforge）不在本脚本范围，需按 README 手动加 cordis.patch.yml。"
