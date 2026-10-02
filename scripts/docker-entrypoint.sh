#!/bin/sh
# Starts a Pasokh role (web, worker, cron, migrate) with the right public URL.
#
# Instagram webhooks, tracked links and sign-in redirects all need the URL the
# outside world reaches this server at. With a domain it is fixed in .env
# (NEXTAUTH_URL). With a Cloudflare quick tunnel (PASOKH_TUNNEL=quick) it is
# random and changes every time the tunnel restarts, so it is read from the
# tunnel's metrics endpoint here instead of asking anyone to edit .env, and the
# role is restarted if the tunnel later comes back with a different URL. The
# worker then re-points the Zernio webhook on start (lib/zernio/sync-webhooks).
set -eu

TUNNEL_METRICS="${PASOKH_TUNNEL_METRICS:-http://cloudflared:2000/quicktunnel}"

tunnel_host() {
  wget -q -T 5 -O- "$TUNNEL_METRICS" 2>/dev/null \
    | sed -n 's/.*"hostname" *: *"\([^"]*\)".*/\1/p'
}

if [ "${PASOKH_TUNNEL:-}" != "quick" ]; then
  exec "$@"
fi

host=""
tries=0
while [ -z "$host" ]; do
  host="$(tunnel_host)"
  if [ -z "$host" ]; then
    tries=$((tries + 1))
    if [ "$tries" -ge 90 ]; then
      echo "[pasokh] the quick tunnel has no public URL after 3 minutes; check: docker compose logs cloudflared" >&2
      exit 1
    fi
    sleep 2
  fi
done

url="https://$host"
# The public URL goes to PASOKH_PUBLIC_URL (webhooks, tracked links), not to
# NEXTAUTH_URL: with that unset, Auth.js redirects to whichever host the person
# signed in on, so both the tunnel address and http://localhost work.
unset NEXTAUTH_URL AUTH_URL
export PASOKH_PUBLIC_URL="$url"
echo "[pasokh] public URL: $url"

"$@" &
child=$!
trap 'kill -TERM "$child" 2>/dev/null; wait "$child"; exit 0' TERM INT

while kill -0 "$child" 2>/dev/null; do
  sleep 30 &
  wait $! || true
  now="$(tunnel_host)"
  if [ -n "$now" ] && [ "$now" != "$host" ]; then
    echo "[pasokh] the tunnel URL changed to https://$now; restarting to use it"
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" || true
    # Non-zero so the restart policy brings the role back with the new URL.
    exit 3
  fi
done

wait "$child"
