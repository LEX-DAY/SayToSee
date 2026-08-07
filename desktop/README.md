# SayToSee Desktop

Лёгкий Windows-клиент на Wails для существующего SayToSee-сервера.

## Возможности

- создание комнаты и вход по 16-символьному ключу;
- аудио, видео, демонстрация экрана и адаптивная сетка до 10 участников;
- встроенный адрес SayToSee-сервера без ручной настройки;
- прямое WebRTC-подключение к LiveKit без встроенного Node.js-сервера;
- камера по умолчанию выключена, при включении используется 360p при 15 FPS;
- LiveKit загружается только перед подключением к звонку.

Клиент всегда обращается к `https://89.169.153.186`. Ссылки на встречи имеют вид
`https://89.169.153.186/?key=XXXX-XXXX-XXXX-XXXX`.

## Разработка

Нужны Go, Node.js, Wails CLI и WebView2 Runtime.

```powershell
cd desktop
wails dev
```

Проверки:

```powershell
cd desktop
go test ./...
cd frontend
npm run build
npm audit
```

## Production-сборка

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File build/generate-appicon.ps1
wails build -clean -trimpath -ldflags "-s -w"
wails build -nsis -trimpath -ldflags "-s -w"
```

Готовый portable-клиент появится в `desktop/build/bin/SayToSee.exe`.
Для создания установщика через `-nsis` в системе дополнительно нужен
`makensis` из пакета NSIS; установщик появится рядом с portable-файлом.

## Потребление ресурсов

Клиент не запускает Node.js, не использует polling и не работает в трее.
Go-процесс в лобби занимает около 30 МБ working set на тестовой Windows-машине.
WebView2 запускает собственные системные процессы, поэтому суммарная память
зависит от версии Edge Runtime и драйвера GPU. В контрольном замере суммарная
private memory в лобби составила около 237 МБ. Жёсткий общий лимит 200 МБ для
Wails/WebView2 гарантировать нельзя; во время видеозвонка расход также зависит от
числа потоков и включённой камеры.
