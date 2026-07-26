package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSafeJoinKeepsFilesInsideDestination(t *testing.T) {
	root := t.TempDir()
	target, err := safeJoin(root, filepath.Join("runtime", "node"))
	if err != nil {
		t.Fatalf("safeJoin returned an unexpected error: %v", err)
	}
	expected := filepath.Join(root, "runtime", "node")
	if target != expected {
		t.Fatalf("expected %q, received %q", expected, target)
	}
}

func TestSafeJoinRejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	if _, err := safeJoin(root, filepath.Join("..", "outside")); err == nil {
		t.Fatal("safeJoin accepted a path outside the destination")
	}
}

func TestIsKranoSource(t *testing.T) {
	root := t.TempDir()
	if ready, err := isKranoSource(root); err != nil || ready {
		t.Fatalf("empty folder should not be a KRANO source: ready=%v err=%v", ready, err)
	}
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"krano"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if ready, err := isKranoSource(root); err != nil || !ready {
		t.Fatalf("valid package should be recognized: ready=%v err=%v", ready, err)
	}
}

func TestNodeArchitectureMapping(t *testing.T) {
	architecture, err := nodeArch()
	if err != nil {
		t.Fatalf("current architecture must be supported in CI: %v", err)
	}
	if architecture != "x64" && architecture != "arm64" {
		t.Fatalf("unexpected Node.js architecture: %s", architecture)
	}
}
