package main

import (
	"archive/zip"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hashicorp/mdns"
)

const (
	lanHTTPPort        = 8090
	livekitSignalPort  = 7880
	lanBeaconPort      = 45616
	livekitVersion     = "v1.13.10"
	livekitDownloadURL = "https://github.com/livekit/livekit-server/releases/download/" +
		livekitVersion + "/livekit_1.13.10_windows_amd64.zip"
)

// Гости слышат UDP-маячки хостов: mDNS в некоторых сетях режут,
// broadcast проходит почти везде
var (
	beaconMu        sync.Mutex
	beaconListener  *net.UDPConn
	beaconHosts     = map[string]lanBeaconEntry{}
	// Для диагностики: тесты могут слушать 45616 сырым сокетом
	beaconListenerSuspended = false
)

type lanBeaconEntry struct {
	info     LANHostInfo
	lastSeen time.Time
}

// Страница встречи для браузеров и телефонов в локальной сети:
// тот же фронтенд, что и в приложении, обслуживается по HTTP.
//
//go:embed all:frontend/dist
var lanFrontendDist embed.FS

type LANHostStatus struct {
	Running   bool   `json:"running"`
	HTTPURL   string `json:"httpUrl"`
	SignalURL string `json:"signalUrl"`
	RoomKey   string `json:"roomKey"`
	Room      string `json:"room"`
	IPAddress string `json:"ipAddress"`
}

