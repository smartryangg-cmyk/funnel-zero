package main

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	appVersion   = "0.4.8"
	repository   = "smartryangg-cmyk/funnel-zero"
	resultPrefix = "KRANO_RESULT_JSON:"
)

var defaultBranch = "feature/krano-monochrome-control-center"

type nodeRelease struct {
	Version string          `json:"version"`
	LTS     json.RawMessage `json:"lts"`
	Files   []string        `json:"files"`
}

type cliResult struct {
	OK           bool   `json:"ok"`
	Action       string `json:"action"`
	URL          string `json:"url"`
	RecoveryFile string `json:"recoveryFile"`
	Version      string `json:"version"`
}

func main() {
	var target string
	var branch string
	var dryRun bool
	var showVersion bool
	var consoleMode bool
	var appMode bool
	var nonInteractive bool
	flag.StringVar(&target, "target", "", "pasta onde a KRANO será instalada")
	flag.StringVar(&branch, "branch", defaultBranch, "ramo do GitHub a instalar")
	flag.BoolVar(&dryRun, "dry-run", false, "mostra o plano sem baixar ou alterar arquivos")
	flag.BoolVar(&showVersion, "version", false, "mostra a versão do instalador")
	flag.BoolVar(&consoleMode, "cli", false, "usa o instalador no terminal")
	flag.BoolVar(&appMode, "app", false, "abre a central desktop de gerenciamento")
	flag.BoolVar(&nonInteractive, "yes", false, "confirma automaticamente as etapas seguras")
	flag.Usage = printHelp
	normalizedArgs, recoveryMode := normalizeInstallerArgs(os.Args[1:])
	if err := flag.CommandLine.Parse(normalizedArgs); err != nil {
		fatal(err)
	}
	projectArgs := append([]string(nil), flag.Args()...)
	if recoveryMode {
		projectArgs = append([]string{"recover"}, projectArgs...)
	}
	if nonInteractive && !contains(projectArgs, "--yes") {
		projectArgs = append(projectArgs, "--yes")
	}

	if showVersion {
		fmt.Printf("KRANO Installer %s\n", appVersion)
		return
	}
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		fatalf("este instalador atende Windows e Linux; sistema detectado: %s", runtime.GOOS)
	}

	resolvedTarget, err := resolveTarget(target)
	if err != nil {
		fatal(err)
	}
	if runtime.GOOS == "windows" && (appMode || launchedFromExplorer()) && !consoleMode && !dryRun {
		hideConsoleWindow()
		if err := runWizard(resolvedTarget, branch, projectArgs); err != nil {
			fatalf("não foi possível abrir o assistente: %v", err)
		}
		return
	}
	fmt.Println()
	fmt.Println("KRANO — instalação automática")
	fmt.Println("────────────────────────────")
	fmt.Printf("Sistema: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Printf("Destino: %s\n", resolvedTarget)
	fmt.Println("Acesso: autorização oficial da Cloudflare no navegador")
	fmt.Println()
	if dryRun {
		fmt.Println("Simulação concluída. Nenhum arquivo foi alterado.")
		return
	}

	sourceReady, err := isKranoSource(resolvedTarget)
	if err != nil {
		fatal(err)
	}
	installedVersion := projectVersion(resolvedTarget)
	if !sourceReady || installedVersion != appVersion {
		fmt.Println("[1/4] Baixando o código aberto da KRANO…")
		if err := installSource(resolvedTarget, branch); err != nil {
			fatalf("não foi possível preparar o projeto: %v", err)
		}
	} else {
		fmt.Println("[1/4] Projeto KRANO já encontrado. Reutilizando a instalação local.")
	}

	fmt.Println("[2/4] Verificando o ambiente necessário…")
	nodePath, err := ensureNode(resolvedTarget)
	if err != nil {
		fatalf("não foi possível preparar o Node.js automaticamente: %v", err)
	}

	fmt.Println("[3/4] Preparando dependências e infraestrutura…")
	result, logPath, err := runProjectInstaller(resolvedTarget, nodePath, projectArgs)
	if err != nil {
		if logPath != "" {
			fmt.Printf("Log da tentativa: %s\n", logPath)
		}
		fatalf("a instalação da KRANO não foi concluída: %v", err)
	}
	if !result.OK || result.URL == "" {
		fatal(errors.New("a instalação terminou sem devolver um endereço seguro para continuar"))
	}

	fmt.Println()
	if result.Action == "recovery" {
		fmt.Println("[4/4] Recuperação preparada com sucesso.")
	} else {
		fmt.Println("[4/4] KRANO instalada com sucesso.")
	}
	fmt.Printf("Projeto local: %s\n", resolvedTarget)
	fmt.Printf("Continuar no navegador: %s\n", result.URL)
	if result.RecoveryFile != "" {
		fmt.Printf("Cópia local do endereço: %s\n", result.RecoveryFile)
	}
	if logPath != "" {
		fmt.Printf("Log da instalação: %s\n", logPath)
	}
	if err := openURL(result.URL); err != nil {
		fmt.Printf("Não foi possível abrir o navegador automaticamente: %v\n", err)
		fmt.Println("Copie o endereço acima e abra-o no navegador.")
	} else {
		fmt.Println("O navegador foi aberto automaticamente.")
	}
	fmt.Println("Guarde esta pasta. Ela contém o código da sua própria instalação.")
	pauseIfExplorerLaunch()
}

