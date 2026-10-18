package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// Полный цикл локального хоста: старт (с загрузкой livekit при первом
// запуске), рассылка маячков, выпуск токена гостю, остановка.
func TestLANHostDiscoveryAndJoin(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	app := NewApp()
	app.startup(nil)

	t.Cleanup(func() { app.StopLANHost() })

	session, err := app.StartLANHost("Тестовый хост")
	if err != nil {
		t.Fatalf("StartLANHost: %v", err)
	}
	if !strings.HasPrefix(session.ServerURL, "ws://") {
		t.Fatalf("ServerURL должен быть ws://, получено %q", session.ServerURL)
	}
	if !session.IsHost || len(session.Token) < 50 {
		t.Fatalf("сессия хоста неполная: %+v", session)
	}

	// Ждём, пока слушатель услышит маячок ИМЕННО этой встречи
	var heard lanBeaconEntry
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		beaconMu.Lock()
		for _, entry := range beaconHosts {
			if entry.info.RoomKey == session.Key {
				heard = entry
			}
		}
		beaconMu.Unlock()
		if heard.info.IP != "" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if heard.info.IP == "" {
		t.Fatal("UDP-маячок хоста не услышан слушателем")
	}
	t.Logf("маячок услышан: ip=%s key=%s", heard.info.IP, heard.info.RoomKey)

	guestSession, err := app.JoinLANHost(heard.info.IP, heard.info.Port, "Гость", heard.info.RoomKey)
	if err != nil {
		var raw map[string]any
		_ = postJSONTo(fmt.Sprintf("http://%s:%d/api/token", heard.info.IP, heard.info.Port),
			map[string]string{"key": heard.info.RoomKey, "name": "Гость-диагностика"}, &raw)
		t.Fatalf("JoinLANHost: %v; сырой ответ хоста: %v", err, raw)
	}
	if guestSession.Token == "" || guestSession.IsHost {
		t.Fatalf("токен гостя некорректный: %+v", guestSession)
	}

	// В списке для интерфейса: чужой хост виден, собственный — нет
	beaconMu.Lock()
	beaconHosts["203.0.113.77"] = lanBeaconEntry{
		info:     LANHostInfo{Name: "SayToSee · чужой", IP: "203.0.113.77", Port: 8090, RoomKey: "XXXX-XXXX-XXXX-XXXX", HostName: "чужой"},
		lastSeen: time.Now(),
	}
	beaconMu.Unlock()
	hosts, err := app.DiscoverLANHosts()
	if err != nil {
		t.Fatalf("DiscoverLANHosts: %v", err)
	}
	foundForeign, foundSelf := false, false
	for _, host := range hosts {
		if host.IP == "203.0.113.77" {
			foundForeign = true
		}
		if host.IP == heard.info.IP {
			foundSelf = true
		}
	}
	if !foundForeign {
		t.Fatalf("чужой хост не попал в список: %+v", hosts)
	}
	if foundSelf {
		t.Fatalf("собственный хост не должен попадать в список: %+v", hosts)
	}

	app.StopLANHost()
	status := app.GetLANHostStatus()
	if status.Running {
		t.Fatal("хост должен быть остановлен")
	}
}
