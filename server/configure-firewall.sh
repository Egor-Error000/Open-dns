#!/usr/bin/env bash
# Migrate IP grants to public IPv4 access, preserving the relay destination guard.
set -euo pipefail
export LC_ALL=C
[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 2; }
files=(
    /etc/smartdns/firewall.nft /usr/local/sbin/smartdns-firewall
    /etc/systemd/system/smartdns-firewall.service
    /etc/systemd/system/nginx.service.d/smartdns-firewall.conf
    /etc/systemd/system/smartdns-expire.service
    /etc/systemd/system/smartdns-expire.timer
    /usr/local/sbin/smartdns-access /etc/smartdns/allowed.json /etc/smartdns/access.nft
)
restore() {
    local saved=$1 batch target
    [[ $saved =~ ^/root/smartdns-backup/public-access\.[A-Za-z0-9]+$ ]] || return 2
    test -f "$saved/complete"
    systemctl stop smartdns-expire.timer smartdns-expire.service 2>/dev/null || true
    batch=$(mktemp)
    for table in smartdns_access smartdns_guard; do
        if nft list table inet "$table" >/dev/null 2>&1; then
            printf 'delete table inet %s\n' "$table" >> "$batch"
        fi
        cat "$saved/$table.nft" >> "$batch"
    done
    nft -c -f "$batch" && nft -f "$batch"
    rm -f "$batch"
    for target in "${files[@]}"; do
        if [[ -f "$saved/files$target" ]]; then
            mkdir -p "$(dirname "$target")"
            cp -a "$saved/files$target" "$target"
        else
            rm -f "$target"
        fi
    done
    systemctl daemon-reload
    if [[ -f "$saved/expire-enabled" ]]; then systemctl enable smartdns-expire.timer; fi
    if [[ -f "$saved/expire-active" ]]; then systemctl start smartdns-expire.timer; fi
    if [[ -f "$saved/nginx-active" ]]; then systemctl start nginx.service; fi
    echo "Firewall restored from $saved"
}
if [[ ${1:-} == --restore && $# -eq 2 ]]; then restore "$2"; exit; fi
[[ $# -eq 0 ]] || { echo "usage: $0 [--restore BACKUP]" >&2; exit 2; }
here=$(cd -- "$(dirname -- "$0")" && pwd)
test -s "$here/firewall.nft"
test -s "$here/apply-firewall.sh"
# Public 443 relies on UFW to keep unrelated ports closed.
ufw_status=$(ufw status verbose)
grep -q 'Default: deny (incoming)' <<< "$ufw_status" || { echo 'UFW must deny incoming connections by default' >&2; exit 2; }
grep -Eq '^443/tcp[[:space:]]+ALLOW IN[[:space:]]+Anywhere[[:space:]]*$' <<< "$ufw_status" || { echo 'UFW must allow public TCP 443' >&2; exit 2; }
install -d -m 700 /root/smartdns-backup /etc/smartdns
backup=$(mktemp -d /root/smartdns-backup/public-access.XXXXXX)
cp -a "$0" "$backup/configure-firewall.sh"
for target in "${files[@]}"; do
    if [[ -f $target ]]; then
        mkdir -p "$backup/files$(dirname "$target")"
        cp -a "$target" "$backup/files$target"
    fi
done
for table in smartdns_access smartdns_guard; do
    if nft list table inet "$table" > "$backup/$table.nft" 2>/dev/null; then :; else
        : > "$backup/$table.nft"
    fi
done
if systemctl is-enabled --quiet smartdns-expire.timer 2>/dev/null; then touch "$backup/expire-enabled"; fi
if systemctl is-active --quiet smartdns-expire.timer; then touch "$backup/expire-active"; fi
if systemctl is-active --quiet nginx.service; then touch "$backup/nginx-active"; fi
touch "$backup/complete"
rollback() {
    result=$?
    trap - ERR
    restore "$backup"
    echo "Firewall migration failed; backup: $backup" >&2
    exit "$result"
}
trap rollback ERR
systemctl disable --now smartdns-expire.timer 2>/dev/null || true
systemctl stop smartdns-expire.service 2>/dev/null || true
install -m 600 "$here/firewall.nft" /etc/smartdns/firewall.nft
install -m 700 "$here/apply-firewall.sh" /usr/local/sbin/smartdns-firewall
cat > /etc/systemd/system/smartdns-firewall.service <<'UNIT'
[Unit]
Description=Smart DNS relay destination protection
Before=nginx.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/smartdns-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
install -d -m 755 /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/smartdns-firewall.conf <<'UNIT'
[Unit]
Requires=smartdns-firewall.service
After=smartdns-firewall.service
UNIT
systemctl daemon-reload
systemctl enable smartdns-firewall.service
systemctl restart smartdns-firewall.service
if [[ -f "$backup/nginx-active" ]]; then systemctl start nginx.service; fi
rm -f /etc/systemd/system/smartdns-expire.service /etc/systemd/system/smartdns-expire.timer
rm -f /usr/local/sbin/smartdns-access /etc/smartdns/allowed.json /etc/smartdns/access.nft
systemctl daemon-reload
trap - ERR
echo "Public IPv4 access active. Firewall backup: $backup"
