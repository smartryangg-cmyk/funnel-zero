package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

type wizardState struct {
	Status          string                `json:"status"`
	Step            int                   `json:"step"`
	Title           string                `json:"title"`
	Message         string                `json:"message"`
	Error           string                `json:"error,omitempty"`
	ActiveID        string                `json:"activeId,omitempty"`
	ProjectPath     string                `json:"projectPath,omitempty"`
	TutorialEnabled bool                  `json:"tutorialEnabled"`
	Profiles        []desktopProfile      `json:"profiles"`
	Installations   []desktopInstallation `json:"installations"`
	Vault           []vaultMetadata       `json:"vault"`
}

type operationRequest struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Profile      string `json:"profile"`
	Confirmation string `json:"confirmation"`
	PreserveD1   bool   `json:"preserveD1"`
	PreserveR2   bool   `json:"preserveR2"`
	RemoveLocal  bool   `json:"removeLocal"`
	Enabled      *bool  `json:"enabled"`
}

type vaultRequest struct {
	ID           string `json:"id"`
	Login        string `json:"login"`
	Password     string `json:"password"`
	Recovery     string `json:"recovery"`
	Confirmation string `json:"confirmation"`
}

type wizardServer struct {
	mu        sync.RWMutex
	state     wizardState
	registry  desktopRegistry
	token     string
	target    string
	branch    string
	args      []string
	started   bool
	operation string
	shutdown  func()
}

func runWizard(target, branch string, args []string) error {
	registry, err := loadDesktopRegistry(target)
	if err != nil {
		return err
	}
	_ = saveDesktopRegistry(registry)
	initial := wizardState{
		Status:          "ready",
		Title:           "Sua central KRANO",
		Message:         "Instale e gerencie estruturas Cloudflare sem depender do terminal.",
		TutorialEnabled: registry.TutorialEnabled,
		Profiles:        registry.Profiles,
		Installations:   registry.Installations,
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	wizard := &wizardServer{
		state: initial, registry: registry, token: randomTokenForWizard(),
		target: target, branch: branch, args: append([]string(nil), args...),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", wizard.page)
	mux.HandleFunc("/api/state", wizard.readState)
	mux.HandleFunc("/api/install", wizard.installRequest)
	mux.HandleFunc("/api/connect", wizard.connectRequest)
	mux.HandleFunc("/api/open", wizard.openRequest)
	mux.HandleFunc("/api/recover", wizard.recoverRequest)
	mux.HandleFunc("/api/remove", wizard.removeRequest)
	mux.HandleFunc("/api/tutorial", wizard.tutorialRequest)
	mux.HandleFunc("/api/vault/save", wizard.vaultSaveRequest)
	mux.HandleFunc("/api/vault/read", wizard.vaultReadRequest)
	mux.HandleFunc("/api/vault/delete", wizard.vaultDeleteRequest)
	mux.HandleFunc("/api/exit", wizard.exitRequest)
	server := &http.Server{
		Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 90 * time.Second,
	}
	wizard.shutdown = func() { _ = server.Close() }
	localURL := fmt.Sprintf("http://%s/?token=%s", listener.Addr().String(), wizard.token)
	if err := openURL(localURL); err != nil {
		_ = listener.Close()
		return err
	}
	// This is a desktop control center: it intentionally remains alive until the
	// user closes the executable or Windows ends the process.
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (wizard *wizardServer) authorized(request *http.Request) bool {
	return request.URL.Query().Get("token") == wizard.token ||
		request.Header.Get("X-Krano-Token") == wizard.token
}

func (wizard *wizardServer) page(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/" || !wizard.authorized(request) {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
	_ = wizardTemplate.Execute(response, map[string]string{"Token": wizard.token, "Version": appVersion})
}

func (wizard *wizardServer) readState(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet || !wizard.authorized(request) {
		http.NotFound(response, request)
		return
	}
	wizard.mu.Lock()
	wizard.registry.refresh()
	wizard.state.Profiles = append([]desktopProfile(nil), wizard.registry.Profiles...)
	wizard.state.Installations = append([]desktopInstallation(nil), wizard.registry.Installations...)
	if vault, err := loadVaultStore(); err == nil {
		wizard.state.Vault = vaultMetadataList(vault)
	}
	state := wizard.state
	wizard.mu.Unlock()
	writeWizardJSON(response, state)
}

func (wizard *wizardServer) decode(response http.ResponseWriter, request *http.Request) (operationRequest, bool) {
	if request.Method != http.MethodPost || !wizard.authorized(request) {
		http.NotFound(response, request)
		return operationRequest{}, false
	}
	var input operationRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16<<10)).Decode(&input); err != nil {
		http.Error(response, "Pedido inválido.", http.StatusBadRequest)
		return operationRequest{}, false
	}
	return input, true
}

func (wizard *wizardServer) begin(response http.ResponseWriter, operation, title, message string, item desktopInstallation) bool {
	wizard.mu.Lock()
	defer wizard.mu.Unlock()
	if wizard.started {
		http.Error(response, "Aguarde a operação atual terminar.", http.StatusConflict)
		return false
	}
	wizard.started = true
	wizard.operation = operation
	wizard.state.Status = "running"
	wizard.state.Step = 1
	wizard.state.Title = title
	wizard.state.Message = message
	wizard.state.Error = ""
	wizard.state.ActiveID = item.ID
	wizard.state.ProjectPath = item.Path
	return true
}

func (wizard *wizardServer) installRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decode(response, request)
	if !ok {
		return
	}
	name := normalizeStructureName(input.Name)
	profile := normalizeProfileName(input.Profile)
	var item desktopInstallation
	if input.ID != "" {
		wizard.mu.RLock()
		item, ok = wizard.registry.findInstallation(input.ID)
		wizard.mu.RUnlock()
		if !ok {
			http.Error(response, "Estrutura não encontrada.", http.StatusNotFound)
			return
		}
		if profile != "" {
			item.Profile = profile
		}
	} else {
		if name == "" {
			http.Error(response, "Informe um nome válido.", http.StatusBadRequest)
			return
		}
		item = discoverInstallation(wizard.newTarget(name), profile)
		item.Name = name
	}
	if !wizard.begin(response, "install", "Preparando a estrutura", "Verificando o computador e a conta Cloudflare.", item) {
		return
	}
	go wizard.install(item)
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) connectRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decode(response, request)
	if !ok {
		return
	}
	profile := normalizeProfileName(input.Profile)
	if profile == "" {
		http.Error(response, "Informe um nome para a conta.", http.StatusBadRequest)
		return
	}
	item := discoverInstallation(wizard.target, profile)
	if !wizard.begin(response, "connect", "Conectando Cloudflare", "Autorize a conta na página oficial que será aberta.", item) {
		return
	}
	go wizard.connectProfile(profile)
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) openRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decode(response, request)
	if !ok {
		return
	}
	wizard.mu.RLock()
	item, found := wizard.registry.findInstallation(input.ID)
	wizard.mu.RUnlock()
	if !found || item.WorkerURL == "" {
		http.Error(response, "Painel indisponível.", http.StatusNotFound)
		return
	}
	if err := openURL(strings.TrimRight(item.WorkerURL, "/") + "/login"); err != nil {
		http.Error(response, "Não foi possível abrir o navegador.", http.StatusInternalServerError)
		return
	}
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) recoverRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decode(response, request)
	if !ok {
		return
	}
	wizard.mu.RLock()
	item, found := wizard.registry.findInstallation(input.ID)
	wizard.mu.RUnlock()
	if !found || item.Status != "installed" {
		http.Error(response, "Estrutura não encontrada.", http.StatusNotFound)
		return
	}
	if !wizard.begin(response, "recover", "Recuperando o acesso", "Validando a conta e criando um link temporário.", item) {
		return
	}
	go wizard.runProjectOperation(item, "recover")
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) removeRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decode(response, request)
	if !ok {
		return
	}
	wizard.mu.RLock()
	item, found := wizard.registry.findInstallation(input.ID)
	wizard.mu.RUnlock()
	if !found || item.Status != "installed" {
		http.Error(response, "Estrutura não encontrada.", http.StatusNotFound)
		return
	}
	if input.Confirmation != "REMOVER "+item.Name {
		http.Error(response, "A confirmação não corresponde ao nome da estrutura.", http.StatusBadRequest)
		return
	}
	if !wizard.begin(response, "remove", "Removendo com segurança", "A Cloudflare apagará somente os recursos descritos no manifesto local.", item) {
		return
	}
	go wizard.remove(item, input)
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) tutorialRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decode(response, request)
	if !ok || input.Enabled == nil {
		return
	}
	wizard.mu.Lock()
	wizard.registry.TutorialEnabled = *input.Enabled
	wizard.registry.OnboardingSeen = true
	wizard.state.TutorialEnabled = *input.Enabled
	err := saveDesktopRegistry(wizard.registry)
	wizard.mu.Unlock()
	if err != nil {
		http.Error(response, "Não foi possível salvar a preferência.", http.StatusInternalServerError)
		return
	}
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) decodeVault(response http.ResponseWriter, request *http.Request) (vaultRequest, bool) {
	if request.Method != http.MethodPost || !wizard.authorized(request) {
		http.NotFound(response, request)
		return vaultRequest{}, false
	}
	var input vaultRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16<<10)).Decode(&input); err != nil {
		http.Error(response, "Pedido inválido.", http.StatusBadRequest)
		return vaultRequest{}, false
	}
	return input, true
}

