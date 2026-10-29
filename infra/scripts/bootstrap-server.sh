#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu/Debian server (Hetzner Cloud) for SchoolSync.
# Safe to run again: it never overwrites an existing .env and never regenerates secrets.
#
#   scp infra/scripts/bootstrap-server.sh root@SERVER_IP:/root/
#   ssh root@SERVER_IP 'bash /root/bootstrap-server.sh --domain schoolsync.example.com --email you@example.com \
#        --deploy-key "ssh-ed25519 AAAA... github-actions-deploy"'
#
# What it sets up: Docker, a `deploy` user (the only way GitHub Actions gets in, by SSH key), /opt/schoolsync with a
# generated .env (random secrets), a firewall (22, 80, 443), fail2ban, automatic security updates, swap on small servers,
# a nightly per-school backup, and a `schoolsync` shortcut for docker compose.
#
# SHARED SERVER (another app already runs here, with its own reverse proxy on ports 80/443):
#   bash bootstrap-server.sh --shared --edge-network <proxy's docker network> --domain ... --email ... --deploy-key "..."
# Shared mode only adds SchoolSync: it does NOT touch the firewall, SSH settings, swap, installed packages or other containers,
# publishes no ports, and uses smaller defaults. Find the network with: docker inspect <proxy container> --format '{{json .NetworkSettings.Networks}}'
set -Eeuo pipefail

DOMAIN=""; EMAIL=""; DEPLOY_KEY=""; ADMIN_EMAIL=""; HARDEN_SSH=0; SWAP_GB=""; SHARED=0; EDGE_NETWORK=""
APP_DIR=/opt/schoolsync

