# Установка и обслуживание

Команды Linux выполняются от root. Все адреса ниже — примеры для документации.
Замените `192.0.2.1` и `dns.example.com` параметрами **своего** сервера.

## Подготовка

Нужен чистый Ubuntu 24.04, собственный публичный IPv4, домен с A-записью на VPS,
SSH на TCP 22 и доступ к консоли провайдера. Сверьте SSH host key через консоль,
настройте ключ и проверьте отдельный вход. У провайдера разрешите TCP 22, 80, 443.

На ПК с Node.js 20+:

```powershell
Copy-Item config/server.example.json config/server.json
# Отредактировать config/server.json: свой IPv4 и DNS-имя.
npm test
npm run build
```

Рабочий конфиг и результаты сборки исключены из Git. Сохранённый конфиг примера
не позволит выполнить сетевые проверки или развёртывание. Локальная сборка примеров
возможна без доступа к сети и без рабочего конфига.

## Первая установка

В командах заменить пример адреса, DNS-имени и email:

```powershell
ssh root@192.0.2.1 'install -d -m 700 /root/smartdns-staging'
scp -r server build root@192.0.2.1:/root/smartdns-staging/
```

На VPS:

```sh
bash /root/smartdns-staging/server/install.sh dns.example.com admin@example.com /root/smartdns-staging/build
```

Установщик отклоняет адреса для документации и неподходящие параметры.
Он настраивает SSH по ключу, UFW, сертификат HTTP-01, loopback-слушатели dnsdist,
nginx stream и защиту внутренних назначений. TCP 80 нужен для продления сертификата;
прочие HTTP-пути возвращают 404. `-` вместо email создаёт ACME-аккаунт без email.

Старые конфиги сохраняются в `/root/smartdns-backup/installation.*`.
Это не снимок VPS: при сбое первой установки восстановите файлы через консоль.
Не запускайте установщик повторно для обновления работающего сервера.
Первая установка требует проверки в вашей среде; автономные тесты не заменяют её.

## Обновление каталога

Редактировать `config/services.json`, затем:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1
```

Выпуск загружается в отдельную папку `/root/smartdns-staging/release-*`.
Команда проверяет конфиги dnsdist/nginx и доступность DNS/TLS; при ошибке возвращает
предыдущие настройки. Последний успешный выпуск: `/root/smartdns-staging/current`.
Резервные копии: `/root/smartdns-backup/domain-update.*`.

Ручной откат (заменить `BACKUP` суффиксом фактической копии):

```sh
bash /root/smartdns-staging/current/server/rollback.sh /root/smartdns-backup/domain-update.BACKUP
```

Откат каталога не меняет режим доступа клиентов. Сгенерированные конфиги вручную
не редактировать — следующий build их перезапишет. `exact` выбирает ровно имя,
`suffix` — имя и поддомены: `cursor.sh` включает `api2.cursor.sh`, но не `evilcursor.sh`.

## Firewall

UFW должен запрещать входящие соединения по умолчанию, разрешая TCP 22/80/443.
Собственная таблица `inet smartdns_guard` защищает назначения nginx; она не заменяет UFW.
Ответы клиентам разрешены, новые соединения реле во внутренние сети блокируются.
Правила запускаются через `smartdns-firewall.service`, от которого зависит nginx.

Для первоначальной настройки или перехода с прежней схемы регистрации IP:

```sh
bash /root/smartdns-staging/server/configure-firewall.sh
```

Команда открывает доступ всем IPv4-клиентам и убирает прежний менеджер IP.
Применяет только собственные nft-таблицы, без `flush ruleset`.
Резервная копия firewall печатается в конце. Для отката:

```sh
bash /root/smartdns-backup/public-access.BACKUP/configure-firewall.sh --restore /root/smartdns-backup/public-access.BACKUP
```

## Проверки

На VPS:

```sh
ss -lntup
ufw status verbose
nft list table inet smartdns_guard
systemctl is-enabled smartdns-firewall.service
systemctl is-active nginx dnsdist smartdns-firewall.service
nginx -t
dnsdist --check-config -C /etc/dnsdist/dnsdist.conf
systemctl list-timers certbot.timer
certbot renew --dry-run --run-deploy-hooks
```

Публичные IPv4 TCP-слушатели: 22, 80, 443. dnsdist: 127.0.0.1:5300 и :8443.
Публичного DNS на 53 нет. С ПК с настроенным локальным конфигом:

```powershell
npm run check:dns
npm run check:https
npm run check:boundaries
# После ручного переключения системного DNS:
npm run check:client
```

Проверка границ по умолчанию пропускает TCP/UDP 53: локальные программы могут
блокировать или перехватывать DNS. Для полной проверки: `node scripts/check-boundaries.mjs`
вместе с наблюдением пакетов на VPS. Локальный EACCES не доказывает закрытый порт сервера.

Изолированная проверка firewall на Linux от root: `bash tests/firewall.sh`.
Она создаёт отдельный сетевой namespace и не меняет firewall хоста.

Суточный замер (ПК должен оставаться включённым и подключённым):

```powershell
node scripts/soak.mjs --samples 100 --duration-seconds 86400 --output results/soak-NEW.json
```

Незавершённый замер нельзя считать успешным. Файлы результатов не публикуются в Git.

## Сертификаты и журналы

ACME deploy-hook копирует сертификат для dnsdist и перезапускает его; при обновлении
возможна краткая недоступность DoH. nginx не расшифровывает TLS целевых сайтов.

`/var/log/nginx/smartdns-stream.log` содержит IP, SNI, upstream, объём и длительность
соединения. Строка появляется при закрытии TCP-сеанса. `status: 200` здесь означает
успешную пересылку TCP, а не HTTP-ответ целевого сайта.

Ошибки: `/var/log/nginx/error.log`, `journalctl -u dnsdist`, `journalctl -t sshd`.
HTTP/ACME имеет отдельный access.log. Контролируйте logrotate и заполнение диска;
ограничение journald из установщика не задаёт жёсткую квоту nginx-журналов.
Доступ к логам и резервным копиям ограничьте администратором. Правила публикации
и ограничения доступа описаны в [SECURITY.md](../SECURITY.md).