func (wizard *wizardServer) vaultSaveRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decodeVault(response, request)
	if !ok {
		return
	}
	if len(input.Login) > 320 || len(input.Password) > 1024 || len(input.Recovery) > 2048 {
		http.Error(response, "A credencial excede o tamanho permitido.", http.StatusBadRequest)
		return
	}
	wizard.mu.RLock()
	item, found := wizard.registry.findInstallation(input.ID)
	wizard.mu.RUnlock()
	if !found {
		http.Error(response, "Estrutura não encontrada.", http.StatusNotFound)
		return
	}
	store, err := loadVaultStore()
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	secret := vaultSecret{
		Login:    strings.TrimSpace(input.Login),
		Password: input.Password,
		Recovery: strings.TrimSpace(input.Recovery),
	}
	if err := saveVaultSecret(&store, item.ID, item.Name, secret); err != nil {
		http.Error(response, err.Error(), http.StatusBadRequest)
		return
	}
	if err := saveVaultStore(store); err != nil {
		http.Error(response, "Não foi possível salvar o cofre local.", http.StatusInternalServerError)
		return
	}
	wizard.mu.Lock()
	wizard.state.Vault = vaultMetadataList(store)
	wizard.mu.Unlock()
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) vaultReadRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decodeVault(response, request)
	if !ok {
		return
	}
	store, err := loadVaultStore()
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	secret, err := readVaultSecret(store, input.ID)
	if errors.Is(err, os.ErrNotExist) {
		http.Error(response, "Credencial não encontrada.", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(response, "O Windows não conseguiu desbloquear esta credencial.", http.StatusForbidden)
		return
	}
	writeWizardJSON(response, secret)
}

