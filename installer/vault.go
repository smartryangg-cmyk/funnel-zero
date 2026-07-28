package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type vaultSecret struct {
	Login    string `json:"login"`
	Password string `json:"password"`
	Recovery string `json:"recovery,omitempty"`
}

type vaultRecord struct {
	InstallationID string `json:"installationId"`
	Label          string `json:"label"`
	ProtectedData  string `json:"protectedData"`
	UpdatedAt      string `json:"updatedAt"`
}

type vaultStore struct {
	SchemaVersion int           `json:"schemaVersion"`
	Records       []vaultRecord `json:"records"`
}

type vaultMetadata struct {
	InstallationID string `json:"installationId"`
	Label          string `json:"label"`
	UpdatedAt      string `json:"updatedAt"`
}

func vaultPath() (string, error) {
	registry, err := registryPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(registry), "vault.json"), nil
}

func loadVaultStore() (vaultStore, error) {
	path, err := vaultPath()
	if err != nil {
		return vaultStore{}, err
	}
	return loadVaultStoreFrom(path)
}

func loadVaultStoreFrom(path string) (vaultStore, error) {
	store := vaultStore{SchemaVersion: 1}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return store, err
	}
	if err := json.Unmarshal(raw, &store); err != nil {
		return store, errors.New("o cofre local está inválido")
	}
	if store.SchemaVersion != 1 {
		return store, errors.New("a versão do cofre local não é compatível")
	}
	return store, nil
}

func saveVaultStore(store vaultStore) error {
	path, err := vaultPath()
	if err != nil {
		return err
	}
	return saveVaultStoreTo(path, store)
}

func saveVaultStoreTo(path string, store vaultStore) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	store.SchemaVersion = 1
	sort.SliceStable(store.Records, func(i, j int) bool {
		return store.Records[i].Label < store.Records[j].Label
	})
	raw, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o600)
}

func vaultMetadataList(store vaultStore) []vaultMetadata {
	result := make([]vaultMetadata, 0, len(store.Records))
	for _, record := range store.Records {
		result = append(result, vaultMetadata{
			InstallationID: record.InstallationID,
			Label:          record.Label,
			UpdatedAt:      record.UpdatedAt,
		})
	}
	return result
}

func saveVaultSecret(store *vaultStore, installationID, label string, secret vaultSecret) error {
	if installationID == "" || label == "" || secret.Login == "" || secret.Password == "" {
		return errors.New("estrutura, login e senha são obrigatórios")
	}
	raw, err := json.Marshal(secret)
	if err != nil {
		return err
	}
	protected, err := protectLocalSecret(raw)
	if err != nil {
		return err
	}
	record := vaultRecord{
		InstallationID: installationID,
		Label:          label,
		ProtectedData:  base64.StdEncoding.EncodeToString(protected),
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	for index := range store.Records {
		if store.Records[index].InstallationID == installationID {
			store.Records[index] = record
			return nil
		}
	}
	store.Records = append(store.Records, record)
	return nil
}

func readVaultSecret(store vaultStore, installationID string) (vaultSecret, error) {
	for _, record := range store.Records {
		if record.InstallationID != installationID {
			continue
		}
		protected, err := base64.StdEncoding.DecodeString(record.ProtectedData)
		if err != nil {
			return vaultSecret{}, errors.New("credencial local inválida")
		}
		raw, err := unprotectLocalSecret(protected)
		if err != nil {
			return vaultSecret{}, err
		}
		var secret vaultSecret
		if err := json.Unmarshal(raw, &secret); err != nil {
			return vaultSecret{}, errors.New("credencial local inválida")
		}
		return secret, nil
	}
	return vaultSecret{}, os.ErrNotExist
}

func deleteVaultSecret(store *vaultStore, installationID string) {
	filtered := store.Records[:0]
	for _, record := range store.Records {
		if record.InstallationID != installationID {
			filtered = append(filtered, record)
		}
	}
	store.Records = filtered
}
