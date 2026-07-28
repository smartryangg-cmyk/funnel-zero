package main

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func TestOverlayProjectSourceUpdatesCodeAndPreservesInstallationState(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	target := filepath.Join(t.TempDir(), "target")
	for _, folder := range []string{source, target, filepath.Join(target, ".funnel-zero")} {
		if err := os.MkdirAll(folder, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, "package.json"), []byte(`{"name":"krano","version":"0.3.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "wrangler.jsonc"), []byte(`{"name":"default"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "package.json"), []byte(`{"name":"krano","version":"0.1.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "wrangler.jsonc"), []byte(`{"name":"customer"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(target, ".funnel-zero", "installation.json")
	if err := os.WriteFile(manifest, []byte(`{"worker":{"url":"https://customer.example"}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := overlayProjectSource(source, target); err != nil {
		t.Fatal(err)
	}
	if version := projectVersion(target); version != "0.3.0" {
		t.Fatalf("expected updated source version, received %q", version)
	}
	config, err := os.ReadFile(filepath.Join(target, "wrangler.jsonc"))
	if err != nil || string(config) != `{"name":"customer"}` {
		t.Fatalf("customer config was overwritten: %q err=%v", config, err)
	}
	if _, err := os.Stat(manifest); err != nil {
		t.Fatalf("installation state was not preserved: %v", err)
	}
}

func TestValidBranchNameAcceptsFeatureBranchesAndRejectsTraversal(t *testing.T) {
	if !validBranchName("feature/krano-monochrome-control-center") {
		t.Fatal("feature branch should be accepted")
	}
	for _, branch := range []string{"", "../main", "/main", "feature//main", `feature\main`, "main.lock"} {
		if validBranchName(branch) {
			t.Fatalf("unsafe branch %q was accepted", branch)
		}
	}
}

func TestNormalizeInstallerArgsAcceptsRecoverBeforeFlags(t *testing.T) {
	args, recovery := normalizeInstallerArgs([]string{"recover", "--target", `C:\KRANO`, "--yes"})
	if !recovery {
		t.Fatal("recover command was not detected")
	}
	if got := strings.Join(args, "|"); got != `--target|C:\KRANO|--yes` {
		t.Fatalf("unexpected normalized arguments: %s", got)
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

func TestParseCLIResultUsesStructuredSignal(t *testing.T) {
	output := "progresso\n" + resultPrefix + `{"ok":true,"action":"onboarding","url":"https://krano.example/setup?token=abc","recoveryFile":"C:\\KRANO\\.funnel-zero\\setup-url.txt","version":"0.4.3"}` + "\n"
	result, err := parseCLIResult(output)
	if err != nil {
		t.Fatalf("valid result was rejected: %v", err)
	}
	if !result.OK || result.Action != "onboarding" || result.Version != appVersion {
		t.Fatalf("unexpected parsed result: %#v", result)
	}
}

func TestParseCLIResultRejectsMissingOrUnsafeURL(t *testing.T) {
	if _, err := parseCLIResult("instalação concluída\n"); err == nil {
		t.Fatal("missing structured result was accepted")
	}
	output := resultPrefix + `{"ok":true,"action":"onboarding","url":"file:///tmp/token"}`
	if _, err := parseCLIResult(output); err == nil {
		t.Fatal("unsafe URL was accepted")
	}
}

func TestInstallerLogRedactsOneTimeTokens(t *testing.T) {
	input := `Abra https://krano.example/reset-password?token=segredo-123&next=login`
	redacted := redactSensitiveURLs(input)
	if strings.Contains(redacted, "segredo-123") {
		t.Fatal("one-time token leaked into the installer log")
	}
	if !strings.Contains(redacted, "token=[REDACTED]") {
		t.Fatalf("expected redaction marker, received %q", redacted)
	}
}
