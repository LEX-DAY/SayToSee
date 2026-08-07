package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	embeddedServerURL = "https://89.169.153.186"
	maxResponseSize   = 1 << 20
)

type App struct {
	ctx             context.Context
	client          *http.Client
	mu              sync.RWMutex
	apiBaseURL      string
	hostCredentials map[string]string
}

type JoinRequest struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type MeetingSession struct {
	Room        string `json:"room"`
	Key         string `json:"key"`
	InviteURL   string `json:"inviteUrl"`
	Token       string `json:"token"`
	ServerURL   string `json:"serverUrl"`
	IsHost      bool   `json:"isHost"`
	DisplayName string `json:"displayName"`
}

type createRoomResponse struct {
	Room           string `json:"room"`
	Key            string `json:"key"`
	HostCredential string `json:"hostCredential"`
	Error          string `json:"error"`
}

type tokenResponse struct {
	Token     string `json:"token"`
	ServerURL string `json:"serverUrl"`
	IsHost    bool   `json:"isHost"`
	Room      string `json:"room"`
	Key       string `json:"key"`
	Error     string `json:"error"`
}

func NewApp() *App {
	return &App{
		client: &http.Client{
			Timeout: 12 * time.Second,
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				ForceAttemptHTTP2:     true,
				MaxIdleConns:          2,
				MaxIdleConnsPerHost:   2,
				IdleConnTimeout:       30 * time.Second,
				TLSHandshakeTimeout:   8 * time.Second,
				ResponseHeaderTimeout: 10 * time.Second,
			},
		},
		apiBaseURL:      embeddedServerURL,
		hostCredentials: make(map[string]string),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(context.Context) {
	if transport, ok := a.client.Transport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
}

func (a *App) CheckServer() error {
	baseURL := a.getServerURL()
	request, err := http.NewRequestWithContext(a.requestContext(), http.MethodGet, baseURL, nil)
	if err != nil {
		return err
	}
	response, err := a.client.Do(request)
	if err != nil {
		return friendlyNetworkError(err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusInternalServerError {
		return fmt.Errorf("сервер ответил с ошибкой %d", response.StatusCode)
	}
	return nil
}

func (a *App) CreateRoom(name string) (MeetingSession, error) {
	name, err := validateName(name)
	if err != nil {
		return MeetingSession{}, err
	}

	var created createRoomResponse
	if err := a.postJSON("/api/rooms", map[string]string{"name": name}, &created); err != nil {
		return MeetingSession{}, err
	}
	if created.Room == "" || created.Key == "" || created.HostCredential == "" {
		return MeetingSession{}, errors.New("сервер вернул неполные данные новой комнаты")
	}

	a.mu.Lock()
	a.hostCredentials[created.Room] = created.HostCredential
	a.mu.Unlock()

	session, err := a.requestToken(created.Key, name, created.HostCredential)
	if err != nil {
		return MeetingSession{}, err
	}
	return session, nil
}

func (a *App) JoinRoom(input JoinRequest) (MeetingSession, error) {
	name, err := validateName(input.Name)
	if err != nil {
		return MeetingSession{}, err
	}
	key := normalizeMeetingKey(input.Key)
	if len(key) != 16 {
		return MeetingSession{}, errors.New("ключ встречи должен состоять из 16 символов")
	}

	room := "ctc-" + strings.ToLower(key)
	a.mu.RLock()
	hostCredential := a.hostCredentials[room]
	a.mu.RUnlock()
	return a.requestToken(formatMeetingKey(key), name, hostCredential)
}

func (a *App) requestToken(key, name, hostCredential string) (MeetingSession, error) {
	body := map[string]string{"key": key, "name": name}
	if hostCredential != "" {
		body["hostCredential"] = hostCredential
	}

	var token tokenResponse
	if err := a.postJSON("/api/token", body, &token); err != nil {
		return MeetingSession{}, err
	}
	if token.Token == "" || token.ServerURL == "" || token.Room == "" || token.Key == "" {
		return MeetingSession{}, errors.New("сервер вернул неполные данные подключения")
	}

	return MeetingSession{
		Room:        token.Room,
		Key:         token.Key,
		InviteURL:   a.getServerURL() + "/?key=" + url.QueryEscape(token.Key),
		Token:       token.Token,
		ServerURL:   token.ServerURL,
		IsHost:      token.IsHost,
		DisplayName: name,
	}, nil
}

func (a *App) postJSON(path string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(
		a.requestContext(),
		http.MethodPost,
		a.getServerURL()+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "SayToSee-Desktop/1.0")

	response, err := a.client.Do(request)
	if err != nil {
		return friendlyNetworkError(err)
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize))
	if err != nil {
		return errors.New("не удалось прочитать ответ сервера")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		if response.StatusCode >= http.StatusBadRequest {
			return fmt.Errorf("сервер ответил с ошибкой %d", response.StatusCode)
		}
		return errors.New("сервер вернул некорректный ответ")
	}
	if response.StatusCode >= http.StatusBadRequest {
		message := responseError(target)
		if message == "" {
			message = fmt.Sprintf("сервер ответил с ошибкой %d", response.StatusCode)
		}
		return errors.New(message)
	}
	return nil
}

func (a *App) requestContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func (a *App) getServerURL() string {
	return a.apiBaseURL
}

func normalizeMeetingKey(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "O", "0")
	value = strings.NewReplacer("I", "1", "L", "1", "-", "", " ", "").Replace(value)
	var result strings.Builder
	for _, character := range value {
		if strings.ContainsRune("0123456789ABCDEFGHJKMNPQRSTVWXYZ", character) {
			result.WriteRune(character)
		}
	}
	return result.String()
}

func formatMeetingKey(value string) string {
	value = normalizeMeetingKey(value)
	parts := make([]string, 0, 4)
	for len(value) > 0 {
		size := 4
		if len(value) < size {
			size = len(value)
		}
		parts = append(parts, value[:size])
		value = value[size:]
	}
	return strings.Join(parts, "-")
}

func validateName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("введите имя, которое увидят участники")
	}
	if len([]rune(value)) > 40 {
		return "", errors.New("имя не должно быть длиннее 40 символов")
	}
	return value, nil
}

func friendlyNetworkError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("сервер не ответил вовремя")
	}
	return errors.New("не удалось связаться с сервером — проверьте адрес и подключение")
}

func responseError(value any) string {
	switch response := value.(type) {
	case *createRoomResponse:
		return response.Error
	case *tokenResponse:
		return response.Error
	default:
		return ""
	}
}
