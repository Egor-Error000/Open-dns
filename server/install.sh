#!/usr/bin/env bash
# First installation on a clean Ubuntu 24.04 VPS. Updates use update.sh.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 2; }
[[ $# -eq 3 ]] || { echo "usage: $0 <doh-hostname> <certificate-email-or-dash> <generated-directory>" >&2; exit 2; }
host=$1
email=$2
rendered=$3
here=$(cd -- "$(dirname -- "$0")" && pwd)
[[ $host =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $host == *.* ]] || exit 2
[[ $email == - || $email == *@*.* ]] || exit 2
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || { echo 'expected Ubuntu 24.04' >&2; exit 2; }
[[ ! -f /etc/nginx/stream.d/smartdns.conf ]] || { echo 'already installed; use update.sh' >&2; exit 2; }
for file in dnsdist.conf nginx-stream.conf services.json server.json active-profiles.json; do test -s "$rendered/$file"; done
grep -Fq "$host 127.0.0.1:8443;" "$rendered/nginx-stream.conf"
python3 - "$rendered/server.json" "$host" <<'PY'
import ipaddress
import json
import re
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    endpoint = json.load(source)
hostname = endpoint['dohHostname']
if (not ipaddress.IPv4Address(endpoint['ipv4']).is_global or hostname != sys.argv[2]
        or re.search(r'(?:^|\.)(?:example\.(?:com|org|net)|example|invalid|test|localhost|local)$', hostname)
        or endpoint.get('sshUser') != 'root'):
    raise SystemExit('Configure your own public endpoint before installation')
PY
# Verify a separate key login and provider console access before running this.
ssh-keygen -lf /root/.ssh/authorized_keys >/dev/null
/usr/sbin/sshd -T | grep -qx 'port 22'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends nginx libnginx-mod-stream dnsdist certbot ca-certificates ufw nftables
if grep -Eq '^[[:space:]]*stream[[:space:]]*\{' /etc/nginx/nginx.conf; then
    echo 'existing nginx stream block; inspect before installation' >&2; exit 2
fi
install -d -m 700 /root/smartdns-backup /etc/smartdns
backup=$(mktemp -d /root/smartdns-backup/installation.XXXXXX)
cp -a /etc/nginx "$backup/nginx"
cp -a /etc/dnsdist/dnsdist.conf "$backup/dnsdist.conf"
cp -a /etc/ssh/sshd_config.d "$backup/sshd_config.d"
cat > /etc/ssh/sshd_config.d/00-smartdns.conf <<'SSH'
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSH
/usr/sbin/sshd -t
/usr/sbin/sshd -T | grep -qx 'passwordauthentication no'
systemctl reload ssh
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
install -d -m 755 /etc/systemd/journald.conf.d /var/www/smartdns-acme
cat > /etc/systemd/journald.conf.d/smartdns-disk.conf <<'JOURNAL'
[Journal]
SystemMaxUse=100M
RuntimeMaxUse=30M
SystemKeepFree=1G
JOURNAL
systemctl restart systemd-journald
cat > /etc/nginx/sites-available/smartdns <<NGINX
server {
    listen 80;
    server_name $host;
    location /.well-known/acme-challenge/ { root /var/www/smartdns-acme; }
    location / { return 404; }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/smartdns /etc/nginx/sites-enabled/smartdns
nginx -t
systemctl enable --now nginx
systemctl reload nginx
contact=(--email "$email")
if [[ $email == - ]]; then contact=(--register-unsafely-without-email); fi
certbot certonly --webroot -w /var/www/smartdns-acme --non-interactive --agree-tos "${contact[@]}" -d "$host"
install -m 755 "$here/renew-certificate.sh" /etc/letsencrypt/renewal-hooks/deploy/smartdns-reload
printf '%s\n' "$host" > /etc/smartdns/doh-name
account=$(systemctl show dnsdist.service -p User --value)
[[ -n $account ]] || account=root
group=$(id -gn "$account")
install -o root -g "$group" -m 644 "/etc/letsencrypt/live/$host/fullchain.pem" /etc/dnsdist/cert.pem
install -o root -g "$group" -m 640 "/etc/letsencrypt/live/$host/privkey.pem" /etc/dnsdist/key.pem
dnsdist --check-config -C "$rendered/dnsdist.conf"
bash "$here/configure-firewall.sh"
install -d -m 755 /etc/nginx/stream.d
cat >> /etc/nginx/nginx.conf <<'NGINX'

stream {
    include /etc/nginx/stream.d/*.conf;
}
NGINX
install -m 644 "$rendered/nginx-stream.conf" /etc/nginx/stream.d/smartdns.conf
install -m 644 "$rendered/dnsdist.conf" /etc/dnsdist/dnsdist.conf
for metadata in services.json server.json active-profiles.json; do
    install -m 600 "$rendered/$metadata" "/etc/smartdns/$metadata"
done
nginx -t
systemctl enable --now dnsdist certbot.timer
systemctl restart dnsdist nginx
systemctl is-active --quiet nginx dnsdist
echo "Installed. Initial configuration backup: $backup"
