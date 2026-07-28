package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type installationManifest struct {
	SchemaVersion    int    `json:"schemaVersion"`
	AppVersion       string `json:"appVersion"`
	InstallationName string `json:"installationName"`
	AccountID        string `json:"accountId"`
	FreeOnly         bool   `json:"freeOnly"`
	InstalledAt      string `json:"installedAt"`
	Worker           struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	} `json:"worker"`
	D1 struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	} `json:"d1"`
	R2 struct {
		Name         string `json:"name"`
		StorageClass string `json:"storageClass"`
	} `json:"r2"`
}

type desktopInstallation struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Profile     string `json:"profile,omitempty"`
	AccountID   string `json:"accountId,omitempty"`
	WorkerURL   string `json:"workerUrl,omitempty"`
	Version     string `json:"version,omitempty"`
	InstalledAt string `json:"installedAt,omitempty"`
	Status      string `json:"status"`
}

type desktopRegistry struct {
	SchemaVersion   int                   `json:"schemaVersion"`
	TutorialEnabled bool                  `json:"tutorialEnabled"`
	OnboardingSeen  bool                  `json:"onboardingSeen"`
	Installations   []desktopInstallation `json:"installations"`
	UpdatedAt       string                `json:"updatedAt"`
}

func registryPath() (string, error) {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		var err error
		root, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
	}
	return filepath.Join(root, "KRANO", "desktop-state.json"), nil
}

func loadDesktopRegistry(defaultTarget string) (desktopRegistry, error) {
	registry := desktopRegistry{SchemaVersion: 1, TutorialEnabled: true}
	path, err := registryPath()
	if err != nil {
		return registry, err
	}
	raw, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(raw, &registry); err != nil {
			return registry, errors.New("o cadastro local do aplicativo KRANO está inválido")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return registry, err
	}
	if registry.SchemaVersion == 0 {
		registry.SchemaVersion = 1
	}
	if defaultTarget != "" {
		registry.upsertInstallation(discoverInstallation(defaultTarget, ""))
	}
	registry.refresh()
	return registry, nil
}

func saveDesktopRegistry(registry desktopRegistry) error {
	path, err := registryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	registry.SchemaVersion = 1
	registry.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o600)
}

func discoverInstallation(target, profile string) desktopInstallation {
	clean := filepath.Clean(target)
	item := desktopInstallation{
		ID:      installationID(clean),
		Name:    filepath.Base(clean),
		Path:    clean,
		Profile: profile,
		Status:  "not-installed",
	}
	manifest, err := readInstallationManifest(clean)
	if err != nil {
		return item
	}
	item.Name = manifest.InstallationName
	item.AccountID = manifest.AccountID
	item.WorkerURL = strings.TrimRight(manifest.Worker.URL, "/")
	item.Version = manifest.AppVersion
	item.InstalledAt = manifest.InstalledAt
	item.Status = "installed"
	return item
}

func readInstallationManifest(target string) (installationManifest, error) {
	var manifest installationManifest
	raw, err := os.ReadFile(filepath.Join(target, ".funnel-zero", "installation.json"))
	if err != nil {
		return manifest, err
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return manifest, err
	}
	if manifest.InstallationName == "" || manifest.Worker.URL == "" || !safeWebURL(manifest.Worker.URL) {
		return manifest, errors.New("manifesto de instalação incompleto")
	}
	return manifest, nil
}

func (registry *desktopRegistry) refresh() {
	items := make([]desktopInstallation, 0, len(registry.Installations))
	seen := map[string]bool{}
	for _, stored := range registry.Installations {
		if strings.TrimSpace(stored.Path) == "" {
			continue
		}
		current := discoverInstallation(stored.Path, stored.Profile)
		if current.Status != "installed" && stored.Name != "" {
			current.Name = stored.Name
		}
		if seen[current.ID] {
			continue
		}
		seen[current.ID] = true
		items = append(items, current)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	registry.Installations = items
}

func (registry *desktopRegistry) upsertInstallation(item desktopInstallation) {
	if item.Path == "" {
		return
	}
	for index := range registry.Installations {
		if registry.Installations[index].ID == item.ID ||
			strings.EqualFold(filepath.Clean(registry.Installations[index].Path), filepath.Clean(item.Path)) {
			if item.Profile == "" {
				item.Profile = registry.Installations[index].Profile
			}
			registry.Installations[index] = item
			return
		}
	}
	registry.Installations = append(registry.Installations, item)
}

func (registry *desktopRegistry) removeInstallation(id string) {
	filtered := registry.Installations[:0]
	for _, item := range registry.Installations {
		if item.ID != id {
			filtered = append(filtered, item)
		}
	}
	registry.Installations = filtered
}

func (registry *desktopRegistry) findInstallation(id string) (desktopInstallation, bool) {
	for _, item := range registry.Installations {
		if item.ID == id {
			return item, true
		}
	}
	return desktopInstallation{}, false
}

func installationID(target string) string {
	return strings.ToLower(filepath.Clean(target))
}
