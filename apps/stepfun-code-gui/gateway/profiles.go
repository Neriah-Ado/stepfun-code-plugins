package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	profilesFileName = "profiles.json"
	// Bump when the on-disk shape changes so migrations have a branch point.
	profileSchemaVersion = 1
)

// errProfileInvalid marks a validation failure so the HTTP layer can answer 400
// instead of 500, without resorting to string matching.
var errProfileInvalid = errors.New("invalid profile")

// storedProfile is the on-disk record. The plaintext key lives here and in the
// extension process only — it is never included in anything sent to a browser.
type storedProfile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	BaseURL  string `json:"baseUrl,omitempty"`
	AddedAt  int64  `json:"addedAt"`
}

type profileFile struct {
	Version  int             `json:"version"`
	ActiveID string          `json:"activeId"`
	Profiles []storedProfile `json:"profiles"`
}

// profileView is the masked projection that crosses to the browser.
type profileView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Active   bool   `json:"active"`
	State    string `json:"state"`
	KeyHint  string `json:"keyHint"`
	BaseURL  string `json:"baseUrl,omitempty"`
}

// profileStore persists credentials and serialises access to the file.
type profileStore struct {
	mu        sync.Mutex
	dir       string
	path      string
	file      profileFile
	lastError string
}

func newProfileStore(dir string) *profileStore {
	store := &profileStore{dir: dir, path: filepath.Join(dir, profilesFileName)}
	if dir != "" {
		store.load()
	}
	return store
}

// load reads the file if present. A missing file is the normal first-run case;
// a corrupt one starts empty but is reported — silently discarding a user's
// stored credentials without a trace would be worse than an empty picker.
func (s *profileStore) load() {
	payload, err := os.ReadFile(s.path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("profiles: cannot read %s: %v", s.path, err)
		}
		return
	}

	var parsed profileFile
	if err := json.Unmarshal(payload, &parsed); err != nil {
		log.Printf("profiles: %s is not valid JSON, starting empty: %v", s.path, err)
		return
	}

	s.mu.Lock()
	s.file = parsed
	s.mu.Unlock()
}

// Find returns a profile by id without mutating anything.
func (s *profileStore) Find(id string) (storedProfile, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, profile := range s.file.Profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return storedProfile{}, false
}

// persistLocked writes atomically. mode 0600 because the file holds plaintext
// credentials. On Windows the permission bits are not enforced at all — 0600
// only maps to the read-only attribute, and the directory mode below (0700) is
// likewise ignored — so confidentiality depends on the inherited ACL of the
// user's .stepcode directory. Treat these modes as defence in depth, not as a
// guarantee. See "Windows permissions" in README.md.
func (s *profileStore) persistLocked() error {
	if s.dir == "" {
		return errors.New("profile directory unavailable")
	}

	// Stamp the schema version so a future migration has something to branch on.
	s.file.Version = profileSchemaVersion

	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}

	payload, err := json.MarshalIndent(s.file, "", "  ")
	if err != nil {
		return err
	}

	// Write to a sibling then rename, so a crash cannot truncate the real file.
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		return err
	}

	// A failed rename would otherwise leave the staging file behind forever.
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

// Upsert inserts or updates a profile and returns the stored record.
func (s *profileStore) Upsert(profile storedProfile) (storedProfile, error) {
	// Last line of defence: the HTTP layer validates too, but the store must not
	// accept a record it cannot render.
	if strings.TrimSpace(profile.Name) == "" {
		return profile, fmt.Errorf("%w: name is required", errProfileInvalid)
	}
	if strings.TrimSpace(profile.Provider) == "" {
		return profile, fmt.Errorf("%w: provider is required", errProfileInvalid)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// An edit that omits the key keeps the stored credential, so the browser is
	// never asked to round-trip a secret it was never given.
	if profile.ID != "" && profile.APIKey == "" {
		for _, existing := range s.file.Profiles {
			if existing.ID != profile.ID {
				continue
			}
			profile.APIKey = existing.APIKey
			if profile.Provider == "" {
				profile.Provider = existing.Provider
			}
			if profile.AddedAt == 0 {
				profile.AddedAt = existing.AddedAt
			}
			break
		}
	}

	if profile.ID == "" {
		profile.ID = newRequestID()
	}
	if profile.AddedAt == 0 {
		profile.AddedAt = nowMs()
	}

	replaced := false
	for index := range s.file.Profiles {
		if s.file.Profiles[index].ID == profile.ID {
			s.file.Profiles[index] = profile
			replaced = true
			break
		}
	}
	if !replaced {
		s.file.Profiles = append(s.file.Profiles, profile)
	}

	if err := s.persistLocked(); err != nil {
		return profile, err
	}
	return profile, nil
}

// Remove deletes a profile and clears it as active if it was.
func (s *profileStore) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	kept := make([]storedProfile, 0, len(s.file.Profiles))
	for _, profile := range s.file.Profiles {
		if profile.ID != id {
			kept = append(kept, profile)
		}
	}
	s.file.Profiles = kept

	if s.file.ActiveID == id {
		s.file.ActiveID = ""
	}
	return s.persistLocked()
}

// Activate marks a profile active and returns it so the caller can push the
// credential into the host.
func (s *profileStore) Activate(id string) (storedProfile, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, profile := range s.file.Profiles {
		if profile.ID != id {
			continue
		}

		s.file.ActiveID = id
		s.lastError = ""
		if err := s.persistLocked(); err != nil {
			return profile, true, err
		}
		return profile, true, nil
	}
	return storedProfile{}, false, nil
}

// Views returns the masked roster plus the active id.
func (s *profileStore) Views() ([]profileView, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	views := make([]profileView, 0, len(s.file.Profiles))
	for _, profile := range s.file.Profiles {
		views = append(views, profileView{
			ID:       profile.ID,
			Name:     profile.Name,
			Provider: profile.Provider,
			Active:   profile.ID == s.file.ActiveID,
			State:    classifyProfile(profile),
			KeyHint:  maskKey(profile.APIKey),
			BaseURL:  profile.BaseURL,
		})
	}
	return views, s.file.ActiveID
}

func (s *profileStore) SetLastError(message string) {
	s.mu.Lock()
	s.lastError = message
	s.mu.Unlock()
}

func (s *profileStore) LastError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastError
}

// classifyProfile grades a credential without contacting the endpoint. Rejection
// is discovered from real traffic and arrives separately via LastError.
func classifyProfile(profile storedProfile) string {
	key := strings.TrimSpace(profile.APIKey)
	if key == "" {
		return "missing"
	}
	if len(key) < 12 {
		return "suspicious"
	}
	return "ok"
}

// maskKey renders a key for display only: "sk-abcd…wxyz". Short keys get a
// tighter mask — a 12-character key would otherwise reveal 8 of its 12
// characters, which is a hint rather than a mask.
func maskKey(key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= 8 {
		return "…"
	}
	if len(trimmed) < 24 {
		return trimmed[:2] + "…" + trimmed[len(trimmed)-2:]
	}
	return trimmed[:4] + "…" + trimmed[len(trimmed)-4:]
}
