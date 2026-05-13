package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// Roles del sistema
const (
	RoleAdmin  = "admin"
	RoleViewer = "viewer"
)

// User representa un usuario del sistema
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"password_hash"`
	Role         string    `json:"role"`
	AvatarURL    string    `json:"avatar_url"`
	CreatedAt    time.Time `json:"created_at"`
	LastLogin    time.Time `json:"last_login,omitempty"`
	ResetToken   string    `json:"reset_token,omitempty"`
	ResetExpiry  time.Time `json:"reset_expiry,omitempty"`
}

// Manager gestiona todos los usuarios del sistema
type Manager struct {
	mu       sync.RWMutex
	users    []*User
	filePath string
	secret   string // HMAC secret para tokens
}

// NewManager crea o carga el gestor de usuarios desde disco
func NewManager(dataDir string) (*Manager, error) {
	// Generar un secreto único para tokens (persiste en archivo)
	secretFile := dataDir + "/auth_secret"
	secret, err := loadOrCreateSecret(secretFile)
	if err != nil {
		return nil, err
	}

	m := &Manager{
		filePath: dataDir + "/users.json",
		secret:   secret,
		users:    make([]*User, 0),
	}

	// Intentar cargar usuarios existentes
	if err := m.load(); err != nil {
		// Si el archivo no existe, crear usuario admin por defecto
		defaultPwd := randomHex(4) // contraseña aleatoria de 8 chars
		fmt.Printf("\n🔐 ===== CamBridge: Primer Inicio =====\n")
		fmt.Printf("    Usuario admin creado automáticamente:\n")
		fmt.Printf("    Usuario:    admin\n")
		fmt.Printf("    Contraseña: %s\n", defaultPwd)
		fmt.Printf("    ¡Cámbiala en Ajustes > Usuarios!\n")
		fmt.Printf("=======================================\n\n")

		admin := &User{
			ID:           randomHex(8),
			Username:     "admin",
			Email:        "admin@cambrige.local",
			PasswordHash: hashPassword(defaultPwd),
			Role:         RoleAdmin,
			CreatedAt:    time.Now(),
		}
		m.users = append(m.users, admin)
		m.save()
	}

	return m, nil
}

// Login valida las credenciales y devuelve un token JWT-like
func (m *Manager) Login(username, password string) (string, *User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, u := range m.users {
		if strings.EqualFold(u.Username, username) {
			if hashPassword(password) == u.PasswordHash {
				// Actualizar last_login
				u.LastLogin = time.Now()
				go m.save()

				token := m.createToken(u)
				return token, u, nil
			}
			return "", nil, fmt.Errorf("contraseña incorrecta")
		}
	}
	return "", nil, fmt.Errorf("usuario no encontrado")
}

// ValidateToken valida un token y devuelve el usuario
func (m *Manager) ValidateToken(token string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("token inválido")
	}

	// Verificar firma HMAC
	payload := parts[0] + "." + parts[1]
	expectedSig := m.sign(payload)
	if parts[2] != expectedSig {
		return nil, fmt.Errorf("firma de token inválida")
	}

	// Decodificar payload
	data, err := base64.URLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("token malformado")
	}

	var claims struct {
		UserID  string    `json:"uid"`
		Expires time.Time `json:"exp"`
	}
	if err := json.Unmarshal(data, &claims); err != nil {
		return nil, fmt.Errorf("token malformado")
	}

	if time.Now().After(claims.Expires) {
		return nil, fmt.Errorf("token expirado")
	}

	// Buscar usuario
	for _, u := range m.users {
		if u.ID == claims.UserID {
			return u, nil
		}
	}
	return nil, fmt.Errorf("usuario no encontrado")
}

// ListUsers devuelve todos los usuarios (sin contraseñas)
func (m *Manager) ListUsers() []*User {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*User, len(m.users))
	for i, u := range m.users {
		safe := *u
		safe.PasswordHash = ""
		safe.ResetToken = ""
		out[i] = &safe
	}
	return out
}

// CreateUser crea un nuevo usuario (solo admin puede hacerlo)
func (m *Manager) CreateUser(username, email, password, role string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, u := range m.users {
		if strings.EqualFold(u.Username, username) {
			return nil, fmt.Errorf("el usuario '%s' ya existe", username)
		}
	}

	user := &User{
		ID:           randomHex(8),
		Username:     username,
		Email:        email,
		PasswordHash: hashPassword(password),
		Role:         role,
		CreatedAt:    time.Now(),
	}

	m.users = append(m.users, user)
	m.save()

	safe := *user
	safe.PasswordHash = ""
	return &safe, nil
}

// UpdateUser modifica un usuario existente
func (m *Manager) UpdateUser(id, username, email, role, avatar string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, u := range m.users {
		if u.ID == id {
			if username != "" {
				u.Username = username
			}
			if email != "" {
				u.Email = email
			}
			if role != "" {
				u.Role = role
			}
			if avatar != "" {
				u.AvatarURL = avatar
			}
			m.save()
			return nil
		}
	}
	return fmt.Errorf("usuario no encontrado")
}

// ChangePassword cambia la contraseña verificando la actual
func (m *Manager) ChangePassword(id, oldPassword, newPassword string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, u := range m.users {
		if u.ID == id {
			if hashPassword(oldPassword) != u.PasswordHash {
				return fmt.Errorf("contraseña actual incorrecta")
			}
			u.PasswordHash = hashPassword(newPassword)
			m.save()
			return nil
		}
	}
	return fmt.Errorf("usuario no encontrado")
}

// GenerateResetToken genera un token de reseteo de contraseña
func (m *Manager) GenerateResetToken(username string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, u := range m.users {
		if strings.EqualFold(u.Username, username) {
			token := randomHex(16)
			u.ResetToken = token
			u.ResetExpiry = time.Now().Add(1 * time.Hour)
			m.save()

			// En producción se enviaría por email; aquí lo imprimimos en consola
			fmt.Printf("\n🔑 Token de reseteo para '%s': %s (válido 1 hora)\n", username, token)
			return token, nil
		}
	}
	return "", fmt.Errorf("usuario no encontrado")
}

// ResetPassword resetea la contraseña con el token
func (m *Manager) ResetPassword(username, token, newPassword string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, u := range m.users {
		if strings.EqualFold(u.Username, username) {
			if u.ResetToken != token {
				return fmt.Errorf("token inválido")
			}
			if time.Now().After(u.ResetExpiry) {
				return fmt.Errorf("token expirado")
			}
			u.PasswordHash = hashPassword(newPassword)
			u.ResetToken = ""
			u.ResetExpiry = time.Time{}
			m.save()
			return nil
		}
	}
	return fmt.Errorf("usuario no encontrado")
}

// DeleteUser elimina un usuario (no puede eliminarse a sí mismo)
func (m *Manager) DeleteUser(requestorID, targetID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if requestorID == targetID {
		return fmt.Errorf("no puedes eliminarte a ti mismo")
	}

	for i, u := range m.users {
		if u.ID == targetID {
			m.users = append(m.users[:i], m.users[i+1:]...)
			m.save()
			return nil
		}
	}
	return fmt.Errorf("usuario no encontrado")
}

// ─── Helpers privados ─────────────────────────────────────────

func (m *Manager) createToken(u *User) string {
	header := base64.URLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))

	claims, _ := json.Marshal(map[string]interface{}{
		"uid": u.ID,
		"exp": time.Now().Add(7 * 24 * time.Hour), // 7 días
	})
	payload := base64.URLEncoding.EncodeToString(claims)
	sig := m.sign(header + "." + payload)
	return header + "." + payload + "." + sig
}

func (m *Manager) sign(data string) string {
	mac := hmac.New(sha256.New, []byte(m.secret))
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

func hashPassword(pwd string) string {
	h := sha256.Sum256([]byte("cambrige-salt-v1:" + pwd))
	return hex.EncodeToString(h[:])
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func loadOrCreateSecret(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err == nil && len(data) > 0 {
		return string(data), nil
	}
	secret := randomHex(32)
	if err := os.WriteFile(path, []byte(secret), 0600); err != nil {
		return "", err
	}
	return secret, nil
}

func (m *Manager) load() error {
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &m.users)
}

func (m *Manager) save() {
	data, _ := json.MarshalIndent(m.users, "", "  ")
	os.WriteFile(m.filePath, data, 0600)
}
