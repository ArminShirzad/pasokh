#!/usr/bin/env bash
# Pasokh installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/ArminShirzad/pasokh/main/install.sh | bash
#
# Safe to run again: an existing installation keeps its .env (secrets and
# settings) and is just updated and restarted.
set -euo pipefail

REPO_RAW="${PASOKH_REPO_RAW:-https://raw.githubusercontent.com/ArminShirzad/pasokh/main}"
LANG_CHOICE="${PASOKH_LANG:-}"

# Reads answers from the terminal even when the script itself arrives on stdin.
TTY=/dev/tty
ask() { # ask <var> <prompt> [default]
  local __var="$1" __prompt="$2" __default="${3:-}" __answer=""
  if [ -r "$TTY" ]; then
    printf '%s ' "$__prompt" > "$TTY"
    IFS= read -r __answer < "$TTY" || true
  fi
  printf -v "$__var" '%s' "${__answer:-$__default}"
}
say() { if [ "$LANG_CHOICE" = "en" ]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi; }
die() { say "❌ $1" "❌ $2" >&2; exit 1; }

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# ── Language ────────────────────────────────────────────────────────────────
if [ -z "$LANG_CHOICE" ]; then
  echo "Pasokh / پاسخ"
  echo "  1) فارسی"
  echo "  2) English"
  ask choice "Language / زبان [1]:" 1
  if [ "$choice" = "2" ]; then LANG_CHOICE=en; else LANG_CHOICE=fa; fi
fi

# ── Docker ──────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ]; then
    say "داکر نصب نیست. نصبش کنم؟ (از get.docker.com)" "Docker is not installed. Install it now (from get.docker.com)?"
    ask yn "[Y/n]:" y
    case "$yn" in
      n|N) die "بدون داکر نمی‌شود ادامه داد. راهنما: https://docs.docker.com/engine/install/" "Pasokh needs Docker: https://docs.docker.com/engine/install/" ;;
    esac
    SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
    curl -fsSL https://get.docker.com | $SUDO sh \
      || die "نصب داکر انجام نشد. اگر سرور در ایران است، از میرور داکر استفاده کنید (راهنمای README)." "Docker installation failed."
  else
    die "Docker Desktop را نصب و اجرا کنید و دوباره همین دستور را بزنید: https://www.docker.com/products/docker-desktop/" \
        "Install and start Docker Desktop, then run this again: https://www.docker.com/products/docker-desktop/"
  fi
fi
docker info >/dev/null 2>&1 || die "داکر اجرا نمی‌شود (یا دسترسی ندارید). با sudo اجرا کنید یا Docker Desktop را باز کنید." \
                                  "Docker is not running or not accessible. Try with sudo, or start Docker Desktop."

# ── Can this server reach Instagram? ────────────────────────────────────────
# Instagram and Zernio are unreachable from inside Iran without a proxy; a
# server there installs fine and then silently never answers anyone.
reach() { curl -s -o /dev/null -m 10 "$1"; }
if [ "${PASOKH_SKIP_NET_CHECK:-}" != "1" ] && { ! reach https://graph.instagram.com || ! reach https://zernio.com; }; then
  say "⚠️  این سرور به اینستاگرام یا زرنیو دسترسی ندارد. پاسخ باید روی سروری خارج از ایران نصب شود، وگرنه هیچ پیامی دریافت یا ارسال نمی‌شود." \
      "⚠️  This server cannot reach Instagram or Zernio. Pasokh must run where both are reachable (outside Iran), or no message will ever be received or sent."
  ask cont "$(say 'باز هم ادامه بدهم؟ [y/N]:' 'Continue anyway? [y/N]:')" n
  case "$cont" in y|Y) ;; *) exit 1 ;; esac
fi

# ── Where ───────────────────────────────────────────────────────────────────
if [ -f docker-compose.yml ] && [ -f Dockerfile ] && grep -q "name: pasokh" docker-compose.yml 2>/dev/null; then
  DIR="$(pwd)"            # running inside a source checkout
  FROM_SOURCE=1
