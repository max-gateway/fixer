# Verificação semanal das tabelas de regra tributária contra o texto oficial (Planalto, Confaz, Câmara).
# Registrada no Agendador de Tarefas do Windows por scripts/register-weekly.ps1. Grava o relatório em
# %LOCALAPPDATA%\fixer\tax-rules-verify\ e avisa com uma notificação do Windows quando alguma tabela diverge da lei.
param([string]$Node = 'node')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$pkg = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA 'fixer\tax-rules-verify'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$log = Join-Path $logDir "$stamp.txt"

Set-Location $pkg
if (-not (Test-Path (Join-Path $pkg 'dist\src\verify\run.js'))) { & $Node (Join-Path $pkg '..\..\node_modules\typescript\bin\tsc') -p tsconfig.build.json }
$report = & $Node scripts/verify-sources.mjs 2>&1 | Out-String
$code = $LASTEXITCODE
"Verificação de $stamp, saída $code`n`n$report" | Set-Content -Path $log -Encoding utf8
Copy-Item $log (Join-Path $logDir 'ultimo.txt') -Force
# guarda só os 20 relatórios mais recentes
Get-ChildItem $logDir -Filter '2*.txt' | Sort-Object Name -Descending | Select-Object -Skip 20 | Remove-Item -Force

function Show-Toast([string]$title, [string]$text) {
  try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$([Security.SecurityElement]::Escape($title))</text><text>$([Security.SecurityElement]::Escape($text))</text></binding></visual></toast>")
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Fixer').Show([Windows.UI.Notifications.ToastNotification]::new($xml))
  } catch { }
}

if ($code -eq 1) { Show-Toast 'Fixer: tabela tributária divergente' "Alguma tabela do tax-rules não bate mais com o texto oficial. Veja $log" }
elseif ($code -ge 2) { Show-Toast 'Fixer: verificação tributária não rodou' "Não deu para baixar os textos oficiais. Veja $log" }
elseif ($report -match 'AVISO') { Show-Toast 'Fixer: aviso nas tabelas tributárias' "Há um aviso (por exemplo, alíquota de referência do Senado). Veja $log" }
exit $code
