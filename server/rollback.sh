#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 && $1 =~ ^/root/smartdns-backup/domain-update\.[A-Za-z0-9]+$ ]] || exit 2
backup=$1
test -s "$backup/dnsdist.conf"
test -s "$backup/smartdns.conf"
cp -a "$backup/dnsdist.conf" /etc/dnsdist/dnsdist.conf
cp -a "$backup/smartdns.conf" /etc/nginx/stream.d/smartdns.conf
for metadata in services.json server.json active-profiles.json; do
    if [[ -f "$backup/$metadata" ]]; then
        cp -a "$backup/$metadata" "/etc/smartdns/$metadata"
    else
        rm -f "/etc/smartdns/$metadata"
    fi
done
dnsdist --check-config -C /etc/dnsdist/dnsdist.conf
nginx -t
systemctl reload nginx
systemctl restart dnsdist
systemctl is-active --quiet nginx dnsdist
echo "Restored $backup"
