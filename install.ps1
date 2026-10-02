# Pasokh installer for Windows (Docker Desktop).
#
#   irm https://raw.githubusercontent.com/ArminShirzad/pasokh/main/install.ps1 | iex
#
# Safe to run again: an existing installation keeps its .env and is updated.

$ErrorActionPreference = "Stop"
$RepoRaw = if ($env:PASOKH_REPO_RAW) { $env:PASOKH_REPO_RAW } else { "https://raw.githubusercontent.com/ArminShirzad/pasokh/main" }

Write-Host "Pasokh / پاسخ"
Write-Host "  1) فارسی"
Write-Host "  2) English"
$Lang = if ((Read-Host "Language / زبان [1]") -eq "2") { "en" } else { "fa" }
function Say([string]$fa, [string]$en) { if ($Lang -eq "en") { Write-Host $en } else { Write-Host $fa } }
function Fail([string]$fa, [string]$en) { Say "❌ $fa" "❌ $en"; exit 1 }

function New-Secret([int]$bytes) {
    $b = New-Object byte[] $bytes
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($b)   # GetBytes, not ::Fill: Windows PowerShell 5.1 has no Fill.
    -join ($b | ForEach-Object { $_.ToString("x2") })
}

# Docker Desktop must be installed and running.
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker Desktop را نصب و اجرا کنید و دوباره همین دستور را بزنید: https://www.docker.com/products/docker-desktop/" `
         "Install and start Docker Desktop, then run this again: https://www.docker.com/products/docker-desktop/"
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker Desktop اجرا نیست؛ بازش کنید و صبر کنید تا آماده شود." "Docker Desktop is not running; start it and wait until it is ready." }

# Instagram and Zernio must be reachable from this machine.
foreach ($u in "https://graph.instagram.com", "https://zernio.com") {
    try { Invoke-WebRequest -Uri $u -Method Head -TimeoutSec 10 -UseBasicParsing *> $null }
    catch {
        if (-not $_.Exception.Response) {
            Say "⚠️  این کامپیوتر به $u دسترسی ندارد. بدون آن هیچ پیامی دریافت یا ارسال نمی‌شود." "⚠️  This computer cannot reach $u. Without it no message is received or sent."
            if ((Read-Host "y/N") -notin @("y", "Y")) { exit 1 }
            break
        }
    }
}

$FromSource = (Test-Path docker-compose.yml) -and (Test-Path Dockerfile) -and (Select-String -Path docker-compose.yml -Pattern "name: pasokh" -Quiet)
if ($FromSource) { $Dir = (Get-Location).Path }
else {
    $Dir = if ($env:PASOKH_DIR) { $env:PASOKH_DIR } else { Join-Path $HOME "pasokh" }
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    foreach ($f in "docker-compose.yml", "Caddyfile", ".env.example") {
        Invoke-WebRequest -Uri "$RepoRaw/$f" -OutFile (Join-Path $Dir $f) -UseBasicParsing
    }
}
Set-Location $Dir

if (Test-Path .env) {
    Say "✓ نصب قبلی پیدا شد؛ تنظیمات و رمزها حفظ می‌شوند." "✓ Existing installation found; keeping its settings and secrets."
} else {
    Say "سرور چطور از اینترنت در دسترس باشد؟" "How should the internet reach this computer?"
    Say "  1) تونل سریع کلودفلر (بدون دامنه؛ برای تست)" "  1) Cloudflare quick tunnel (no domain; for trying it out)"
    Say "  2) فقط همین کامپیوتر (http://localhost:3000)" "  2) This computer only (http://localhost:3000)"
    $Mode = Read-Host "[1]"
    $Profiles = "quick"; $Tunnel = "quick"
    if ($Mode -eq "2") { $Profiles = ""; $Tunnel = "" }
    $Locale = $Lang
    $Tz = if ($Lang -eq "fa") { "Asia/Tehran" } else { "UTC" }
    $lines = @(
        "# Written by install.ps1 on $(Get-Date -Format yyyy-MM-dd). See .env.example for every option.",
        "NEXTAUTH_SECRET=$(New-Secret 32)",
        "CRON_SECRET=$(New-Secret 32)",
        "ENCRYPTION_KEY=$(New-Secret 32)",
        "POSTGRES_PASSWORD=$(New-Secret 16)",
        "",
        "COMPOSE_PROFILES=$Profiles",
        "PASOKH_TUNNEL=$Tunnel",
        "NEXTAUTH_URL=http://localhost:3000",
        "",
        "DEFAULT_LOCALE=$Locale",
        "TZ=$Tz"
    )
    # UTF-8 without BOM and LF: compose reads the first key wrong after a BOM.
    [System.IO.File]::WriteAllText((Join-Path $Dir ".env"), (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
    Say "✓ تنظیمات در $Dir\.env ذخیره شد." "✓ Settings saved to $Dir\.env."
}

Say "⏳ دریافت ایمیج‌ها..." "⏳ Pulling images..."
docker compose pull --quiet 2>$null
if ($LASTEXITCODE -ne 0) {
    if ($FromSource) {
        Say "ایمیج آماده نبود؛ از سورس ساخته می‌شود (۵ تا ۱۵ دقیقه)..." "No prebuilt image; building from source (5–15 minutes)..."
        docker compose build migrate
        if ($LASTEXITCODE -ne 0) { Fail "ساخت ایمیج ناموفق بود." "Image build failed." }
    } else { Fail "دریافت ایمیج ممکن نشد." "Could not pull the images." }
}
docker compose up -d
if ($LASTEXITCODE -ne 0) { Fail "اجرا ناموفق بود: docker compose logs" "Start failed: docker compose logs" }

$Url = "http://localhost:3000"
if ((Get-Content .env) -match "^PASOKH_TUNNEL=quick") {
    for ($i = 0; $i -lt 60; $i++) {
        $m = (docker compose logs web 2>$null | Select-String -Pattern "\[pasokh\] public URL: (https:\S+)" | Select-Object -Last 1)
        if ($m) { $Url = $m.Matches[0].Groups[1].Value; break }
        Start-Sleep -Seconds 2
    }
}

Write-Host ""
Say "✅ پاسخ اجرا شد: $Url" "✅ Pasokh is running: $Url"
Say "   آدرس را باز کنید، حساب مدیر را بسازید و در «تنظیمات» زرنیو را وصل کنید." "   Open it, create the owner account, then connect Zernio in Settings."
Say "   به‌روزرسانی: cd $Dir; docker compose pull; docker compose up -d" "   Update: cd $Dir; docker compose pull; docker compose up -d"
