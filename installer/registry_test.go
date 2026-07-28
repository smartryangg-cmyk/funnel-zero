package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverInstallationReadsManifest(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, ".funnel-zero")
	if err := os.MkdirAll(state, 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := `{
	  "schemaVersion": 1,
	  "appVersion": "0.4.2",
	  "installationName": "krano-teste",
	  "accountId": "account-1",
	  "worker": {"name":"krano-teste","url":"https://krano-teste.example.workers.dev"},
	  "d1": {"name":"krano-teste-db","id":"db-1"},
	  "r2": {"name":"krano-teste-media","storageClass":"Standard"},
	  "freeOnly": true
	}`
	if err := os.WriteFile(filepath.Join(state, "installation.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	item := discoverInstallation(root, "pessoal")
	if item.Status != "installed" || item.Name != "krano-teste" || item.Profile != "pessoal" {
		t.Fatalf("manifest was not discovered: %#v", item)
	}
}

func TestRegistryUpsertDoesNotDuplicatePath(t *testing.T) {
	var registry desktopRegistry
	first := desktopInstallation{ID: installationID(`C:\KRANO`), Path: `C:\KRANO`, Name: "primeira"}
	registry.upsertInstallation(first)
	first.Name = "atualizada"
	registry.upsertInstallation(first)
	if len(registry.Installations) != 1 || registry.Installations[0].Name != "atualizada" {
		t.Fatalf("unexpected registry: %#v", registry.Installations)
	}
}

func TestRegistryUpsertProfileDoesNotDuplicateName(t *testing.T) {
	var registry desktopRegistry
	registry.upsertProfile(desktopProfile{Name: "Cliente Principal"})
	registry.upsertProfile(desktopProfile{Name: "cliente-principal", ConnectedAt: "2026-07-28T12:00:00Z"})
	if len(registry.Profiles) != 1 ||
		registry.Profiles[0].Name != "cliente-principal" ||
		registry.Profiles[0].ConnectedAt == "" {
		t.Fatalf("unexpected profiles: %#v", registry.Profiles)
	}
}

func TestNormalizeNames(t *testing.T) {
	if got := normalizeStructureName(" Minha Oferta 01 "); got != "krano-minha-oferta-01" {
		t.Fatalf("unexpected structure name: %q", got)
	}
	if got := normalizeProfileName("Cliente A / Principal"); got != "cliente-a-principal" {
		t.Fatalf("unexpected profile name: %q", got)
	}
}
