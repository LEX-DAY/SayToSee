# SayToSee — WebRTC-видеовстречи

SayToSee — самостоятельный сервис видеовстреч до 10 участников. Интерфейс
работает на Next.js, а аудио и видео передаются через self-hosted LiveKit SFU.

## Архитектура

- `443/tcp` — HTTPS приложения, API и защищённая WSS-сигнализация LiveKit;
- `7882/udp` — основной WebRTC-медиатрафик через один UDP mux-порт;
- `7881/tcp` — ICE/TCP fallback для сетей, блокирующих UDP;
- `80/tcp` — перенаправление на HTTPS и ACME-проверка сертификата.

LiveKit использует adaptive stream, dynacast, simulcast, Opus DTX и RED.
Комната ограничена десятью участниками.

При создании встречи приложение показывает короткий подписанный ключ. Кнопка
«Копировать ссылку» создаёт приглашение вида:

```text
https://example.com/?key=XXXX-XXXX-XXXX-XXXX
```

Ключ действителен 24 часа. Гость также может ввести его вручную.

## Локальный запуск

Требуется Docker Desktop с запущенным Docker Engine.

```powershell
npm run local:setup
npm run local:up
```

Откройте <http://localhost:3000>. Локальная сигнализация LiveKit доступна на
`ws://localhost:7880`; медиапорты — `7882/udp` и `7881/tcp`.

На Linux:

```bash
npm run local:setup:linux
npm run local:up
```

`.env.local` содержит автоматически созданные ключи LiveKit и секрет подписи
встреч. Файл исключён из Git.

## Запуск на VM с публичным IP

Создайте конфигурацию:

```bash
PUBLIC_IP=203.0.113.10 ./scripts/setup-vm.sh
```

Примените сетевые параметры для WebRTC:

```bash
./scripts/optimize-vm.sh
```

Затем запустите сервисы:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.yml \
  -f docker-compose.vm.yml \
  up -d --build --remove-orphans
```

На внешнем firewall должны быть разрешены `80/tcp`, `443/tcp`, `7881/tcp` и
`7882/udp`. Порт LiveKit API `7880/tcp` привязан только к localhost и
проксируется через Caddy.

## Проверка

```powershell
npm test
npm run lint
```

Тесты проверяют production-сборку, WebRTC-зависимости, UDP mux/TCP fallback,
маршрутизацию WSS/API, адаптивные настройки LiveKit и ссылку приглашения.