else
  DIR="${PASOKH_DIR:-$HOME/pasokh}"
  FROM_SOURCE=0
  mkdir -p "$DIR"
  for f in docker-compose.yml Caddyfile .env.example; do
    curl -fsSL "$REPO_RAW/$f" -o "$DIR/$f" || die "دریافت $f ممکن نشد." "Could not download $f."
  done
fi
cd "$DIR"

# ── Settings (first install only) ───────────────────────────────────────────
if [ -f .env ]; then
  say "✓ نصب قبلی پیدا شد؛ تنظیمات و رمزها حفظ می‌شوند." "✓ Existing installation found; keeping its settings and secrets."
else
  say "" ""
  say "سرور شما چطور از اینترنت در دسترس باشد؟" "How should the internet reach this server?"
  say "  1) تونل سریع کلودفلر — بدون دامنه، برای شروع و تست (آدرس با هر ری‌استارت عوض می‌شود و پاسخ خودش را به‌روز می‌کند)" \
      "  1) Cloudflare quick tunnel — no domain needed, good to start (the URL changes on restart; Pasokh follows it)"
  say "  2) دامنهٔ خودم با HTTPS خودکار (پورت ۸۰ و ۴۴۳ باز، رکورد A دامنه به IP این سرور)" \
      "  2) My own domain with automatic HTTPS (ports 80/443 open, DNS A record → this server)"
  say "  3) تونل دائمی کلودفلر با توکن (آدرس ثابت، بدون باز کردن پورت)" \
      "  3) Cloudflare named tunnel with a token (fixed URL, no open ports)"
  say "  4) فقط روی همین کامپیوتر (http://localhost:3000) — اینستاگرام به آن نمی‌رسد" \
      "  4) This computer only (http://localhost:3000) — Instagram cannot reach it"
  # PASOKH_MODE (1-4) answers this without a prompt, for scripted installs.
  mode="${PASOKH_MODE:-}"
  [ -n "$mode" ] || ask mode "[1]:" 1

  PROFILES=""; TUNNEL=""; PUBLIC_URL="http://localhost:3000"; DOMAIN=""; CF_TOKEN=""
  case "$mode" in
    2)
      ask DOMAIN "$(say 'دامنه (مثلاً pasokh.example.com):' 'Domain (e.g. pasokh.example.com):')"
      DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
      [ -n "$DOMAIN" ] || die "دامنه خالی است." "No domain given."
      PROFILES=domain; PUBLIC_URL="https://$DOMAIN" ;;
    3)
      ask CF_TOKEN "$(say 'توکن تونل کلودفلر:' 'Cloudflare tunnel token:')"
      ask host "$(say 'آدرسی که در کلودفلر به http://web:3000 وصل کرده‌اید (مثلاً pasokh.example.com):' 'Public hostname you routed to http://web:3000 in Cloudflare (e.g. pasokh.example.com):')"
      host="${host#https://}"; host="${host%%/*}"
      [ -n "$CF_TOKEN" ] && [ -n "$host" ] || die "توکن و آدرس هر دو لازم‌اند." "Both the token and the hostname are needed."
      PROFILES=cloudflare; PUBLIC_URL="https://$host" ;;
    4) ;;
    *) PROFILES=quick; TUNNEL=quick ;;
  esac

  if [ "$LANG_CHOICE" = "fa" ]; then LOCALE=fa; TZV=Asia/Tehran; else LOCALE=en; TZV="${TZ:-UTC}"; fi

  # Port 3000 is a popular default; if another app already has it, take the
  # next free one instead of failing to start.
  port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
  APP_PORT="${PASOKH_PORT:-3000}"
  if [ -z "${PASOKH_PORT:-}" ]; then
    for p in 3000 3100 3200 3300 3400 3500 3600 3700 3800 3900; do
      if port_free "$p"; then APP_PORT="$p"; break; fi
    done
  fi
  [ "$PUBLIC_URL" = "http://localhost:3000" ] && PUBLIC_URL="http://localhost:$APP_PORT"

  umask 077
  cat > .env <<EOF
# Written by install.sh on $(date -u +%Y-%m-%d). See .env.example for every option.
NEXTAUTH_SECRET=$(secret 32)
CRON_SECRET=$(secret 32)
ENCRYPTION_KEY=$(secret 32)
POSTGRES_PASSWORD=$(secret 16)