type LANHostInfo struct {
	Name     string `json:"name"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	RoomKey  string `json:"roomKey"`
	HostName string `json:"hostName"`
}

type lanHost struct {
	mu            sync.Mutex
	running       bool
	livekitCmd    *exec.Cmd
	livekitExited <-chan struct{}
	httpServer    *http.Server
	mdns          *mdns.Server
	apiKey        string
	apiSecret     string
	room          string
	roomKey       string
	ipAddress     string
	binaryPath    string
	beaconSent    int64
	beaconErr     string
}

var lan = &lanHost{}

// --- Публичные методы, вызываемые из фронтенда ---

// StartLANHost поднимает локальный сервер встреч на этом устройстве:
// livekit-server + HTTP API + mDNS-анонс, и возвращает сессию хоста.
func (a *App) StartLANHost(name string) (MeetingSession, error) {
	name, err := validateName(name)
	if err != nil {
		return MeetingSession{}, err
	}

	lan.mu.Lock()
	defer lan.mu.Unlock()
	if lan.running {
		return MeetingSession{}, errors.New("локальный хост уже запущен")
	}

	ip := primaryLANIP()
	if ip == "" {
		return MeetingSession{}, errors.New("не удалось определить локальный IP — проверьте, что Wi-Fi или Ethernet подключены")
	}

	binaryPath, err := ensureLivekitBinary()
	if err != nil {
		return MeetingSession{}, err
	}

	lan.apiKey = "LAN" + randomToken(8)
	lan.apiSecret = randomToken(32)
	lan.room = "lan-" + randomToken(10)
	lan.roomKey = formatMeetingKey(randomBase32(16))
	lan.ipAddress = ip
	lan.binaryPath = binaryPath

	if err := lan.startLivekit(ip); err != nil {
		return MeetingSession{}, err
	}

	if err := lan.startHTTP(); err != nil {
		lan.stopLivekit()
		return MeetingSession{}, fmt.Errorf("не занять порт %d — возможно, локальный хост уже работает: %w", lanHTTPPort, err)
	}

	lan.mdnsRegister(lan.ipAddress, lan.roomKey)
	go lan.beaconLoop()

	// Ждём готовности LiveKit: он отвечает на health-запрос не мгновенно
	if err := waitLivekitReady(10*time.Second, lan.livekitExited); err != nil {
		lan.stopAll()
		return MeetingSession{}, err
	}

	token, err := lan.signSessionTokenLocked("host-"+randomToken(6), name, true)
	if err != nil {
		lan.stopAll()
		return MeetingSession{}, err
	}

	lan.running = true
	return MeetingSession{
		Room:        lan.room,
		Key:         lan.roomKey,
		InviteURL:   fmt.Sprintf("http://%s:%d/?key=%s", ip, lanHTTPPort, lan.roomKey),
		Token:       token,
		ServerURL:   fmt.Sprintf("ws://%s:%d", ip, livekitSignalPort),
		IsHost:      true,
		DisplayName: name,
	}, nil
}

// StopLANHost полностью останавливает локальный хост.
func (a *App) StopLANHost() {
	lan.mu.Lock()
	defer lan.mu.Unlock()
	lan.stopAll()
}

// GetLANHostStatus возвращает текущее состояние локального хоста.
func (a *App) GetLANHostStatus() LANHostStatus {
	lan.mu.Lock()
	defer lan.mu.Unlock()
	if !lan.running {
		return LANHostStatus{Running: false}
	}
	return LANHostStatus{
		Running:   true,
		HTTPURL:   fmt.Sprintf("http://%s:%d", lan.ipAddress, lanHTTPPort),
		SignalURL: fmt.Sprintf("ws://%s:%d", lan.ipAddress, livekitSignalPort),
		RoomKey:   lan.roomKey,
		Room:      lan.room,
		IPAddress: lan.ipAddress,
	}
}

// DiscoverLANHosts возвращает найденные локальные встречи: UDP-маячки,
// услышанные приложением, плюс mDNS-ответы (2 секунды активного поиска).
func (a *App) DiscoverLANHosts() ([]LANHostInfo, error) {
	found := make(map[string]LANHostInfo)

	// Свежие маячки (слушатель копит их постоянно)
	beaconMu.Lock()
	now := time.Now()
	for ip, entry := range beaconHosts {
		if now.Sub(entry.lastSeen) < 6*time.Second {
			found[ip] = entry.info
		}
	}
	beaconMu.Unlock()

	// mDNS как второй механизм (в некоторых сетях работает только он)
	entries := make(chan *mdns.ServiceEntry, 16)
	params := mdns.DefaultParams("saytosee")
	params.Timeout = 2 * time.Second
	params.Entries = entries
	queryDone := make(chan struct{})
	go func() {
		defer close(queryDone)
		_ = mdns.Query(params)
	}()

	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				return lanHostList(found), nil
			}
			if entry.AddrV4 == nil || entry.Port == 0 {
				continue
			}
			info := LANHostInfo{
				Name: strings.TrimSuffix(entry.Name, ".local."),
				IP:   entry.AddrV4.String(),
				Port: entry.Port,
			}
			for _, field := range entry.InfoFields {
				if value, found := strings.CutPrefix(field, "key="); found {
					info.RoomKey = value
				}
				if value, found := strings.CutPrefix(field, "name="); found {
					info.HostName = value
				}
			}
			found[info.IP] = info
		case <-queryDone:
			return lanHostList(found), nil
		case <-time.After(4 * time.Second):
			return lanHostList(found), nil
		}
	}
}

func lanHostList(found map[string]LANHostInfo) []LANHostInfo {
	// Собственный хост не показываем в списке
	lan.mu.Lock()
	selfIP := lan.ipAddress
	selfRunning := lan.running
	lan.mu.Unlock()

	result := make([]LANHostInfo, 0, len(found))
	for _, info := range found {
		if selfRunning && info.IP == selfIP {
			continue
		}
		result = append(result, info)
	}
	for i := range result {
		for j := i + 1; j < len(result); j++ {
			if result[i].Name > result[j].Name {
				result[i], result[j] = result[j], result[i]
			}
		}
	}
	return result
}

// startBeaconListener копит маячки хостов; слушает с запуска приложения,
// чтобы к моменту открытия списка уже были видны все хосты сети.
func startBeaconListener() {
	beaconMu.Lock()
	if beaconListener != nil || beaconListenerSuspended || os.Getenv("SAYTOSEE_PROBE") == "1" {
		beaconMu.Unlock()
		return
	}
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: lanBeaconPort})
	if err != nil {
		beaconMu.Unlock()
		return
	}
	beaconListener = conn
	beaconMu.Unlock()

	go func() {
		buf := make([]byte, 1024)
		prune := time.NewTicker(5 * time.Second)
		defer prune.Stop()
		defer conn.Close()
		for {
			select {
			case <-prune.C:
				beaconMu.Lock()
				for ip, entry := range beaconHosts {
					if time.Since(entry.lastSeen) > 30*time.Second {
						delete(beaconHosts, ip)
					}
				}
				beaconMu.Unlock()
			default:
			}
			n, addr, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			var beacon struct {
				App  string `json:"app"`
				Key  string `json:"key"`
				Name string `json:"name"`
				IP   string `json:"ip"`
				Port int    `json:"port"`
			}
			if json.Unmarshal(buf[:n], &beacon) != nil || beacon.App != "saytosee" {
				continue
			}
			ip := beacon.IP
			if ip == "" {
				ip = addr.IP.String()
			}
			beaconMu.Lock()
			beaconHosts[ip] = lanBeaconEntry{
				info: LANHostInfo{
					Name:    "SayToSee · " + beacon.Name,
					IP:      ip,
					Port:    beacon.Port,
					RoomKey: beacon.Key,
					HostName: beacon.Name,
				},
				lastSeen: time.Now(),
			}
			beaconMu.Unlock()
		}
	}()
}

// beaconLoop раз в секунду рассылает маячок хоста в широковещательный канал.
func (l *lanHost) beaconLoop() {
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4bcast, Port: lanBeaconPort})
	if err != nil {
		l.mu.Lock()
		l.beaconErr = "dial: " + err.Error()
		l.mu.Unlock()
		return
	}
	defer conn.Close()
	l.mu.Lock()
	payload, _ := json.Marshal(map[string]any{
		"app": "saytosee", "key": l.roomKey, "name": shortHostName(),
		"ip": l.ipAddress, "port": lanHTTPPort,
	})
	l.mu.Unlock()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
		for {
		select {
		case <-l.livekitExited:
			return
		case <-ticker.C:
			l.mu.Lock()
			if _, err := conn.Write(payload); err != nil {
				l.beaconErr = "write: " + err.Error()
			} else {
				l.beaconSent++
			}
			l.mu.Unlock()
		}
	}
}

// JoinLANHost подключается к найденному в сети хосту.
func (a *App) JoinLANHost(hostIP string, port int, name, key string) (MeetingSession, error) {
	name, err := validateName(name)
	if err != nil {
		return MeetingSession{}, err
	}
	if hostIP == "" || port <= 0 {
		return MeetingSession{}, errors.New("не выбран хост для подключения")
	}
	base := fmt.Sprintf("http://%s:%d", hostIP, port)

	var token tokenResponse
	if err := postJSONTo(base+"/api/token", map[string]string{"key": key, "name": name}, &token); err != nil {
		return MeetingSession{}, fmt.Errorf("хост не ответил: %w", err)
	}
	if token.Error != "" {
		return MeetingSession{}, errors.New(token.Error)
	}
	if token.Token == "" || token.Room == "" || token.Key == "" {
		return MeetingSession{}, errors.New("хост вернул неполные данные подключения")
	}
	return MeetingSession{
		Room:        token.Room,
		Key:         token.Key,
		InviteURL:   fmt.Sprintf("%s/?key=%s", base, token.Key),
		Token:       token.Token,
		ServerURL:   fmt.Sprintf("ws://%s:%d", hostIP, livekitSignalPort),
		IsHost:      token.IsHost,
		DisplayName: name,
	}, nil
}

// --- Внутреннее устройство хоста ---

func (l *lanHost) startLivekit(ip string) error {
	// Порт сигнализации должен быть свободен: иначе livekit упадёт молча,
	// а проверка готовности наткнётся на чужой сервис (например, Docker)
	probe, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", livekitSignalPort))
	if err != nil {
		return fmt.Errorf("порт %d уже занят другим процессом — освободите его (возможно, уже запущен другой хост или локальный Docker-стек)", livekitSignalPort)
	}
	probe.Close()

	// На машинах с виртуальными адаптерами (Hyper-V, VMware, WSL, Tailscale)
	// livekit падает, биндя UDP-порт на каждый адрес; оставляем ему только
	// адаптер, который смотрит в локальную сеть
	interfaceName := primaryInterfaceName()

	config := fmt.Sprintf(`port: %d
bind_addresses:
  - 0.0.0.0
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: %s
  interfaces:
    includes:
      - "%s"
keys:
  %s: %s
logging:
  level: warn
  pion_level: error
`, livekitSignalPort, ip, interfaceName, l.apiKey, l.apiSecret)

	configPath := filepath.Join(lanAppDir(), "livekit.yaml")
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		return errors.New("не удалось записать конфигурацию локального сервера")
	}

	cmd := exec.Command(l.binaryPath, "--config", configPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("не удалось запустить встроенный сервер: %w", err)
	}
	l.livekitCmd = cmd
	exited := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(exited)
	}()
	l.livekitExited = exited
	return nil
}

func (l *lanHost) stopLivekit() {
	if l.livekitCmd != nil && l.livekitCmd.Process != nil {
		_ = l.livekitCmd.Process.Kill()
		_, _ = l.livekitCmd.Process.Wait()
		l.livekitCmd = nil
	}
}

func (l *lanHost) startHTTP() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, r *http.Request) {
		// Локальный хост ведёт одну встречу: возвращаем её с токеном хоста
		var payload struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&payload)
		name, err := validateName(payload.Name)
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		token, err := l.signSessionToken("host-"+randomToken(6), name, true)
		if err != nil {
			writeJSON(w, map[string]string{"error": "не удалось выпустить токен"})
			return
		}
		l.mu.Lock()
		ip, room, key := l.ipAddress, l.room, l.roomKey
		l.mu.Unlock()
		writeJSON(w, MeetingSession{
			Room: room, Key: key,
			InviteURL:   fmt.Sprintf("http://%s:%d/?key=%s", ip, lanHTTPPort, key),
			Token:       token,
			ServerURL:   fmt.Sprintf("ws://%s:%d", ip, livekitSignalPort),
			IsHost:      true, DisplayName: name,
		})
	})
	mux.HandleFunc("/api/token", func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&payload)
		name, err := validateName(payload.Name)
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		l.mu.Lock()
		ip, room, key := l.ipAddress, l.room, l.roomKey
		l.mu.Unlock()
		if normalizeMeetingKey(payload.Key) != normalizeMeetingKey(key) {
			writeJSON(w, map[string]string{"error": "ключ встречи недействителен"})
			return
		}
		token, err := l.signSessionToken("guest-"+randomToken(6), name, false)
		if err != nil {
			writeJSON(w, map[string]string{"error": "не удалось выпустить токен"})
			return
		}
		writeJSON(w, MeetingSession{
			Room: room, Key: key,
			InviteURL:   fmt.Sprintf("http://%s:%d/?key=%s", ip, lanHTTPPort, key),
			Token:       token,
			ServerURL:   fmt.Sprintf("ws://%s:%d", ip, livekitSignalPort),
			IsHost:      false, DisplayName: name,
		})
	})
	// Страница встречи для браузеров и телефонов в этой же сети
	mux.Handle("/", lanStaticHandler())

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", lanHTTPPort),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	l.httpServer = server
	go func() {
		_ = server.ListenAndServe()
	}()
	return nil
}

func (l *lanHost) mdnsRegister(ip, roomKey string) {
	// Вызывается только из StartLANHost, который уже держит l.mu
	addresses := []net.IP{}
	if parsed := net.ParseIP(ip); parsed != nil {
		addresses = append(addresses, parsed)
	}
	service, err := mdns.NewMDNSService(
		"SayToSee "+shortHostName(), "saytosee", "local.", "",
		lanHTTPPort, addresses, []string{"key=" + roomKey},
	)
	if err != nil {
		return
	}
	server, err := mdns.NewServer(&mdns.Config{Zone: service})
	if err == nil {
		l.mdns = server
	}
}

func (l *lanHost) stopAll() {
	if l.mdns != nil {
		l.mdns.Shutdown()
		l.mdns = nil
	}
	if l.httpServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = l.httpServer.Shutdown(shutdownCtx)
		l.httpServer = nil
	}
	l.stopLivekit()
	l.running = false
}

// lanStaticHandler обслуживает собранный фронтенд (SPA — все пути ведут на
// index.html, чтобы работал вход по /?key=...).
func lanStaticHandler() http.Handler {
	dist, err := fs.Sub(lanFrontendDist, "frontend/dist")
	if err != nil {
		return http.NotFoundHandler()
	}
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(dist, path); err != nil {
			r.URL.Path = "/"
		}
		w.Header().Set("Cache-Control", "no-store")
		fileServer.ServeHTTP(w, r)
	})
}

// --- LiveKit-токены (HS256 JWT, формат LiveKit) ---

func (l *lanHost) signSessionToken(identity, name string, isHost bool) (string, error) {
	l.mu.Lock()
	apiKey, apiSecret, room := l.apiKey, l.apiSecret, l.room
	l.mu.Unlock()
	return l.signSessionTokenWith(apiKey, apiSecret, room, identity, name, isHost)
}

func (l *lanHost) signSessionTokenLocked(identity, name string, isHost bool) (string, error) {
	// Вызывается из StartLANHost, который уже держит l.mu
	return l.signSessionTokenWith(l.apiKey, l.apiSecret, l.room, identity, name, isHost)
}

func (l *lanHost) signSessionTokenWith(apiKey, apiSecret, room, identity, name string, isHost bool) (string, error) {
	if apiKey == "" {
		return "", errors.New("локальный хост не сконфигурирован")
	}
	now := time.Now().Unix()
	role := "guest"
	grant := map[string]any{
		"room": room, "roomJoin": true, "roomAdmin": false,
		"canPublish": true, "canSubscribe": true, "canPublishData": true,
	}
	if isHost {
		role = "host"
		grant["roomAdmin"] = true
	}
	metadata, _ := json.Marshal(map[string]string{"role": role})
	header := base64URLEncode([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{
		"iss": apiKey, "sub": identity, "name": name,
		"video": grant, "metadata": string(metadata),
		"iat": now, "nbf": now, "exp": now + int64((12 * time.Hour).Seconds()),
	})
	if err != nil {
		return "", err
	}
	unsigned := header + "." + base64URLEncode(payload)
	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(unsigned))
	return unsigned + "." + base64URLEncode(mac.Sum(nil)), nil
}

// --- Инфраструктура ---

func lanAppDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = "."
	}
	dir := filepath.Join(base, "SayToSee", "bin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		dir = "."
	}
	return dir
}

// ensureLivekitBinary возвращает путь к livekit-server.exe, при первом
// запуске скачивая его с официального релиза GitHub (~45 МБ, один раз).
func ensureLivekitBinary() (string, error) {
	dir := lanAppDir()
	binaryPath := filepath.Join(dir, "livekit-server.exe")
	if info, err := os.Stat(binaryPath); err == nil && info.Size() > 1<<20 {
		return binaryPath, nil
	}

	zipPath := filepath.Join(dir, "livekit.zip")
	if err := downloadFile(livekitDownloadURL, zipPath); err != nil {
		return "", errors.New("первый запуск локального хоста скачивает сервер (~45 МБ) — не удалось скачать: подключите интернет и повторите")
	}
	defer os.Remove(zipPath)
	if err := unzipSingleFile(zipPath, binaryPath); err != nil {
		return "", errors.New("не удалось распаковать серверный модуль")
	}
	return binaryPath, nil
}

func downloadFile(url, target string) error {
	response, err := http.Get(url) //nolint:gosec // адрес зашит в константу релиза
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("статус %d", response.StatusCode)
	}
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, response.Body)
	return err
}

func unzipSingleFile(zipPath, target string) error {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, file := range archive.File {
		if file.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(file.Name), ".exe") {
			continue
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		targetFile, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			source.Close()
			return err
		}
		_, err = io.Copy(targetFile, source)
		source.Close()
		targetFile.Close()
		return err
	}
	return errors.New("exe не найден в архиве")
}

func waitLivekitReady(timeout time.Duration, exited <-chan struct{}) error {
	deadline := time.Now().Add(timeout)
	ready := false
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			return errors.New("встроенный сервер завершился сразу после запуска — проверьте, что порты 7880/7881/7882 свободны")
		default:
		}
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", livekitSignalPort), 500*time.Millisecond)
		if err == nil {
			conn.Close()
			ready = true
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if !ready {
		return errors.New("таймаут запуска сервера")
	}
	// LiveKit биндит сигнальный порт раньше медиа-портов: убедимся, что
	// процесс пережил запуск всех слушателей, а не упал через полсекунды
	select {
	case <-exited:
		return errors.New("встроенный сервер завершился при запуске медиа-портов — проверьте, что порты 7880/7881/7882 свободны")
	case <-time.After(1500 * time.Millisecond):
		return nil
	}
}

func primaryLANIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			return addr.IP.String()
		}
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			if ipnet, ok := address.(*net.IPNet); ok && ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return ""
}

func primaryInterfaceName() string {
	ip := net.ParseIP(primaryLANIP())
	if ip == nil {
		return ""
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range interfaces {
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			if ipnet, ok := address.(*net.IPNet); ok && ipnet.IP.Equal(ip) {
				return iface.Name
			}
		}
	}
	return ""
}

func randomToken(length int) string {
	raw := make([]byte, length)
	_, _ = rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)[:length]
}

func randomBase32(length int) string {
	alphabet := "0123456789abcdefghjkmnpqrstvwxyz"
	raw := make([]byte, length)
	_, _ = rand.Read(raw)
	out := make([]byte, length)
	for i := range raw {
		out[i] = alphabet[int(raw[i])%len(alphabet)]
	}
	return string(out)
}

func base64URLEncode(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

func shortHostName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "устройство"
	}
	return strings.Split(host, ".")[0]
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func postJSONTo(url string, payload any, target any) error {
	client := &http.Client{Timeout: 8 * time.Second}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	response, err := client.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize))
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}
