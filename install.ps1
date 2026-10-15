# Instala o mod session-hud no Claude Code (escopo user: fica permanente).
# Uso:  irm https://raw.githubusercontent.com/HenriqueRicieri/session-hud/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$repo = 'HenriqueRicieri/session-hud'

$minVersion = [version]'2.1.295'  # versao em que o mod foi testado; versoes antigas nao carregam hooks de funcao

function Get-ClaudeVersion($exe) {
    $out = & $exe --version 2>$null | Select-Object -First 1
    if ($out -match '(\d+\.\d+\.\d+)') { [version]$Matches[1] } else { [version]'0.0.0' }
}

# 1. Acha o claude: o do PATH e o que vem dentro do app desktop; usa o mais novo
$candidates = @()
$onPath = (Get-Command claude -ErrorAction SilentlyContinue).Source
if ($onPath) { $candidates += $onPath }
$candidates += Get-ChildItem "$env:APPDATA\Claude\claude-code\*\*\claude.exe" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
if (-not $candidates) {
    Write-Host 'Claude Code nao encontrado. Instale o Claude Code (ou o app desktop) e rode de novo.' -ForegroundColor Red
    return
}
$found = $candidates | ForEach-Object { [pscustomobject]@{ Path = $_; Version = Get-ClaudeVersion $_ } } |
    Sort-Object Version -Descending
$claude = $found[0].Path
Write-Host "Usando $claude ($($found[0].Version))"
if ($found[0].Version -lt $minVersion) {
    Write-Host "Aviso: Claude Code $($found[0].Version) e antigo; o mod precisa de $minVersion ou mais novo. Rode 'claude update' ou atualize o app." -ForegroundColor Yellow
}
$pathVersion = ($found | Where-Object Path -eq $onPath | Select-Object -First 1).Version
if ($onPath -and $pathVersion -lt $minVersion) {
    Write-Host "Aviso: o 'claude' do terminal ($pathVersion) e antigo e nao carrega o mod; no app desktop funciona. Para o terminal: claude update" -ForegroundColor Yellow
}

# 2. Marketplace + plugin
& $claude plugin marketplace add $repo
if ($LASTEXITCODE -ne 0) { Write-Host 'Falhou ao adicionar o marketplace.' -ForegroundColor Red; return }
& $claude plugin install session-hud@session-hud --scope user
if ($LASTEXITCODE -ne 0) { Write-Host 'Falhou ao instalar o plugin.' -ForegroundColor Red; return }

# 3. Liga os hooks de funcao (early access) no settings.json do usuario
$dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$file = Join-Path $dir 'settings.json'
$settings = if (Test-Path $file) { Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
if (-not $settings.PSObject.Properties['env']) { $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
if ($settings.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS -ne '1') {
    if (Test-Path $file) { Copy-Item $file "$file.bak" -Force }
    $settings.env | Add-Member -NotePropertyName CLAUDE_CODE_ENABLE_FUNCTION_HOOKS -NotePropertyValue '1' -Force
    New-Item -ItemType Directory -Force $dir | Out-Null
    [IO.File]::WriteAllText($file, ($settings | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding $false))
    Write-Host "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 adicionado em $file (backup: settings.json.bak)"
}

Write-Host ''
Write-Host 'Pronto! Abra uma sessao nova do Claude Code (terminal ou app) para ver a faixa.' -ForegroundColor Green
Write-Host '/hud mostra/oculta; /hud detalhes abre o painel.'