func (wizard *wizardServer) vaultDeleteRequest(response http.ResponseWriter, request *http.Request) {
	input, ok := wizard.decodeVault(response, request)
	if !ok {
		return
	}
	if input.Confirmation != "APAGAR CREDENCIAL" {
		http.Error(response, "Confirmação inválida.", http.StatusBadRequest)
		return
	}
	store, err := loadVaultStore()
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	deleteVaultSecret(&store, input.ID)
	if err := saveVaultStore(store); err != nil {
		http.Error(response, "Não foi possível atualizar o cofre.", http.StatusInternalServerError)
		return
	}
	wizard.mu.Lock()
	wizard.state.Vault = vaultMetadataList(store)
	wizard.mu.Unlock()
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) exitRequest(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || !wizard.authorized(request) {
		http.NotFound(response, request)
		return
	}
	writeWizardJSON(response, map[string]bool{"ok": true})
	go func() {
		time.Sleep(150 * time.Millisecond)
		wizard.shutdown()
	}()
}

func (wizard *wizardServer) install(item desktopInstallation) {
	sourceReady, err := isKranoSource(item.Path)
	if err != nil {
		wizard.fail(err)
		return
	}
	if !sourceReady || projectVersion(item.Path) != appVersion {
		wizard.update(1, "Baixando a KRANO", "Preparando a versão oficial sem alterar seus dados locais.")
		if err := installSource(item.Path, wizard.branch); err != nil {
			wizard.fail(err)
			return
		}
	}
	nodePath, err := ensureNode(item.Path)
	if err != nil {
		wizard.fail(err)
		return
	}
	if item.Profile != "" {
		wizard.update(2, "Selecionando a conta", "Vinculando o perfil Cloudflare à pasta desta estrutura.")
		if err := activateWranglerProfile(item.Path, nodePath, item.Profile); err != nil {
			wizard.fail(errors.New("conecte o perfil Cloudflare antes de instalar: " + err.Error()))
			return
		}
	}
	wizard.update(3, "Criando sua infraestrutura", "Worker, banco D1 e biblioteca R2 estão sendo configurados.")
	args := append([]string(nil), wizard.args...)
	if !contains(args, "--yes") {
		args = append(args, "--yes")
	}
	args = append(args, "--name="+item.Name)
	if item.Profile != "" {
		args = append(args, "--profile="+item.Profile)
	}
	result, _, err := runProjectInstaller(item.Path, nodePath, args)
	if err != nil {
		wizard.fail(err)
		return
	}
	if !result.OK || result.URL == "" {
		wizard.fail(errors.New("a instalação terminou sem devolver o endereço do painel"))
		return
	}
	item = discoverInstallation(item.Path, item.Profile)
	wizard.mu.Lock()
	wizard.registry.upsertInstallation(item)
	_ = saveDesktopRegistry(wizard.registry)
	wizard.state.Installations = append([]desktopInstallation(nil), wizard.registry.Installations...)
	wizard.state.Status = "complete"
	wizard.state.Step = 4
	wizard.state.Title = "Estrutura pronta"
	wizard.state.Message = "O painel foi publicado. O app continuará aberto para você gerenciar tudo."
	wizard.state.Error = ""
	wizard.started = false
	wizard.mu.Unlock()
	_ = openURL(result.URL)
}

func (wizard *wizardServer) runProjectOperation(item desktopInstallation, operation string) {
	nodePath, err := ensureNode(item.Path)
	if err != nil {
		wizard.fail(err)
		return
	}
	if item.Profile != "" {
		if err := activateWranglerProfile(item.Path, nodePath, item.Profile); err != nil {
			wizard.fail(err)
			return
		}
	}
	args := []string{operation, "--yes"}
	if item.Profile != "" {
		args = append(args, "--profile="+item.Profile)
	}
	result, _, err := runProjectInstaller(item.Path, nodePath, args)
	if err != nil {
		wizard.fail(err)
		return
	}
	wizard.complete("Recuperação pronta", "Defina a nova senha na página aberta. O link expira em 30 minutos.")
	_ = openURL(result.URL)
}

