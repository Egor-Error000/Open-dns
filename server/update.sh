#!/usr/bin/env bash
# Install generated configs and their metadata as one recoverable release.
set -euo pipefail
[[ $# -eq 1 ]] || { echo "usage: $0 <generated-directory>" >&2; exit 2; }
rendered=$1
here=$(cd -- "$(dirname -- "$0")" && pwd)
[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 2; }
test -s "$rendered/dnsdist.conf"
test -s "$rendered/nginx-stream.conf"
for metadata in services.json server.json active-profiles.json; do test -s "$rendered/$metadata"; done
test -s "$here/rollback.sh"
dnsdist --check-config -C "$rendered/dnsdist.conf"
install -d -m 700 /root/smartdns-backup
backup=$(mktemp -d /root/smartdns-backup/domain-update.XXXXXX)
cp -a /etc/dnsdist/dnsdist.conf "$backup/dnsdist.conf"
cp -a /etc/nginx/stream.d/smartdns.conf "$backup/smartdns.conf"
for metadata in services.json server.json active-profiles.json; do
    if [[ -f /etc/smartdns/$metadata ]]; then cp -a "/etc/smartdns/$metadata" "$backup/$metadata"; fi
done
rollback() {
    result=$?
    trap - ERR
    bash "$here/rollback.sh" "$backup"
    echo "Update failed; previous configuration restored from $backup" >&2
    exit "$result"
}
trap rollback ERR
install -m 644 "$rendered/nginx-stream.conf" /etc/nginx/stream.d/smartdns.conf
nginx -t
systemctl reload nginx
install -m 644 "$rendered/dnsdist.conf" /etc/dnsdist/dnsdist.conf
systemctl restart dnsdist
systemctl is-active --quiet nginx dnsdist
for metadata in services.json server.json active-profiles.json; do
    install -m 600 "$rendered/$metadata" "/etc/smartdns/$metadata"
done
trap - ERR
echo "Domain update active. Previous configuration: $backup"
