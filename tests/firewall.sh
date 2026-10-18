#!/usr/bin/env bash
# Run on Linux as root. All rules and packets stay inside a fresh net namespace.
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
if [[ ${1:-} != --inside ]]; then exec unshare --net bash "$0" --inside; fi
project=$(dirname "$here")
temporary=$(mktemp -d)
children=()
cleanup() {
    for child in "${children[@]}"; do kill "$child" 2>/dev/null || true; done
    rm -rf -- "$temporary"
}
trap cleanup EXIT
ip link set lo up
ip addr add 198.51.100.1/32 dev lo
ip addr add 198.51.100.2/32 dev lo
ip addr add 10.0.0.1/32 dev lo
printf 'ok\n' > "$temporary/index.html"
chmod 755 "$temporary"
for port in 443 8443 8080; do
    if [[ $port == 8443 ]]; then
        runuser -u www-data -- python3 -m http.server "$port" --bind 0.0.0.0 --directory "$temporary" >/dev/null 2>&1 &
    else
        python3 -m http.server "$port" --bind 0.0.0.0 --directory "$temporary" >/dev/null 2>&1 &
    fi
    children+=("$!")
done
curl_args=(--noproxy '*' --silent --show-error --fail --max-time 1)
for attempt in {1..30}; do
    if curl "${curl_args[@]}" http://127.0.0.1:8443/ >/dev/null 2>&1 &&
       curl "${curl_args[@]}" http://10.0.0.1:443/ >/dev/null 2>&1 &&
       curl "${curl_args[@]}" http://127.0.0.1:8080/ >/dev/null 2>&1; then break; fi
    sleep 0.1
done
curl "${curl_args[@]}" http://10.0.0.1:443/ >/dev/null
nft -f - <<'NFT'
table inet unrelated {
    chain input {
        type filter hook input priority 0; policy accept;
    }
}
table inet smartdns_access {
    chain input {
        type filter hook input priority -5; policy accept;
        ip saddr != 203.0.113.1 tcp dport 443 drop
    }
}
NFT
if curl "${curl_args[@]}" --interface 198.51.100.1 http://198.51.100.2:443/ >/dev/null 2>&1; then
    echo 'legacy restriction did not block the new source' >&2; exit 1
fi
bash "$project/server/apply-firewall.sh" "$project/server/firewall.nft"
if nft list table inet smartdns_access >/dev/null 2>&1; then echo 'legacy table remains' >&2; exit 1; fi
nft list table inet unrelated >/dev/null
curl "${curl_args[@]}" --interface 198.51.100.1 http://198.51.100.2:443/ >/dev/null
runuser -u www-data -- curl "${curl_args[@]}" http://127.0.0.1:8443/ >/dev/null
curl "${curl_args[@]}" http://127.0.0.1:8443/ >/dev/null
for url in http://127.0.0.1:8080/ http://10.0.0.1:443/; do
    if runuser -u www-data -- curl "${curl_args[@]}" "$url" >/dev/null 2>&1; then
        echo "private destination accepted: $url" >&2; exit 1
    fi
done
# Reapplying must preserve UFW/other tables; failed validation must preserve ours.
bash "$project/server/apply-firewall.sh" "$project/server/firewall.nft"
nft list table inet unrelated >/dev/null
before=$(nft list table inet smartdns_guard)
printf 'invalid nft syntax\n' > "$temporary/invalid.nft"
if bash "$project/server/apply-firewall.sh" "$temporary/invalid.nft" >/dev/null 2>&1; then exit 1; fi
[[ $(nft list table inet smartdns_guard) == "$before" ]]
echo 'Firewall passed: public source allowed, local DoH reachable, private destinations blocked, unrelated rules retained, failed transaction unchanged.'
