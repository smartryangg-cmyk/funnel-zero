package main

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
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

func TestArchiveSymlinkAcceptsNodeInternalLinks(t *testing.T) {
	root := t.TempDir()
	if err := validateArchiveSymlink(
		root,
		"node-v24.0.0-linux-x64/bin/npm",
		"../lib/node_modules/npm/bin/npm-cli.js",
	); err != nil {
		t.Fatalf("valid Node.js symlink was rejected: %v", err)
	}
}

func TestArchiveSymlinkRejectsEscapesAndAbsoluteTargets(t *testing.T) {
	root := t.TempDir()
	if err := validateArchiveSymlink(
		root,
		"node-v24.0.0-linux-x64/bin/npm",
		"../../../outside",
	); err == nil {
		t.Fatal("symlink escaping the destination was accepted")
	}
	absolute := "/outside"
	if filepath.Separator == '\\' {
		absolute = `C:\outside`
	}
	if err := validateArchiveSymlink(root, "runtime/bin/npm", absolute); err == nil {
		t.Fatal("absolute symlink target was accepted")
	}
}

func TestExtractTarGzPreservesSafeNodeSymlinksOnLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux validates the portable Node.js symlink layout in CI")
	}
	root := t.TempDir()
	archive := filepath.Join(root, "node.tar.gz")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	content := []byte("#!/usr/bin/env node\n")
	if err := tarWriter.WriteHeader(&tar.Header{
		Name: "node-v24/lib/node_modules/npm/bin/npm-cli.js",
		Mode: 0o755,
		Size: int64(len(content)),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.WriteHeader(&tar.Header{
		Name:     "node-v24/bin/npm",
		Linkname: "../lib/node_modules/npm/bin/npm-cli.js",
		Mode:     0o755,
		Typeflag: tar.TypeSymlink,
	}); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(root, "runtime")
	if err := extractTarGz(archive, destination); err != nil {
		t.Fatalf("extractTarGz rejected a valid Node.js layout: %v", err)
	}
	resolved, err := os.ReadFile(filepath.Join(destination, "node-v24", "bin", "npm"))
	if err != nil {
		t.Fatalf("npm symlink is not usable: %v", err)
	}
	if string(resolved) != string(content) {
		t.Fatal("npm symlink did not resolve to the expected internal file")
	}
}