die() { echo "error: $*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
usage: bootstrap-server.sh --domain <base domain> --email <contact email> --deploy-key "<ssh public key>" [options]
  --domain       the domain schools live under, e.g. schoolsync.example.com (DNS: A records for @ and *)
  --email        used for Let's Encrypt certificates and as the first operator's address
  --deploy-key   the PUBLIC half of the SSH key GitHub Actions deploys with
  --admin-email  first operator console account (default: --email)
  --swap-gb N    create an N GB swap file (default: 2 GB when the server has under 4 GB RAM)
  --harden-ssh   disable SSH password login and root password login (only do this once your own key works!)
  --shared       another app already uses ports 80/443 here: add SchoolSync behind that app's reverse proxy, change nothing else
  --edge-network the Docker network the existing reverse proxy is on (required with --shared)
USAGE
  exit 1
}
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --deploy-key) DEPLOY_KEY="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --swap-gb) SWAP_GB="${2:-}"; shift 2 ;;
    --harden-ssh) HARDEN_SSH=1; shift ;;
    --shared) SHARED=1; shift ;;
    --edge-network) EDGE_NETWORK="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" = 0 ] || die "run as root"
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] && [ -n "$DEPLOY_KEY" ] || usage
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "--domain must be a plain domain name such as schoolsync.example.com"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "--email does not look like an email address"
[[ "$DEPLOY_KEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+)\ [A-Za-z0-9+/=]+ ]] || die "--deploy-key must be an SSH PUBLIC key (starts with ssh-ed25519 ...)"
if [ "$SHARED" = 1 ]; then
  [ -n "$EDGE_NETWORK" ] || die "--shared needs --edge-network (the Docker network of the existing reverse proxy)"
  command -v docker >/dev/null 2>&1 || die "--shared expects Docker to be installed already"
  docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || die "Docker network '$EDGE_NETWORK' does not exist (see: docker network ls)"
  [ "$HARDEN_SSH" = 0 ] || die "--harden-ssh is not available with --shared (it would change the server's SSH settings)"
fi
ADMIN_EMAIL="${ADMIN_EMAIL:-$EMAIL}"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) die "this script supports Ubuntu and Debian (found ${ID:-unknown})" ;; esac

step() { printf '\n==> %s\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive
if [ "$SHARED" = 1 ]; then
  step "packages (shared server: only what SchoolSync's scripts need)"
  apt-get install -y openssl cron >/dev/null
else
  step "packages and automatic security updates"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades cron openssl
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

  step "Docker"
  if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || die "docker compose plugin is missing; install docker-compose-plugin"

step "deploy user"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys || printf '%s\n' "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys

step "application folder $APP_DIR"
install -d -m 755 -o deploy -g deploy "$APP_DIR" "$APP_DIR/backups"

MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
echo "server memory: ${MEM_MB} MB"

step "swap"
if [ "$SHARED" = 1 ]; then
  echo "shared server: swap left as it is"
  SWAP_GB=""
elif [ -z "$SWAP_GB" ] && [ "$MEM_MB" -lt 3900 ] && [ "$(swapon --show --noheadings | wc -l)" = 0 ]; then SWAP_GB=2; fi
if [ -n "$SWAP_GB" ] && [ "$(swapon --show --noheadings | wc -l)" = 0 ]; then
  fallocate -l "${SWAP_GB}G" /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "swap file of ${SWAP_GB} GB enabled"
else
  echo "no swap change"
fi

step "configuration ($APP_DIR/.env)"
ENV_FILE="$APP_DIR/.env"
NEW_ENV=0
if [ -f "$ENV_FILE" ]; then
  echo ".env already exists: left untouched"
else
  NEW_ENV=1
  REPLICAS=1; [ "$MEM_MB" -ge 7000 ] && REPLICAS=2
  SB=$(( MEM_MB / 8 )); [ "$SB" -gt 1024 ] && SB=1024; [ "$SB" -lt 128 ] && SB=128
  if [ "$SHARED" = 1 ]; then REPLICAS=1; SB=128; fi   # other apps need the memory too
  rand() { openssl rand -base64 "$1" | tr -d '\n'; }
  ADMIN_PW="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 14)Aa1x"
  umask 077
  cat > "$ENV_FILE" <<ENVEOF
# SchoolSync production configuration. NEVER commit this file. Created by bootstrap-server.sh.
BASE_DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL

PG_USER=postgres
PG_PASSWORD=$(openssl rand -hex 24)
PG_SHARED_BUFFERS=${SB}MB
CONTROL_DB=schoolsync_control
API_REPLICAS=$REPLICAS

JWT_SECRET=$(rand 48)
APP_ENCRYPTION_KEY=$(rand 48)
PLATFORM_API_KEY=$(rand 36)
# First operator (operator console at https://$DOMAIN/platform): created at startup while none exists.
# Sign in, choose a new password, then delete the next two lines.
PLATFORM_ADMIN_EMAIL=$ADMIN_EMAIL
PLATFORM_ADMIN_PASSWORD=$ADMIN_PW

PUBLIC_API_URL=https://$DOMAIN
# where people open the web app; {code} becomes the school's code (links in password-reset emails and receipts)
PUBLIC_WEB_URL=https://{code}.$DOMAIN
CORS_ORIGINS=https://$DOMAIN
MIN_APP_VERSION=1.0.0

# Platform default email sender (each school can add its own accounts in Settings). Leave SMTP_URL empty to only log emails.
SMTP_URL=
MAIL_FROM=SchoolSync <no-reply@$DOMAIN>
# Push notifications: paste the Firebase service-account JSON on one line
FIREBASE_SERVICE_ACCOUNT_JSON=

# Set by the deploy script on every release:
REGISTRY=
IMAGE_TAG=
ENVEOF
  if [ "$SHARED" = 1 ]; then
    cat >> "$ENV_FILE" <<SHAREDEOF

# SHARED SERVER: SchoolSync runs behind the existing reverse proxy (see infra/docker-compose.shared.yml, infra/caddy/existing-caddy.snippet)
COMPOSE_FILE=docker-compose.yml:docker-compose.shared.yml
EDGE_NETWORK=$EDGE_NETWORK
# Names other apps on $DOMAIN already use (comma separated): no school may take them. Add yours, then: schoolsync up -d
RESERVED_SITE_CODES_EXTRA=
# Memory ceilings per container (defaults are small on purpose). Raise them when you move SchoolSync to a bigger server.
# API_MEM=768m   WEB_MEM=768m   PG_MEM=1g   REDIS_MEM=192m
SHAREDEOF
  fi
  chown deploy:deploy "$ENV_FILE"; chmod 600 "$ENV_FILE"
  echo ".env created with generated secrets (API replicas: $REPLICAS, Postgres shared buffers: ${SB}MB)"
fi

step "shortcut: schoolsync <docker compose command>"
cat > /usr/local/bin/schoolsync <<'SHEOF'
#!/usr/bin/env bash
cd /opt/schoolsync && exec docker compose "$@"
SHEOF
chmod 755 /usr/local/bin/schoolsync

step "nightly backup (02:30, kept 14 days)"
touch /var/log/schoolsync-backup.log; chown deploy:deploy /var/log/schoolsync-backup.log
printf '30 2 * * * deploy /opt/schoolsync/backup-docker.sh /opt/schoolsync/backups >> /var/log/schoolsync-backup.log 2>&1\n' > /etc/cron.d/schoolsync-backup
chmod 644 /etc/cron.d/schoolsync-backup

if [ "$SHARED" = 1 ]; then
  step "firewall, SSH and other services"
  echo "shared server: left exactly as they are"
else
  step "firewall and brute-force protection"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  systemctl enable --now fail2ban
fi

if [ "$HARDEN_SSH" = 1 ]; then
  step "SSH hardening"
  [ -s /root/.ssh/authorized_keys ] || [ -s /home/deploy/.ssh/authorized_keys ] || die "no SSH keys are installed: refusing to disable passwords"
  printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/99-schoolsync.conf
  sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd
elif [ "$SHARED" = 0 ]; then
  echo
  echo "note: SSH password login was left as it is. Once your own key works, re-run with --harden-ssh."
fi

cat <<DONE

==============================================================================
Server is ready.

Next:
  1. In GitHub add the secrets and variables from infra/DEPLOY-HETZNER.md, then push to main.
DONE
if [ "$SHARED" = 1 ]; then
cat <<DONE
  2. SHARED SERVER: add the two blocks from infra/caddy/existing-caddy.snippet to the Caddyfile of the proxy that owns
     ports 80/443, reload it, and make sure that proxy is on the Docker network "$EDGE_NETWORK".
  3. After the first deploy the operator console is at  https://admin.$DOMAIN/platform
DONE
else
cat <<DONE
  2. After the first deploy the operator console is at  https://$DOMAIN/platform
DONE
fi
if [ "$NEW_ENV" = 1 ]; then
cat <<DONE
     first operator:  $ADMIN_EMAIL
     temporary password (shown once, also in $ENV_FILE):  $ADMIN_PW
     You must choose a new password at first sign-in; then delete PLATFORM_ADMIN_PASSWORD from $ENV_FILE.
DONE
fi
echo "=============================================================================="
