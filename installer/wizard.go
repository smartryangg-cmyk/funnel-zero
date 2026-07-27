package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type wizardState struct {
	Status      string `json:"status"`
	Step        int    `json:"step"`
	Title       string `json:"title"`
	Message     string `json:"message"`
	PanelURL    string `json:"panelUrl,omitempty"`
	Installed   bool   `json:"installed"`
	Error       string `json:"error,omitempty"`
	ProjectPath string `json:"projectPath"`
}

type savedInstallation struct {
	Worker struct {
		URL string `json:"url"`
	} `json:"worker"`
}

type wizardServer struct {
	mu       sync.RWMutex
	state    wizardState
	token    string
	target   string
	branch   string
	args     []string
	started  bool
	shutdown func()
}

func runWizard(target, branch string, args []string) error {
	panelURL := installedPanelURL(target)
	initial := wizardState{
		Status:      "ready",
		Step:        0,
		Title:       "Tudo pronto para começar",
		Message:     "A instalação acontece em poucos passos e usa as páginas oficiais da Cloudflare e da Meta.",
		PanelURL:    panelURL,
		Installed:   panelURL != "",
		ProjectPath: target,
	}
	if panelURL != "" {
		initial.Title = "Sua KRANO já está instalada"
		initial.Message = "Abra o painel ou execute novamente para aplicar atualizações."
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	wizard := &wizardServer{
		state:  initial,
		token:  randomTokenForWizard(),
		target: target,
		branch: branch,
		args:   append([]string(nil), args...),
	}
	wizard.shutdown = func() {
		_ = server.Close()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", wizard.page)
	mux.HandleFunc("/api/state", wizard.readState)
	mux.HandleFunc("/api/start", wizard.start)
	mux.HandleFunc("/api/open", wizard.openPanel)
	server.Handler = mux

	localURL := fmt.Sprintf("http://%s/?token=%s", listener.Addr().String(), wizard.token)
	if err := openURL(localURL); err != nil {
		_ = listener.Close()
		return err
	}
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
	_ = wizardTemplate.Execute(response, map[string]string{"Token": wizard.token})
}

func (wizard *wizardServer) readState(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet || !wizard.authorized(request) {
		http.NotFound(response, request)
		return
	}
	wizard.mu.RLock()
	state := wizard.state
	wizard.mu.RUnlock()
	writeWizardJSON(response, state)
}

func (wizard *wizardServer) start(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || !wizard.authorized(request) {
		http.NotFound(response, request)
		return
	}
	wizard.mu.Lock()
	if wizard.started {
		wizard.mu.Unlock()
		writeWizardJSON(response, map[string]bool{"ok": true})
		return
	}
	wizard.started = true
	wizard.state = wizardState{
		Status: "running", Step: 1, Title: "Preparando a KRANO",
		Message:     "Baixando o projeto oficial e verificando o computador.",
		ProjectPath: wizard.target,
	}
	wizard.mu.Unlock()
	go wizard.install()
	writeWizardJSON(response, map[string]bool{"ok": true})
}

func (wizard *wizardServer) openPanel(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || !wizard.authorized(request) {
		http.NotFound(response, request)
		return
	}
	wizard.mu.RLock()
	panelURL := wizard.state.PanelURL
	wizard.mu.RUnlock()
	if panelURL == "" {
		http.Error(response, "Painel ainda indisponível.", http.StatusConflict)
		return
	}
	if err := openURL(panelURL); err != nil {
		http.Error(response, "Não foi possível abrir o navegador.", http.StatusInternalServerError)
		return
	}
	writeWizardJSON(response, map[string]bool{"ok": true})
	go func() {
		time.Sleep(2 * time.Second)
		wizard.shutdown()
	}()
}

func (wizard *wizardServer) install() {
	update := func(step int, title, message string) {
		wizard.mu.Lock()
		wizard.state.Step = step
		wizard.state.Title = title
		wizard.state.Message = message
		wizard.mu.Unlock()
	}
	fail := func(err error) {
		wizard.mu.Lock()
		wizard.state.Status = "error"
		wizard.state.Title = "A instalação precisa de atenção"
		wizard.state.Message = "Nada fora da pasta KRANO foi removido. Revise a mensagem e tente novamente."
		wizard.state.Error = err.Error()
		wizard.started = false
		wizard.mu.Unlock()
	}

	sourceReady, err := isKranoSource(wizard.target)
	if err != nil {
		fail(err)
		return
	}
	if !sourceReady || projectVersion(wizard.target) != appVersion {
		if err := installSource(wizard.target, wizard.branch); err != nil {
			fail(err)
			return
		}
	}

	update(2, "Verificando o computador", "Preparando automaticamente o ambiente necessário.")
	nodePath, err := ensureNode(wizard.target)
	if err != nil {
		fail(err)
		return
	}

	update(3, "Conecte sua Cloudflare", "Uma página oficial pode abrir. Entre na conta e autorize a infraestrutura da KRANO.")
	installerArgs := append([]string(nil), wizard.args...)
	if !contains(installerArgs, "--yes") {
		installerArgs = append(installerArgs, "--yes")
	}
	result, _, err := runProjectInstaller(wizard.target, nodePath, installerArgs)
	if err != nil {
		fail(err)
		return
	}
	if !result.OK || result.URL == "" {
		fail(errors.New("a instalação terminou sem devolver o endereço do painel"))
		return
	}

	update(4, "Instalação concluída", "O painel será aberto. Termine seu cadastro e conecte o Facebook em Meta Ads.")
	wizard.mu.Lock()
	wizard.state.Status = "complete"
	wizard.state.Installed = true
	wizard.state.PanelURL = result.URL
	wizard.state.Error = ""
	wizard.mu.Unlock()
	if err := openURL(result.URL); err != nil {
		wizard.mu.Lock()
		wizard.state.Message = "Use o botão Abrir painel para continuar no navegador."
		wizard.mu.Unlock()
	}
	go func() {
		time.Sleep(20 * time.Second)
		wizard.shutdown()
	}()
}

func installedPanelURL(target string) string {
	raw, err := os.ReadFile(filepath.Join(target, ".funnel-zero", "installation.json"))
	if err != nil {
		return ""
	}
	var installation savedInstallation
	if json.Unmarshal(raw, &installation) != nil || !safeWebURL(installation.Worker.URL) {
		return ""
	}
	return strings.TrimRight(installation.Worker.URL, "/") + "/login"
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

var wizardTemplate = template.Must(template.New("wizard").Parse(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instalar KRANO</title>
<style>
:root{color-scheme:light dark;font:15px Inter,ui-sans-serif,system-ui,sans-serif;background:#0d0e10;color:#f5f5f5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0d0e10}.shell{min-height:100vh;display:grid;grid-template-columns:340px 1fr}
aside{padding:38px;background:#151619;border-right:1px solid #2a2c31;display:flex;flex-direction:column}.brand{font-size:20px;font-weight:850;letter-spacing:2px}
.brand span{display:inline-grid;place-items:center;width:32px;height:32px;margin-right:10px;border-radius:9px;background:#f4f4f4;color:#111}
.steps{display:grid;gap:17px;margin:auto 0}.step{display:grid;grid-template-columns:30px 1fr;gap:11px;color:#777b83}.step i{display:grid;place-items:center;width:28px;height:28px;border:1px solid #34373d;border-radius:50%;font-style:normal;font-size:11px}.step strong,.step small{display:block}.step small{margin-top:3px;font-size:11px}.step.active{color:#fff}.step.active i{background:#fff;color:#111;border-color:#fff}
aside footer{color:#777b83;font-size:11px;line-height:1.6}main{display:grid;place-items:center;padding:40px}.card{width:min(720px,100%);padding:38px;border:1px solid #2b2e34;border-radius:18px;background:#121316}
.eyebrow{color:#969aa3;font-size:11px;font-weight:750;letter-spacing:1.4px}h1{font-size:36px;letter-spacing:-1.5px;margin:12px 0}p{color:#9b9fa8;line-height:1.65}.connections{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:25px 0}
.connection{padding:16px;border:1px solid #2b2e34;border-radius:12px;background:#181a1e}.connection strong,.connection small{display:block}.connection small{color:#858992;margin-top:5px}
.progress{height:6px;margin:24px 0;background:#24262b;border-radius:20px;overflow:hidden}.progress i{display:block;height:100%;width:0;background:#fff;transition:width .3s}
.actions{display:flex;gap:10px;margin-top:26px}button{border:1px solid #34373d;border-radius:10px;padding:12px 17px;background:#202226;color:#fff;font-weight:750;cursor:pointer}
button.primary{background:#f4f4f4;color:#111;border-color:#f4f4f4}button:disabled{opacity:.5;cursor:not-allowed}.error{padding:13px;border:1px solid #55464a;border-radius:10px;color:#d9c6c9;background:#21191b}
code{display:block;margin-top:18px;padding:10px;border-radius:8px;color:#92969e;background:#0d0e10;font-size:11px;overflow-wrap:anywhere}
@media(max-width:760px){.shell{grid-template-columns:1fr}aside{display:none}main{padding:18px}.card{padding:25px}.connections{grid-template-columns:1fr}h1{font-size:29px}}
</style>
</head>
<body><div class="shell"><aside><div class="brand"><span>K</span>KRANO</div><div class="steps">
<div class="step active" data-step="1"><i>1</i><div><strong>Preparar</strong><small>Verificação automática</small></div></div>
<div class="step" data-step="2"><i>2</i><div><strong>Cloudflare</strong><small>Hospedagem e dados</small></div></div>
<div class="step" data-step="3"><i>3</i><div><strong>Publicar</strong><small>Criação do painel</small></div></div>
<div class="step" data-step="4"><i>4</i><div><strong>Facebook</strong><small>Conexão dentro do painel</small></div></div>
</div><footer>Projeto aberto e instalado na sua própria conta Cloudflare.<br>Seus dados continuam sob seu controle.</footer></aside>
<main><section class="card"><span class="eyebrow">ASSISTENTE DE INSTALAÇÃO</span><h1 id="title">Carregando…</h1><p id="message"></p>
<div class="connections"><div class="connection"><strong>Cloudflare</strong><small>Hospedagem, banco, vídeos e domínios</small></div><div class="connection"><strong>Meta</strong><small>Anúncios, campanhas, pixels e resultados</small></div></div>
<div class="progress"><i id="progress"></i></div><div id="error"></div><code id="path"></code>
<div class="actions"><button class="primary" id="start">Instalar KRANO</button><button id="open" hidden>Abrir painel</button></div>
</section></main></div>
<script>
const token={{printf "%q" .Token}},headers={"X-Krano-Token":token},title=document.querySelector("#title"),message=document.querySelector("#message"),progress=document.querySelector("#progress"),error=document.querySelector("#error"),start=document.querySelector("#start"),open=document.querySelector("#open"),path=document.querySelector("#path");
async function state(){const r=await fetch("/api/state?token="+encodeURIComponent(token),{headers});const s=await r.json();title.textContent=s.title;message.textContent=s.message;path.textContent="Pasta local: "+s.projectPath;progress.style.width=(s.step*25)+"%";error.innerHTML=s.error?'<p class="error"></p>':"";if(s.error)error.firstChild.textContent=s.error;start.hidden=s.status==="running"||s.status==="complete";start.disabled=s.status==="running";start.textContent=s.installed?"Atualizar instalação":"Instalar KRANO";open.hidden=!s.panelUrl;document.querySelectorAll(".step").forEach((el)=>el.classList.toggle("active",Number(el.dataset.step)<=Math.max(1,s.step)));if(s.status==="running")setTimeout(state,1200)}
start.onclick=async()=>{start.disabled=true;await fetch("/api/start",{method:"POST",headers});state()};open.onclick=async()=>{open.disabled=true;await fetch("/api/open",{method:"POST",headers})};state();
</script></body></html>`))