func normalizeInstallerArgs(args []string) ([]string, bool) {
	normalized := make([]string, 0, len(args))
	recovery := false
	for _, arg := range args {
		if arg == "recover" {
			recovery = true
			continue
		}
		normalized = append(normalized, arg)
	}
	return normalized, recovery
}

func printHelp() {
	fmt.Printf(`KRANO Installer %s

Instala a KRANO em uma única execução. O instalador:
  1. baixa o projeto oficial do GitHub;
  2. prepara automaticamente o Node.js quando necessário;
  3. abre a autorização oficial da Cloudflare;
  4. cria ou reutiliza Worker, D1 e R2;
  5. publica e entrega a URL do painel.

Uso:
  KRANO-Installer-Windows-x64.exe
  KRANO-Installer-Windows-x64.exe recover
  ./krano-installer-linux-x64
  ./krano-installer-linux-x64 recover

Opções:
  --target CAMINHO   escolhe a pasta de instalação
  --branch NOME      instala outro ramo do GitHub
  --dry-run          mostra o plano sem alterar arquivos
  --cli              usa a interface de terminal
  --version          mostra a versão
  --help             mostra esta ajuda

O comando recover cria um link local, temporário e de uso único para redefinir
a senha do proprietário sem enviar credenciais a serviços externos.

Não é necessário instalar Node.js, Git, Wrangler ou Docker manualmente.
`, appVersion)
}

func resolveTarget(input string) (string, error) {
	if input != "" {
		return filepath.Abs(input)
	}
	cwd, err := os.Getwd()
	if err == nil {
		if ready, _ := isKranoSource(cwd); ready {
			return cwd, nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("não foi possível identificar sua pasta pessoal: %w", err)
	}
	base := filepath.Join(home, "KRANO")
	if _, err := os.Stat(base); errors.Is(err, os.ErrNotExist) {
		return base, nil
	}
	if ready, _ := isKranoSource(base); ready {
		return base, nil
	}
	return filepath.Join(home, "KRANO-"+time.Now().Format("20060102-150405")), nil
}

func isKranoSource(folder string) (bool, error) {
	raw, err := os.ReadFile(filepath.Join(folder, "package.json"))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var value struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, nil
	}
	return value.Name == "krano", nil
}

func projectVersion(folder string) string {
	raw, err := os.ReadFile(filepath.Join(folder, "package.json"))
	if err != nil {
		return ""
	}
	var value struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	return value.Version
}

