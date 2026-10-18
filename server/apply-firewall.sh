#!/usr/bin/env bash
# Replace only our tables in one nft transaction; never flush the base firewall.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 2; }
[[ $# -le 1 ]] || { echo "usage: $0 [rules-file]" >&2; exit 2; }
rules=${1:-/etc/smartdns/firewall.nft}
batch=$(mktemp)
trap 'rm -f "$batch"' EXIT
for table in smartdns_access smartdns_guard; do
    if nft list table inet "$table" >/dev/null 2>&1; then
        printf 'delete table inet %s\n' "$table" >> "$batch"
    fi
done
cat "$rules" >> "$batch"
nft -c -f "$batch"
nft -f "$batch"
