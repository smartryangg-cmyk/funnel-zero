# Instaladores KRANO

Os dois arquivos prontos ficam nesta pasta:

- `KRANO-Installer-Windows-x64.exe`
- `krano-installer-linux-x64`
- `SHA256SUMS.txt`

O executável Windows abre o KRANO Desktop: um app local persistente para conectar
perfis OAuth Cloudflare, instalar várias estruturas, abrir o painel, atualizar,
recuperar acesso e remover recursos com confirmação explícita. Ele prepara uma
versão portátil e verificada do Node.js quando necessário. Git, Node, Wrangler e
Docker não precisam ser instalados manualmente.

O **Cofre local** opcional protege logins do painel com a DPAPI do Windows.
Credenciais não são gravadas em texto aberto nem enviadas para serviços externos.

## Compilar

Com Go 1.24 ou superior:

```powershell
go build -trimpath -ldflags="-s -w" -o installers/KRANO-Installer-Windows-x64.exe ./installer
$env:GOOS="linux"
$env:GOARCH="amd64"
go build -trimpath -ldflags="-s -w" -o installers/krano-installer-linux-x64 ./installer
```

Os binários usam somente a biblioteca padrão do Go.
