//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVaultRoundTripUsesWindowsProtection(t *testing.T) {
	var store vaultStore
	secret := vaultSecret{
		Login:    "player@example.com",
		Password: "senha-que-nao-pode-vazar",
		Recovery: "telefone final 1234",
	}
	if err := saveVaultSecret(&store, "estrutura-1", "KRANO Principal", secret); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "vault.json")
	if err := saveVaultStoreTo(path, store); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secret.Password) || strings.Contains(string(raw), secret.Login) {
		t.Fatal("o cofre gravou credenciais em texto aberto")
	}
	loaded, err := loadVaultStoreFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := readVaultSecret(loaded, "estrutura-1")
	if err != nil {
		t.Fatal(err)
	}
	if actual != secret {
		t.Fatalf("credencial recuperada difere da original: %#v", actual)
	}
}