func installSource(target, branch string) error {
	if !validBranchName(branch) {
		return errors.New("nome de ramo inválido")
	}
	temp, err := os.MkdirTemp("", "krano-source-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)

	archive := filepath.Join(temp, "source.zip")
	sourceURL := fmt.Sprintf("https://github.com/%s/archive/refs/heads/%s.zip", repository, url.PathEscape(branch))
	if err := download(sourceURL, archive); err != nil {
		return err
	}
	staging := filepath.Join(temp, "source")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	if err := extractZip(archive, staging, true); err != nil {
		return err
	}
	ready, err := isKranoSource(staging)
	if err != nil {
		return err
	}
	if !ready {
		return errors.New("o pacote baixado não contém um projeto KRANO válido")
	}
	return overlayProjectSource(staging, target)
}

func validBranchName(branch string) bool {
	if branch == "" || strings.Contains(branch, `\`) || strings.Contains(branch, "..") ||
		strings.Contains(branch, "//") || strings.Contains(branch, "@{") ||
		strings.HasPrefix(branch, "/") || strings.HasSuffix(branch, "/") ||
		strings.HasSuffix(branch, ".") || strings.HasSuffix(branch, ".lock") {
		return false
	}
	return regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]*$`).MatchString(branch)
}

func overlayProjectSource(source, target string) error {
	protected := map[string]bool{
		".dev.vars":      true,
		".funnel-zero":   true,
		".git":           true,
		".runtime":       true,
		".wrangler":      true,
		"node_modules":   true,
		"wrangler.jsonc": true,
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil || relative == "." {
			return err
		}
		first := strings.Split(relative, string(filepath.Separator))[0]
		if protected[first] {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		destination, err := safeJoin(target, relative)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			input.Close()
			return err
		}
		output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := errors.Join(input.Close(), output.Close())
		return errors.Join(copyErr, closeErr)
	})
}