func (wizard *wizardServer) connectProfile(profile string) {
	sourceReady, err := isKranoSource(wizard.target)
	if err != nil {
		wizard.fail(err)
		return
	}
	if !sourceReady || projectVersion(wizard.target) != appVersion {
		if err := installSource(wizard.target, wizard.branch); err != nil {
			wizard.fail(err)
			return
		}
	}
	nodePath, err := ensureNode(wizard.target)
	if err != nil {
		wizard.fail(err)
		return
	}
	wrangler := filepath.Join(wizard.target, "node_modules", "wrangler", "bin", "wrangler.js")
	if _, err := os.Stat(wrangler); err != nil {
		if installErr := installNodeDependencies(wizard.target, nodePath); installErr != nil {
			wizard.fail(errors.New("não foi possível preparar a autenticação Cloudflare"))
			return
		}
	}
	command := exec.Command(nodePath, wrangler, "auth", "create", profile)
	command.Dir = wizard.target
	command.Stdout, command.Stderr, command.Stdin = os.Stdout, os.Stderr, os.Stdin
	if err := command.Run(); err != nil {
		wizard.fail(errors.New("a autorização Cloudflare não foi concluída"))
		return
	}
	if err := activateWranglerProfile(wizard.target, nodePath, profile); err != nil {
		wizard.fail(errors.New("a conta foi autorizada, mas o perfil não pôde ser ativado: " + err.Error()))
		return
	}
	verify := exec.Command(nodePath, wrangler, "--profile", profile, "whoami", "--json")
	verify.Dir = wizard.target
	if output, err := verify.CombinedOutput(); err != nil {
		wizard.fail(fmt.Errorf("a Cloudflare não confirmou o perfil: %s", strings.TrimSpace(string(output))))
		return
	}
	wizard.mu.Lock()
	wizard.registry.upsertProfile(desktopProfile{
		Name:        profile,
		ConnectedAt: time.Now().UTC().Format(time.RFC3339),
	})
	saveErr := saveDesktopRegistry(wizard.registry)
	wizard.state.Profiles = append([]desktopProfile(nil), wizard.registry.Profiles...)
	wizard.mu.Unlock()
	if saveErr != nil {
		wizard.fail(errors.New("a conta foi conectada, mas o perfil não pôde ser salvo localmente"))
		return
	}
	wizard.complete("Conta conectada", "O perfil “"+profile+"” está pronto. Agora crie uma estrutura usando esse perfil.")
}

func (wizard *wizardServer) remove(item desktopInstallation, input operationRequest) {
	nodePath, err := ensureNode(item.Path)
	if err != nil {
		wizard.fail(err)
		return
	}
	if item.Profile != "" {
		if err := activateWranglerProfile(item.Path, nodePath, item.Profile); err != nil {
			wizard.fail(err)
			return
		}
	}
	script := filepath.Join(item.Path, "scripts", "uninstall.mjs")
	command := exec.Command(nodePath, script)
	command.Dir = item.Path
	d1Answer, r2Answer := "n", "n"
	if input.PreserveD1 {
		d1Answer = "s"
	}
	if input.PreserveR2 {
		r2Answer = "s"
	}
	command.Stdin = strings.NewReader(d1Answer + "\n" + r2Answer + "\nREMOVER " + item.Name + "\n")
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		wizard.fail(fmt.Errorf("a remoção Cloudflare falhou: %s", strings.TrimSpace(output.String())))
		return
	}
	if input.RemoveLocal {
		if err := safeRemoveInstallationFolder(item.Path); err != nil {
			wizard.fail(err)
			return
		}
	}
	wizard.mu.Lock()
	wizard.registry.removeInstallation(item.ID)
	_ = saveDesktopRegistry(wizard.registry)
	wizard.state.Installations = append([]desktopInstallation(nil), wizard.registry.Installations...)
	wizard.state.Status = "complete"
	wizard.state.Step = 4
	wizard.state.Title = "Estrutura removida"
	wizard.state.Message = "Os recursos selecionados foram removidos. Dados marcados para preservação continuam na Cloudflare."
	wizard.state.Error = ""
	wizard.started = false
	wizard.mu.Unlock()
}

func (wizard *wizardServer) update(step int, title, message string) {
	wizard.mu.Lock()
	wizard.state.Step, wizard.state.Title, wizard.state.Message = step, title, message
	wizard.mu.Unlock()
}

func (wizard *wizardServer) complete(title, message string) {
	wizard.mu.Lock()
	wizard.state.Status, wizard.state.Step = "complete", 4
	wizard.state.Title, wizard.state.Message, wizard.state.Error = title, message, ""
	wizard.started = false
	wizard.mu.Unlock()
}

func (wizard *wizardServer) fail(err error) {
	wizard.mu.Lock()
	wizard.state.Status = "error"
	wizard.state.Title = "A operação precisa de atenção"
	wizard.state.Message = "Nada fora da estrutura selecionada foi alterado."
	wizard.state.Error = err.Error()
	wizard.started = false
	wizard.mu.Unlock()
}

func (wizard *wizardServer) newTarget(name string) string {
	if _, err := os.Stat(filepath.Join(wizard.target, ".funnel-zero", "installation.json")); errors.Is(err, os.ErrNotExist) {
		return wizard.target
	}
	return filepath.Join(filepath.Dir(wizard.target), "KRANO Estruturas", name)
}

func activateWranglerProfile(project, nodePath, profile string) error {
	if profile == "" {
		return nil
	}
	wrangler := filepath.Join(project, "node_modules", "wrangler", "bin", "wrangler.js")
	if _, err := os.Stat(wrangler); err != nil {
		return errors.New("Wrangler ainda não está preparado")
	}
	command := exec.Command(nodePath, wrangler, "auth", "activate", profile, project)
	command.Dir = project
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}
	return nil
}

func installNodeDependencies(project, nodePath string) error {
	npm := "npm"
	if runtime.GOOS == "windows" {
		npm = filepath.Join(filepath.Dir(nodePath), "npm.cmd")
		if _, err := os.Stat(npm); err != nil {
			found, lookupErr := exec.LookPath("npm.cmd")
			if lookupErr != nil {
				return errors.New("npm não encontrado no ambiente Node.js")
			}
			npm = found
		}
	}
	command := exec.Command(npm, "ci", "--no-audit", "--no-fund")
	command.Dir = project
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	nodeDir := filepath.Dir(nodePath)
	command.Env = append(os.Environ(), "PATH="+nodeDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return command.Run()
}

func safeRemoveInstallationFolder(target string) error {
	clean, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	volume := filepath.VolumeName(clean)
	root := volume + string(filepath.Separator)
	if clean == root || filepath.Dir(clean) == root {
		return errors.New("a pasta local é ampla demais para remoção automática")
	}
	if _, err := readInstallationManifest(clean); err != nil {
		return errors.New("a pasta local não contém um manifesto KRANO válido")
	}
	return os.RemoveAll(clean)
}

func normalizeStructureName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "krano") {
		value = "krano-" + value
	}
	if len(value) > 48 {
		value = strings.TrimRight(value[:48], "-")
	}
	return value
}

