#!/usr/bin/env bash
set -euo pipefail
systemctl reload nginx
if [[ -f /etc/smartdns/doh-name ]]; then
    domain=$(cat /etc/smartdns/doh-name)
    account=$(systemctl show dnsdist.service -p User --value)
    [[ -n $account ]] || account=root
    group=$(id -gn "$account")
    install -o root -g "$group" -m 644 "/etc/letsencrypt/live/$domain/fullchain.pem" /etc/dnsdist/cert.pem
    install -o root -g "$group" -m 640 "/etc/letsencrypt/live/$domain/privkey.pem" /etc/dnsdist/key.pem
    systemctl restart dnsdist
fi