func ensureNode(project string) (string, error) {
	if path, err := exec.LookPath(nodeExecutable()); err == nil {
		if major, err := nodeMajor(path); err == nil && major >= 20 {
			fmt.Printf("      Node.js %d encontrado no sistema.\n", major)
			return path, nil
		}
	}

	runtimeRoot := filepath.Join(project, ".runtime", "node")
	if path, err := findNode(runtimeRoot); err == nil {
		if major, err := nodeMajor(path); err == nil && major >= 20 {
			fmt.Printf("      Node.js portátil %d encontrado.\n", major)
			return path, nil
		}
	}

	fmt.Println("      Node.js não encontrado. Baixando uma versão LTS portátil e verificada…")
	release, asset, err := selectNodeRelease()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(runtimeRoot, 0o755); err != nil {
		return "", err
	}
	temp, err := os.MkdirTemp("", "krano-node-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	archive := filepath.Join(temp, asset)
	baseURL := fmt.Sprintf("https://nodejs.org/dist/%s", release.Version)
	if err := download(baseURL+"/"+asset, archive); err != nil {
		return "", err
	}
	checksums := filepath.Join(temp, "SHASUMS256.txt")
	if err := download(baseURL+"/SHASUMS256.txt", checksums); err != nil {
		return "", err
	}
	if err := verifyChecksum(archive, checksums, asset); err != nil {
		return "", err
	}
	if strings.HasSuffix(asset, ".zip") {
		if err := extractZip(archive, runtimeRoot, false); err != nil {
			return "", err
		}
	} else {
		if err := extractTarGz(archive, runtimeRoot); err != nil {
			return "", err
		}
	}
	path, err := findNode(runtimeRoot)
	if err != nil {
		return "", err
	}
	return path, nil
}

func selectNodeRelease() (nodeRelease, string, error) {
	response, err := httpClient().Get("https://nodejs.org/dist/index.json")
	if err != nil {
		return nodeRelease{}, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nodeRelease{}, "", fmt.Errorf("catálogo Node.js respondeu HTTP %d", response.StatusCode)
	}
	var releases []nodeRelease
	if err := json.NewDecoder(io.LimitReader(response.Body, 5<<20)).Decode(&releases); err != nil {
		return nodeRelease{}, "", err
	}
	arch, err := nodeArch()
	if err != nil {
		return nodeRelease{}, "", err
	}
	fileKey := "linux-" + arch
	extension := ".tar.gz"
	if runtime.GOOS == "windows" {
		fileKey = "win-" + arch + "-zip"
		extension = ".zip"
	}
	for _, release := range releases {
		major, _ := strconv.Atoi(strings.Split(strings.TrimPrefix(release.Version, "v"), ".")[0])
		if major < 20 || string(release.LTS) == "false" || string(release.LTS) == "null" {
			continue
		}
		if !contains(release.Files, fileKey) {
			continue
		}
		name := fmt.Sprintf("node-%s-%s-%s%s", release.Version, runtime.GOOS, arch, extension)
		if runtime.GOOS == "windows" {
			name = fmt.Sprintf("node-%s-win-%s.zip", release.Version, arch)
		}
		return release, name, nil
	}
	return nodeRelease{}, "", errors.New("nenhuma versão Node.js LTS compatível foi encontrada")
}

func nodeArch() (string, error) {
	switch runtime.GOARCH {
	case "amd64":
		return "x64", nil
	case "arm64":
		return "arm64", nil
	default:
		return "", fmt.Errorf("arquitetura ainda não suportada: %s", runtime.GOARCH)
	}
}

func runProjectInstaller(project, nodePath string, args []string) (cliResult, string, error) {
	installer := filepath.Join(project, "install.mjs")
	if contains(args, "recover") {
		installer = filepath.Join(project, "packages", "cli", "bin", "funnel-zero.mjs")
	}
	if _, err := os.Stat(installer); err != nil {
		return cliResult{}, "", errors.New("install.mjs não foi encontrado no projeto")
	}
	commandArgs := append([]string{installer}, args...)
	command := exec.Command(nodePath, commandArgs...)
	command.Dir = project
	command.Stdin = os.Stdin
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = io.MultiWriter(os.Stdout, &stdout)
	command.Stderr = io.MultiWriter(os.Stderr, &stderr)
	pathKey := "PATH"
	nodeDir := filepath.Dir(nodePath)
	command.Env = append(os.Environ(), pathKey+"="+nodeDir+string(os.PathListSeparator)+os.Getenv(pathKey))
	runErr := command.Run()
	logPath, logErr := writeInstallerLog(project, stdout.String(), stderr.String())
	if runErr != nil {
		return cliResult{}, logPath, runErr
	}
	if logErr != nil {
		fmt.Printf("Aviso: não foi possível gravar o log local: %v\n", logErr)
	}
	result, err := parseCLIResult(stdout.String())
	if err != nil {
		return cliResult{}, logPath, err
	}
	return result, logPath, nil
}

func parseCLIResult(output string) (cliResult, error) {
	var raw string
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if index := strings.Index(line, resultPrefix); index >= 0 {
			raw = strings.TrimSpace(line[index+len(resultPrefix):])
		}
	}
	if err := scanner.Err(); err != nil {
		return cliResult{}, err
	}
	if raw == "" {
		return cliResult{}, errors.New("o instalador local não devolveu o resultado final")
	}
	var result cliResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return cliResult{}, errors.New("o instalador local devolveu um resultado inválido")
	}
	parsed, err := url.Parse(result.URL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return cliResult{}, errors.New("o instalador local devolveu um endereço inválido")
	}
	return result, nil
}

func writeInstallerLog(project, stdout, stderr string) (string, error) {
	stateDir := filepath.Join(project, ".funnel-zero")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return "", err
	}
	logPath := filepath.Join(stateDir, "installer.log")
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return "", err
	}
	defer file.Close()
	_, err = fmt.Fprintf(
		file,
		"\n[%s] KRANO Installer %s\n%s%s",
		time.Now().UTC().Format(time.RFC3339),
		appVersion,
		redactSensitiveURLs(stdout),
		redactSensitiveURLs(stderr),
	)
	return logPath, err
}

func redactSensitiveURLs(value string) string {
	pattern := regexp.MustCompile(`(?i)([?&]token=)[A-Za-z0-9._~-]+`)
	return pattern.ReplaceAllString(value, `${1}[REDACTED]`)
}

func openURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return errors.New("endereço inválido")
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL)
	case "linux":
		command = exec.Command("xdg-open", rawURL)
	default:
		return errors.New("abertura automática não suportada neste sistema")
	}
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func pauseIfExplorerLaunch() {
	if !launchedFromExplorer() {
		return
	}
	fmt.Println()
	fmt.Print("Pressione Enter para fechar esta janela…")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

func launchedFromExplorer() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	if os.Getenv("CI") == "true" || os.Getenv("GITHUB_ACTIONS") == "true" || os.Getenv("KRANO_NO_PAUSE") == "1" {
		return false
	}
	script := fmt.Sprintf(
		"(Get-Process -Id %d -ErrorAction SilentlyContinue).ProcessName",
		os.Getppid(),
	)
	output, err := exec.Command(
		"powershell.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		script,
	).Output()
	if err != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(string(output)), "explorer")
}

func nodeExecutable() string {
	if runtime.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

func nodeMajor(path string) (int, error) {
	output, err := exec.Command(path, "--version").Output()
	if err != nil {
		return 0, err
	}
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(string(output)), "v"), ".")
	if len(parts) == 0 {
		return 0, errors.New("versão Node.js inválida")
	}
	return strconv.Atoi(parts[0])
}

func findNode(root string) (string, error) {
	var found string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if strings.EqualFold(entry.Name(), nodeExecutable()) {
			found = path
			return io.EOF
		}
		return nil
	})
	if errors.Is(err, io.EOF) && found != "" {
		return found, nil
	}
	if err != nil {
		return "", err
	}
	return "", errors.New("executável Node.js não encontrado no pacote")
}

func download(url, destination string) error {
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "KRANO-Installer/"+appVersion)
	response, err := httpClient().Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s respondeu HTTP %d", url, response.StatusCode)
	}
	file, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, io.LimitReader(response.Body, 500<<20))
	return err
}

func httpClient() *http.Client {
	return &http.Client{Timeout: 20 * time.Minute}
}

func verifyChecksum(archive, checksumFile, asset string) error {
	file, err := os.Open(checksumFile)
	if err != nil {
		return err
	}
	defer file.Close()
	expected := ""
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == asset {
			expected = fields[0]
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if expected == "" {
		return errors.New("checksum do Node.js não encontrado")
	}
	input, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer input.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, input); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return errors.New("o pacote Node.js falhou na verificação SHA-256")
	}
	return nil
}

func extractZip(archive, destination string, stripRoot bool) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	for _, item := range reader.File {
		name := filepath.FromSlash(item.Name)
		if stripRoot {
			parts := strings.Split(name, string(filepath.Separator))
			if len(parts) < 2 {
				continue
			}
			name = filepath.Join(parts[1:]...)
		}
		if name == "" || name == "." {
			continue
		}
		target, err := safeJoin(destination, name)
		if err != nil {
			return err
		}
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		input, err := item.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, item.Mode())
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := errors.Join(input.Close(), output.Close())
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func extractTarGz(archive, destination string) error {
	file, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		target, err := safeJoin(destination, filepath.FromSlash(header.Name))
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(output, reader); err != nil {
				output.Close()
				return err
			}
			if err := output.Close(); err != nil {
				return err
			}
		case tar.TypeSymlink:
			if err := validateArchiveSymlink(destination, header.Name, header.Linkname); err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			linkName := filepath.FromSlash(header.Linkname)
			if err := os.Symlink(linkName, target); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
		}
	}
	return nil
}

func safeJoin(root, name string) (string, error) {
	target := filepath.Join(root, filepath.Clean(name))
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("o pacote contém um caminho inseguro")
	}
	return target, nil
}

func validateArchiveSymlink(root, archiveName, linkName string) error {
	normalizedLink := filepath.FromSlash(linkName)
	if filepath.IsAbs(normalizedLink) {
		return errors.New("o pacote contém um link absoluto inseguro")
	}
	linkFolder := filepath.Dir(filepath.FromSlash(archiveName))
	if _, err := safeJoin(root, filepath.Join(linkFolder, normalizedLink)); err != nil {
		return errors.New("o pacote contém um link que sai da pasta de instalação")
	}
	return nil
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr)
	fmt.Fprintf(os.Stderr, "ERRO: %v\n", err)
	fmt.Fprintln(os.Stderr, "Nada foi removido. Revise a conexão e execute o instalador novamente.")
	pauseIfExplorerLaunch()
	os.Exit(1)
}

func fatalf(format string, values ...any) {
	fatal(fmt.Errorf(format, values...))
}