func normalizeProfileName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = regexp.MustCompile(`[^a-z0-9_-]+`).ReplaceAllString(value, "-")
	return strings.Trim(value, "-_")
}

func installedPanelURL(target string) string {
	manifest, err := readInstallationManifest(target)
	if err != nil {
		return ""
	}
	return strings.TrimRight(manifest.Worker.URL, "/") + "/login"
}

func safeWebURL(value string) bool {
	return strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://localhost:")
}

func randomTokenForWizard() string {
	value := make([]byte, 24)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
	}
	return hex.EncodeToString(value)
}

func writeWizardJSON(response http.ResponseWriter, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(response).Encode(value)
}

var wizardTemplate = template.Must(template.New("desktop").Parse(`<!doctype html>
<html lang="pt-BR" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KRANO Desktop</title>
<style>
:root{color-scheme:dark;--bg:#0b0c0e;--panel:#121418;--soft:#181b20;--line:#2a2e35;--text:#f4f5f7;--muted:#969ca7;--accent:#e9edf3;--on:#101216;--good:#36c78b;--warn:#f1b64c;--bad:#b6bbc4}
[data-theme=light]{color-scheme:light;--bg:#f3f4f6;--panel:#fff;--soft:#f7f8fa;--line:#dfe2e7;--text:#17191d;--muted:#68707d;--accent:#1d2229;--on:#fff;--good:#39755e;--warn:#80672f;--bad:#575c65}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px Inter,ui-sans-serif,system-ui,sans-serif}.app{min-height:100vh;display:grid;grid-template-columns:240px 1fr}
aside{position:sticky;top:0;height:100vh;padding:24px 18px;border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column}.brand{font-size:18px;font-weight:900;letter-spacing:2px}.brand b{display:inline-grid;place-items:center;width:31px;height:31px;margin-right:9px;border-radius:9px;background:var(--accent);color:var(--on)}
nav{display:grid;gap:6px;margin:36px 0}nav button{justify-content:flex-start;width:100%;background:transparent;border-color:transparent;color:var(--muted)}nav button.active{background:var(--soft);color:var(--text);border-color:var(--line)}.aside-foot{margin-top:auto;color:var(--muted);font-size:12px}
main{padding:34px;max-width:1250px;width:100%;margin:auto}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:26px}h1{font-size:31px;letter-spacing:-1px;margin:0 0 7px}h2{font-size:19px;margin:0 0 5px}h3{margin:0 0 6px}.muted,p{color:var(--muted);line-height:1.55;margin:0}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{border:1px solid var(--line);border-radius:10px;padding:10px 13px;background:var(--soft);color:var(--text);font-weight:720;cursor:pointer}button.primary{background:var(--accent);color:var(--on);border-color:var(--accent)}button.danger{color:var(--bad);border-color:var(--line)}button:disabled{opacity:.5;cursor:wait}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.card{grid-column:span 12;padding:20px;border:1px solid var(--line);border-radius:15px;background:var(--panel)}.half{grid-column:span 6}.third{grid-column:span 4}
.hero{display:grid;grid-template-columns:1.4fr .8fr;gap:20px;align-items:center}.hero h2{font-size:24px}.pill{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--line);border-radius:99px;color:var(--muted);font-size:11px}.dot{width:7px;height:7px;border-radius:50%;background:var(--good)}
.structures{display:grid;gap:10px;margin-top:16px}.structure{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;padding:15px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}.meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:11px;margin-top:8px}
.usage{display:grid;gap:12px}.meter-head{display:flex;justify-content:space-between}.meter{height:7px;background:var(--soft);border-radius:9px;overflow:hidden}.meter i{display:block;height:100%;background:var(--accent);width:0}.note{padding:11px;border-left:3px solid var(--warn);background:var(--soft);color:var(--muted);border-radius:5px}
.view{display:none}.view.active{display:block}.steps{display:grid;gap:11px;margin-top:16px}.step{display:grid;grid-template-columns:27px 1fr;gap:10px}.step b{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--soft);border:1px solid var(--line)}
.status{display:none;margin-bottom:16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.status.show{display:block}.status.error{border-color:var(--bad)}.progress{height:4px;background:var(--soft);margin-top:10px}.progress i{display:block;height:100%;background:var(--accent);transition:width .3s}
dialog{width:min(520px,calc(100% - 30px));border:1px solid var(--line);border-radius:16px;padding:0;background:var(--panel);color:var(--text)}dialog::backdrop{background:#0009}.modal{padding:22px}.modal footer{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}
label{display:block;margin:14px 0 6px;font-size:12px;font-weight:700}input,select{width:100%;padding:11px;border:1px solid var(--line);border-radius:9px;background:var(--soft);color:var(--text)}.check{display:flex;gap:9px;align-items:center}.check input{width:auto}
.theme-options{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.theme-options button{padding:15px;text-align:left}.theme-options button.active{background:var(--accent);color:var(--on);border-color:var(--accent)}.theme-options small{display:block;margin-top:4px;color:var(--muted)}.theme-options button.active small{color:inherit;opacity:.72}
@media(max-width:850px){.app{grid-template-columns:1fr}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}nav{display:flex;margin:18px 0 0;overflow:auto}.aside-foot{display:none}main{padding:20px}.half,.third{grid-column:span 12}.hero{grid-template-columns:1fr}.structure{grid-template-columns:1fr}}
</style></head><body><div class="app">
<aside><div class="brand"><b>K</b>KRANO</div><nav>
<button class="active" data-view="home">Visão geral</button><button data-view="structures">Estruturas</button><button data-view="accounts">Contas Cloudflare</button><button data-view="vault">Cofre local</button><button data-view="settings">Configurações</button>
</nav><div class="aside-foot">KRANO Desktop {{.Version}}<br>Seus dados ficam na sua Cloudflare.<br><button id="exit" style="margin-top:12px">Encerrar app</button></div></aside>
<main><div id="status" class="status"><div class="row" style="justify-content:space-between"><strong id="status-title"></strong><span id="status-step"></span></div><p id="status-message"></p><div id="status-error"></div><div class="progress"><i id="status-progress"></i></div></div>
<section class="view active" id="home"><div class="top"><div><h1>Olá, vamos construir.</h1><p>Uma central local para criar, manter e remover toda a sua estrutura KRANO.</p></div></div>
<div class="grid"><article class="card hero"><div><span class="pill"><i class="dot"></i>APP LOCAL E PERMANENTE</span><h2 style="margin-top:14px">Teste ofertas sem custo inicial de ferramenta.</h2><p>Site, funil, vídeo, tracking e dashboard ficam na sua própria conta Cloudflare. Você mantém o controle e acompanha os limites gratuitos.</p></div><div class="row"><button class="primary" data-new>Nova estrutura</button><button data-guide>Ver tutorial</button></div></article>
<article class="card half"><h2>Suas estruturas</h2><p id="summary">Carregando...</p><div id="home-structures" class="structures"></div></article>
<article class="card half"><h2>Faixa gratuita Cloudflare</h2><div class="usage" style="margin-top:15px"><div><div class="meter-head"><span>Workers</span><b>100 mil requisições/dia</b></div><div class="meter"><i></i></div></div><div><div class="meter-head"><span>R2 Standard</span><b>10 GB-mês</b></div><div class="meter"><i></i></div></div><div><div class="meter-head"><span>D1</span><b>5 GB total</b></div><div class="meter"><i></i></div></div><p class="note">O app mostra os limites do plano; o consumo real fica no painel Cloudflare até a API de métricas ser autorizada.</p></div></article></div></section>
<section class="view" id="structures"><div class="top"><div><h1>Estruturas</h1><p>Instale, atualize, abra, recupere ou remova cada ambiente.</p></div><button class="primary" data-new>Nova estrutura</button></div><div class="card"><div id="all-structures" class="structures"></div></div></section>
<section class="view" id="accounts"><div class="top"><div><h1>Contas Cloudflare</h1><p>Perfis OAuth separados evitam publicar uma estrutura na conta errada.</p></div><button class="primary" id="connect">Conectar conta</button></div><div class="grid"><article class="card half"><h2>Como funciona</h2><div class="steps"><div class="step"><b>1</b><div><strong>Dê um apelido</strong><p>Ex.: pessoal, cliente-a ou testes.</p></div></div><div class="step"><b>2</b><div><strong>Autorize no navegador</strong><p>A tela é oficial da Cloudflare; a KRANO não guarda sua senha.</p></div></div><div class="step"><b>3</b><div><strong>Escolha ao instalar</strong><p>Cada pasta fica vinculada ao perfil correto.</p></div></div></div></article><article class="card half"><h2>Contas conectadas</h2><div id="profiles" class="structures"></div></article></div></section>
<section class="view" id="vault"><div class="top"><div><h1>Cofre local</h1><p>Guarde voluntariamente o login do painel para recuperar quando esquecer.</p></div></div><div class="grid"><article class="card"><h2>Protegido pelo Windows</h2><p>Login, senha e recuperação são criptografados para a sua conta atual do Windows. Nada é enviado à KRANO, Cloudflare ou Meta.</p><div class="note" style="margin-top:14px">Quem tiver acesso desbloqueado à sua conta do Windows poderá revelar estas credenciais. Use também PIN ou senha no Windows.</div></article><article class="card"><div id="vault-list" class="structures"></div></article></div></section>
<section class="view" id="settings"><div class="top"><div><h1>Configurações</h1><p>Aparência e ajuda opcional em um só lugar.</p></div></div><div class="grid"><article class="card half"><h2>Aparência</h2><p>Escolha o tema. A preferência fica salva somente neste computador.</p><div class="theme-options"><button id="theme-dark" type="button"><strong>Escuro</strong><small>Menos brilho</small></button><button id="theme-light" type="button"><strong>Claro</strong><small>Mais contraste</small></button></div></article><article class="card half"><h2>Ajuda para iniciantes</h2><p>As explicações são opcionais e podem ser ocultadas quando você já conhecer o fluxo.</p><label class="check"><input id="tutorial-toggle" type="checkbox"> Mostrar tutoriais e dicas</label></article><article class="card third tutorial-card"><h2>Primeira estrutura</h2><p>Conecte a Cloudflare, crie um nome e aguarde o app publicar Worker, D1 e R2.</p></article><article class="card third tutorial-card"><h2>Hospedagem de vídeo</h2><p>Os arquivos vão para o R2 Standard. O player otimizado é administrado no painel KRANO.</p></article><article class="card third tutorial-card"><h2>Meta Ads</h2><p>Depois do primeiro acesso, conecte a Meta dentro do painel para campanhas, pixels e tracking.</p></article><article class="card tutorial-card"><h2>Custos e cartão</h2><p>A KRANO trabalha em modo FREE_ONLY. O R2 tem franquia gratuita, mas a Cloudflare pode solicitar uma forma de pagamento ao ativar o produto. O app não recebe nem armazena dados de cartão.</p></article></div></section>
</main></div>
<dialog id="new-dialog"><form class="modal" method="dialog"><h2>Nova estrutura</h2><p>Use um nome curto e selecione uma conta Cloudflare já conectada.</p><label>Nome da estrutura</label><input id="new-name" placeholder="minha-oferta"><label>Conta Cloudflare</label><select id="new-profile"></select><footer><button value="cancel">Cancelar</button><button class="primary" id="install-new" value="default">Instalar estrutura</button></footer></form></dialog>
<dialog id="connect-dialog"><form class="modal" method="dialog"><h2>Conectar Cloudflare</h2><p>Será aberta a autorização oficial. Você pode manter vários logins organizados.</p><label>Apelido do perfil</label><input id="profile-name" placeholder="pessoal"><footer><button value="cancel">Cancelar</button><button class="primary" id="connect-go" value="default">Abrir autorização</button></footer></form></dialog>
<dialog id="remove-dialog"><form class="modal" method="dialog"><h2>Remover estrutura</h2><p>Esta ação apaga recursos na Cloudflare. Faça backup antes se precisar dos dados.</p><label class="check"><input id="preserve-d1" type="checkbox" checked> Preservar banco D1</label><label class="check"><input id="preserve-r2" type="checkbox" checked> Preservar vídeos no R2</label><label class="check"><input id="remove-local" type="checkbox"> Apagar também a pasta local</label><label id="confirm-label">Confirmação</label><input id="remove-confirm"><footer><button value="cancel">Cancelar</button><button class="danger" id="remove-go" value="default">Remover</button></footer></form></dialog>
<dialog id="vault-dialog"><form class="modal" method="dialog"><h2>Credencial do painel</h2><p>Preencha apenas se quiser usar o cofre local.</p><label>Login ou e-mail</label><input id="vault-login" autocomplete="username"><label>Senha</label><div class="row" style="flex-wrap:nowrap"><input id="vault-password" type="password" autocomplete="current-password"><button id="vault-reveal" type="button">Mostrar</button><button id="vault-copy" type="button">Copiar</button></div><label>Recuperação ou observação opcional</label><input id="vault-recovery"><footer><button id="vault-delete" class="danger" type="button" hidden>Apagar</button><button value="cancel">Cancelar</button><button class="primary" id="vault-save" value="default">Salvar no Windows</button></footer></form></dialog>
<script>
const token=new URLSearchParams(location.search).get("token")||"",headers={"X-Krano-Token":token,"Content-Type":"application/json"};let current=null,removeId="",vaultId="";
const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function applyTheme(theme){const next=theme==="light"?"light":"dark";document.documentElement.dataset.theme=next;try{localStorage.setItem("krano-desktop-theme",next)}catch{};$("#theme-dark")?.classList.toggle("active",next==="dark");$("#theme-light")?.classList.toggle("active",next==="light")}
let savedTheme="";try{savedTheme=localStorage.getItem("krano-desktop-theme")||""}catch{};applyTheme(savedTheme||((window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark"));
async function api(path,body={}){const r=await fetch(path,{method:"POST",headers,body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json()}
function card(i){const installed=i.status==="installed";return '<div class="structure"><div><h3>'+esc(i.name)+'</h3><p>'+esc(installed?i.workerUrl:"Ainda não instalada")+'</p><div class="meta"><span>'+esc(i.profile||"perfil padrão")+'</span><span>'+esc(i.version||"nova")+'</span><span>'+esc(i.path)+'</span></div></div><div class="row">'+(installed?'<button data-open="'+esc(i.id)+'">Abrir</button><button data-update="'+esc(i.id)+'">Atualizar</button><button data-recover="'+esc(i.id)+'">Recuperar</button><button class="danger" data-remove="'+esc(i.id)+'">Remover</button>':'<button class="primary" data-update="'+esc(i.id)+'">Instalar</button>')+'</div></div>'}
function bind(){document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>api("/api/open",{id:b.dataset.open}));document.querySelectorAll("[data-update]").forEach(b=>b.onclick=()=>api("/api/install",{id:b.dataset.update}).then(poll).catch(showError));document.querySelectorAll("[data-recover]").forEach(b=>b.onclick=()=>api("/api/recover",{id:b.dataset.recover}).then(poll).catch(showError));document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{removeId=b.dataset.remove;const i=current.installations.find(x=>x.id===removeId);$("#confirm-label").textContent="Digite REMOVER "+i.name;$("#remove-confirm").value="";$("#remove-dialog").showModal()})}
function vaultCard(i){const saved=(current.vault||[]).find(v=>v.installationId===i.id);return '<div class="structure"><div><h3>'+esc(i.name)+'</h3><p>'+(saved?'Credencial protegida · atualizada '+esc(new Date(saved.updatedAt).toLocaleString("pt-BR")):'Nenhuma credencial salva')+'</p></div><div class="row"><button data-vault="'+esc(i.id)+'">'+(saved?'Abrir cofre':'Adicionar login')+'</button></div></div>'}
function render(s){current=s;const html=s.installations.length?s.installations.map(card).join(""):'<p>Nenhuma estrutura ainda. Crie a primeira em poucos cliques.</p>';$("#home-structures").innerHTML=html;$("#all-structures").innerHTML=html;$("#summary").textContent=s.installations.filter(i=>i.status==="installed").length+" estrutura(s) instalada(s)";$("#tutorial-toggle").checked=s.tutorialEnabled;document.querySelectorAll(".tutorial-card").forEach(x=>x.hidden=!s.tutorialEnabled);const profiles=s.profiles||[];$("#profiles").innerHTML=profiles.length?profiles.map(p=>'<div class="structure"><div><strong>'+esc(p.name)+'</strong><p>Conta autorizada no navegador</p></div><span class="pill"><i class="dot"></i>CONECTADA</span></div>').join(""):'<p>Nenhuma conta conectada. Clique em “Conectar conta”.</p>';$("#new-profile").innerHTML=profiles.length?profiles.map(p=>'<option value="'+esc(p.name)+'">'+esc(p.name)+'</option>').join(""):'<option value="">Conecte uma conta primeiro</option>';$("#install-new").disabled=!profiles.length;$("#vault-list").innerHTML=s.installations.length?s.installations.map(vaultCard).join(""):'<p>Crie uma estrutura antes de adicionar credenciais.</p>';const box=$("#status");box.classList.toggle("show",s.status==="running"||s.status==="error"||s.status==="complete");box.classList.toggle("error",s.status==="error");$("#status-title").textContent=s.title;$("#status-message").textContent=s.message;$("#status-step").textContent=s.status==="running"?"Etapa "+s.step+" de 4":"";$("#status-error").textContent=s.error||"";$("#status-progress").style.width=(s.step*25)+"%";bind();document.querySelectorAll("[data-vault]").forEach(b=>b.onclick=()=>openVault(b.dataset.vault));applyTheme(document.documentElement.dataset.theme)}
async function openVault(id){vaultId=id;$("#vault-login").value="";$("#vault-password").value="";$("#vault-recovery").value="";$("#vault-password").type="password";$("#vault-reveal").textContent="Mostrar";const saved=(current.vault||[]).some(v=>v.installationId===id);$("#vault-delete").hidden=!saved;if(saved){const secret=await api("/api/vault/read",{id});$("#vault-login").value=secret.login;$("#vault-password").value=secret.password;$("#vault-recovery").value=secret.recovery||""}$("#vault-dialog").showModal()}
async function state(){const r=await fetch("/api/state?token="+encodeURIComponent(token),{headers});render(await r.json())}
function poll(){state().then(()=>{if(current.status==="running")setTimeout(poll,1200)})}function showError(e){alert(e.message)}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button,.view").forEach(x=>x.classList.remove("active"));b.classList.add("active");$("#"+b.dataset.view).classList.add("active")});document.querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>{if(!(current?.profiles||[]).length){document.querySelector('[data-view="accounts"]').click();$("#connect-dialog").showModal();return}$("#new-dialog").showModal()});document.querySelectorAll("[data-guide]").forEach(b=>b.onclick=()=>document.querySelector('[data-view="settings"]').click());
$("#connect").onclick=()=>$("#connect-dialog").showModal();$("#install-new").onclick=e=>{e.preventDefault();api("/api/install",{name:$("#new-name").value,profile:$("#new-profile").value}).then(()=>{$("#new-dialog").close();poll()}).catch(showError)};$("#connect-go").onclick=e=>{e.preventDefault();api("/api/connect",{profile:$("#profile-name").value}).then(()=>{$("#connect-dialog").close();poll()}).catch(showError)};$("#remove-go").onclick=e=>{e.preventDefault();api("/api/remove",{id:removeId,confirmation:$("#remove-confirm").value,preserveD1:$("#preserve-d1").checked,preserveR2:$("#preserve-r2").checked,removeLocal:$("#remove-local").checked}).then(()=>{$("#remove-dialog").close();poll()}).catch(showError)};$("#tutorial-toggle").onchange=e=>api("/api/tutorial",{enabled:e.target.checked}).catch(showError);
$("#vault-reveal").onclick=()=>{const show=$("#vault-password").type==="password";$("#vault-password").type=show?"text":"password";$("#vault-reveal").textContent=show?"Ocultar":"Mostrar"};$("#vault-copy").onclick=()=>navigator.clipboard.writeText($("#vault-password").value).then(()=>{$("#vault-copy").textContent="Copiada";setTimeout(()=>$("#vault-copy").textContent="Copiar",1200)}).catch(showError);$("#vault-save").onclick=e=>{e.preventDefault();api("/api/vault/save",{id:vaultId,login:$("#vault-login").value,password:$("#vault-password").value,recovery:$("#vault-recovery").value}).then(()=>{$("#vault-dialog").close();state()}).catch(showError)};$("#vault-delete").onclick=()=>{if(!confirm("Apagar esta credencial do cofre local?"))return;api("/api/vault/delete",{id:vaultId,confirmation:"APAGAR CREDENCIAL"}).then(()=>{$("#vault-dialog").close();state()}).catch(showError)};
$("#theme-dark").onclick=()=>applyTheme("dark");$("#theme-light").onclick=()=>applyTheme("light");state();
$("#exit").onclick=()=>api("/api/exit").then(()=>{document.body.innerHTML='<main style="padding:40px"><h1>KRANO encerrada</h1><p>Você pode fechar esta aba.</p></main>'}).catch(showError);
</script></body></html>`))