COMPOSE_PROFILES=$PROFILES
PASOKH_TUNNEL=$TUNNEL
NEXTAUTH_URL=$PUBLIC_URL
PASOKH_DOMAIN=$DOMAIN
CLOUDFLARE_TUNNEL_TOKEN=$CF_TOKEN

PASOKH_PORT=$APP_PORT

DEFAULT_LOCALE=$LOCALE
TZ=$TZV
EOF
  say "✓ تنظیمات در $DIR/.env ذخیره شد (از آن نسخهٔ پشتیبان بگیرید)." "✓ Settings saved to $DIR/.env (keep a backup of it)."
fi

# ── Start ───────────────────────────────────────────────────────────────────
IMAGE="${PASOKH_IMAGE:-$(sed -n 's/^PASOKH_IMAGE=//p' .env)}"
if [ -n "$IMAGE" ] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  # A pinned image that is already here (loaded from a file on an offline
  # server, or built locally) is used as is.
  say "✓ ایمیج $IMAGE روی سرور موجود است." "✓ Using image $IMAGE already on this server."
  docker compose pull --quiet --ignore-pull-failures postgres redis 2>/dev/null || true
else
say "⏳ دریافت ایمیج‌ها (بار اول چند دقیقه طول می‌کشد)..." "⏳ Pulling images (a few minutes the first time)..."
if ! docker compose pull --quiet 2>/dev/null; then
  if [ "$FROM_SOURCE" = "1" ]; then
    say "ایمیج آماده در دسترس نبود؛ از سورس ساخته می‌شود (۵ تا ۱۵ دقیقه)..." "Prebuilt image unavailable; building from source (5–15 minutes)..."
    # One build: every app service shares this image, and parallel builds race.
    docker compose build migrate
  else
    die "دریافت ایمیج ممکن نشد. اتصال اینترنت سرور را بررسی کنید." "Could not pull the images. Check the server's internet connection."
  fi
fi
fi
docker compose up -d

PORT="${PASOKH_PORT:-$(sed -n 's/^PASOKH_PORT=//p' .env)}"; PORT="${PORT:-3000}"
# Wait for Pasokh itself: /api/health answers with JSON carrying "checks"; a
# different app that happens to answer on this port does not.
for _ in $(seq 1 90); do
  if curl -s -m 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"checks"'; then break; fi
  sleep 2
done

URL="$(sed -n 's/^NEXTAUTH_URL=//p' .env)"
if grep -q '^PASOKH_TUNNEL=quick' .env; then
  URL=""
  for _ in $(seq 1 60); do
    URL="$(docker compose logs web 2>/dev/null | sed -n 's/.*\[pasokh\] public URL: \(https:[^ ]*\).*/\1/p' | tail -1)"
    [ -n "$URL" ] && break
    sleep 2
  done
fi

echo
say "✅ پاسخ اجرا شد." "✅ Pasokh is running."
say "   آدرس: ${URL:-http://localhost:$PORT}" "   Address: ${URL:-http://localhost:$PORT}"
say "   این آدرس را باز کنید و حساب مدیر را بسازید. بعد در «تنظیمات» کلید API زرنیو را وارد کنید و اینستاگرام را وصل کنید." \
    "   Open it and create the owner account. Then, in Settings, paste a Zernio API key and connect Instagram."
if grep -q '^PASOKH_TUNNEL=quick' .env; then
  say "   آدرس تونل سریع بعد از ری‌استارت عوض می‌شود؛ آدرس جدید: cd $DIR && docker compose logs web | grep 'public URL'" \
      "   The quick-tunnel address changes after a restart; find the new one: cd $DIR && docker compose logs web | grep 'public URL'"
fi
say "   به‌روزرسانی: cd $DIR && docker compose pull && docker compose up -d" "   Update:  cd $DIR && docker compose pull && docker compose up -d"
say "   رمز فراموش‌شده: cd $DIR && docker compose exec web npm run user:password -- you@example.com" \
    "   Forgot password: cd $DIR && docker compose exec web npm run user:password -- you@example.com"
