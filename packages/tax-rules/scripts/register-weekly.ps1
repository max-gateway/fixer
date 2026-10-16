# Registra (ou atualiza) a tarefa semanal de verificação das tabelas tributárias no Agendador de Tarefas do Windows.
# Uso: powershell -File scripts\register-weekly.ps1 [-Remove]
param([switch]$Remove)

$name = 'Fixer - verificar tabelas tributarias'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa removida: $name"
  return
}

$script = Join-Path $PSScriptRoot 'verify-weekly.ps1'
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Node `"$node`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9:00
# Se o computador estava desligado às 9h de segunda, roda assim que ligar; só com rede; não segura a bateria.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Confere as tabelas de packages/tax-rules com o texto oficial (Planalto, Confaz, Camara) e avisa se alguma divergir.' -Force | Out-Null
Write-Host "Tarefa registrada: $name (segunda 9h)"
Get-ScheduledTask -TaskName $name | Get-ScheduledTaskInfo | Select-Object NextRunTime | Format-List
