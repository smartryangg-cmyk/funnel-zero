# Instaladores KRANO

Os dois arquivos prontos ficam nesta pasta:

- `KRANO-Installer-Windows-x64.exe`
- `krano-installer-linux-x64`
- `SHA256SUMS.txt`

Eles baixam o projeto oficial, preparam uma versão portátil e verificada do Node.js quando necessário e iniciam a autorização oficial da Cloudflare. Git, Node, Wrangler e Docker não precisam ser instalados manualmente.

## Compilar

Com Go 1.24 ou superior:

```powershell
go build -trimpath -ldflags="-s -w" -o installers/KRANO-Installer-Windows-x64.exe ./installer
$env:GOOS="linux"
$env:GOARCH="amd64"
go build -trimpath -ldflags="-s -w" -o installers/krano-installer-linux-x64 ./installer
```

Os binários usam somente a biblioteca padrão do Go.
