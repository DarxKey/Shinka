# Prepara un ambiente Windows per Shinka: scarica dal centro il nodo e il suo guardiano, installa le
# dipendenze, fa partire il nodo e lo fa ripartire a ogni accesso a Windows, con la sua icona
# nell'area di notifica (guardiano\icona-windows.ps1, ADR 0045). Il centro mette in cima
# a questo file le scelte fatte nella pagina Ambienti ($SHINKA_CENTRO, $SHINKA_PACCHETTO,
# $SHINKA_NOME, $SHINKA_DESCRIZIONE). Si può rilanciare: l'identità del nodo e i suoi dati restano.
#
# Arriva con `irm … | iex`: tutto sta in una funzione, e un errore la chiude con return, non con
# exit, che chiuderebbe la finestra di PowerShell. Scritto per Windows PowerShell 5.1.
#
# Variabile che si può dare prima del comando:
#   $env:SHINKA_CARTELLA  dove sta il nodo (predefinita: ~\Shinka\nodo)

function Prepara-AmbienteShinka {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  function Fallisci([string] $testo) {
    Write-Host ''
    Write-Host "Shinka non ha preparato questo ambiente: $testo" -ForegroundColor Red
  }
  function Passo([string] $testo) { Write-Host "· $testo" }
  function Togli([string] $percorso) {
    # rd regge i percorsi lunghi di node_modules meglio di Remove-Item.
    if (Test-Path -LiteralPath $percorso) { & cmd.exe /d /c "rd /s /q `"$percorso`"" | Out-Null }
  }

  if ($env:SHINKA_CARTELLA) { $cartella = $env:SHINKA_CARTELLA } else { $cartella = Join-Path $HOME 'Shinka\nodo' }
  $registro = Join-Path $cartella 'nodo.log'

  Write-Host "Shinka prepara questo ambiente: «$SHINKA_NOME», collegato a $SHINKA_CENTRO."

  # Node.js: se manca, lo installa winget, se c'è.
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
      Passo 'Manca Node.js: lo installo con winget (Windows può chiedere il permesso)'
      & winget.exe install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
      Fallisci 'manca Node.js. Serve la versione 22.18 o più recente: https://nodejs.org. Poi rilancia il comando in una finestra nuova.'
      return
    }
  }
  $node = (Get-Command node.exe).Source
  & $node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
  if ($LASTEXITCODE -ne 0) {
    Fallisci "Node.js è alla versione $(& $node --version): serve la 22.18 o più recente."
    return
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fallisci 'manca npm, che arriva con Node.js.'; return }
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Fallisci 'manca tar.exe, che Windows ha dalla versione 10 1803.'; return }

  $provvisoria = Join-Path ([IO.Path]::GetTempPath()) ("shinka-nodo-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $provvisoria | Out-Null
  try {
    Passo 'Scarico il nodo dal centro'
    $archivio = Join-Path $provvisoria 'nodo.tar.gz'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $SHINKA_PACCHETTO -OutFile $archivio
    } catch {
      Fallisci "il centro non ha dato il pacchetto ($($_.Exception.Message)). L'invito vale un'ora: se è scaduto, prepara un comando nuovo dalla pagina Ambienti."
      return
    }
    $estratto = Join-Path $provvisoria 'estratto'
    New-Item -ItemType Directory -Path $estratto | Out-Null
    & tar.exe -xzf $archivio -C $estratto
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $estratto 'shinka\src\nodo\avvio.ts'))) {
      Fallisci 'il pacchetto scaricato non contiene il nodo.'
      return
    }

    New-Item -ItemType Directory -Force -Path $cartella | Out-Null

    # L'icona del nodo si chiude: sta in guardiano\, che viene sostituita, e ripartirà con quella nuova.
    $icone = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -match 'icona-windows\.ps1' })
    foreach ($aperta in $icone) { Stop-Process -Id $aperta.ProcessId -Force -ErrorAction SilentlyContinue }

    # Un nodo già acceso su questa macchina si ferma, con ciò che ha avviato, per sostituirne il codice.
    $accesi = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'guardiano[\\/]avvio-nodo\.ts' })
    if ($accesi.Count -gt 0) {
      Passo 'Fermo il nodo che c''era'
      foreach ($acceso in $accesi) { & taskkill.exe /PID $acceso.ProcessId /T /F | Out-Null }
      Start-Sleep -Seconds 2
    }

    Passo "Metto a posto il codice in $cartella"
    Togli (Join-Path $cartella 'guardiano')
    Move-Item -LiteralPath (Join-Path $estratto 'guardiano') -Destination (Join-Path $cartella 'guardiano')
    $nuova = Join-Path $estratto 'shinka'
    $inFunzione = Join-Path $cartella 'shinka'
    if (Test-Path -LiteralPath $inFunzione) {
      # Se le dipendenze sono le stesse, si tengono quelle che ci sono: niente da scaricare.
      $bloccoPrima = Join-Path $inFunzione 'package-lock.json'
      $bloccoDopo = Join-Path $nuova 'package-lock.json'
      if ((Test-Path -LiteralPath (Join-Path $inFunzione 'node_modules')) -and (Test-Path -LiteralPath $bloccoPrima) -and (Test-Path -LiteralPath $bloccoDopo) -and
          ((Get-FileHash -LiteralPath $bloccoPrima).Hash -eq (Get-FileHash -LiteralPath $bloccoDopo).Hash)) {
        Move-Item -LiteralPath (Join-Path $inFunzione 'node_modules') -Destination (Join-Path $nuova 'node_modules')
      }
      Togli (Join-Path $cartella 'shinka-sostituita')
      Move-Item -LiteralPath $inFunzione -Destination (Join-Path $cartella 'shinka-sostituita')
    }
    Move-Item -LiteralPath $nuova -Destination $inFunzione
  } finally {
    Togli $provvisoria
  }

  if (-not (Test-Path -LiteralPath (Join-Path $inFunzione 'node_modules'))) {
    Passo 'Installo le dipendenze (qualche minuto)'
    Push-Location -LiteralPath $inFunzione
    try { & npm.cmd ci --omit=dev --no-audit --no-fund --loglevel=error | Out-Host } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Fallisci "npm non ha installato le dipendenze: guarda l'errore qui sopra."; return }
  }

  # Le scelte del nodo: indirizzo del centro, nome e descrizione. Quelle che il nodo aveva già
  # (cartella dei progetti, browser del PC) restano.
  Passo 'Salvo le scelte del nodo'
  $dati = Join-Path $cartella 'dati-nodo'
  New-Item -ItemType Directory -Force -Path $dati | Out-Null
  $env:SHINKA_FILE = Join-Path $dati 'nodo.json'
  $env:SHINKA_CENTRO = $SHINKA_CENTRO
  $env:SHINKA_NOME = $SHINKA_NOME
  $env:SHINKA_DESCRIZIONE = $SHINKA_DESCRIZIONE
  # L'impronta del certificato con cui riconoscere il centro: quella del centro che ha dato questo comando.
  $env:SHINKA_IMPRONTA = $SHINKA_IMPRONTA
  & $node -e 'const fs=require("node:fs");const f=process.env.SHINKA_FILE;let p={};try{p=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}const s={...p,centro:process.env.SHINKA_CENTRO,nome:process.env.SHINKA_NOME,descrizione:process.env.SHINKA_DESCRIZIONE};delete s.improntaDelCentro;if(process.env.SHINKA_IMPRONTA)s.improntaDelCentro=process.env.SHINKA_IMPRONTA;fs.writeFileSync(f,JSON.stringify(s,null,2))'
  foreach ($nome in 'SHINKA_FILE', 'SHINKA_CENTRO', 'SHINKA_NOME', 'SHINKA_DESCRIZIONE', 'SHINKA_IMPRONTA') { Remove-Item "Env:$nome" -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { Fallisci 'non è stato possibile salvare le scelte del nodo.'; return }

  # Il nodo parte nascosto, con il suo registro. Lo avvia l'icona, a ogni accesso a Windows, e la
  # riconosce dal percorso intero del guardiano.
  $avvio = Join-Path $cartella 'avvia-nodo.ps1'
  $righe = @(
    '# Avvia il guardiano del nodo di Shinka, nascosto, con il registro in nodo.log. Scritto da Shinka.',
    '$cartella = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$env:SHINKA_INSTALLATA = Join-Path $cartella ''shinka''',
    '$env:SHINKA_DATI_NODO = Join-Path $cartella ''dati-nodo''',
    '$guardiano = Join-Path $cartella ''guardiano\avvio-nodo.ts''',
    ('Start-Process -FilePath $env:ComSpec -WorkingDirectory $cartella -WindowStyle Hidden -ArgumentList (''/d /c ""' + $node.Replace("'", "''") + '" "'' + $guardiano + ''" >> nodo.log 2>&1"'')')
  )
  Set-Content -LiteralPath $avvio -Value $righe -Encoding UTF8
  $icona = Join-Path $cartella 'guardiano\icona-windows.ps1'
  $argomentiIcona = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$icona`""

  Passo 'Faccio partire il nodo e la sua icona a ogni accesso a Windows'
  $esecuzioneAutomatica = Join-Path ([Environment]::GetFolderPath('Startup')) 'Shinka nodo.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $collegamento = $shell.CreateShortcut($esecuzioneAutomatica)
  $collegamento.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $collegamento.Arguments = $argomentiIcona
  $collegamento.WorkingDirectory = $cartella
  $collegamento.WindowStyle = 7
  $collegamento.Description = 'Nodo di Shinka'
  $collegamento.Save()
  # Un avvio di prima, fatto a mano o da una versione vecchia (per esempio un .vbs), partirebbe insieme
  # a questo: si toglie, con i suoi script.
  foreach ($vecchio in @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Startup')) -Filter '*.lnk' -ErrorAction SilentlyContinue)) {
    if ($vecchio.FullName -eq $esecuzioneAutomatica) { continue }
    $letto = $shell.CreateShortcut($vecchio.FullName)
    if ("$($letto.TargetPath) $($letto.Arguments)" -match 'avvia-guardiano|avvio-nodo\.ts') {
      Remove-Item -LiteralPath $vecchio.FullName -Force -ErrorAction SilentlyContinue
      Passo "Tolto l'avvio di prima ($($vecchio.Name))"
    }
  }
  foreach ($script in 'avvia-guardiano.vbs', 'avvia-guardiano.ps1') { Remove-Item -LiteralPath (Join-Path $cartella $script) -Force -ErrorAction SilentlyContinue }

  if (-not (Test-Path -LiteralPath $registro)) { New-Item -ItemType File -Path $registro | Out-Null }
  $inizio = @(Get-Content -LiteralPath $registro -Encoding UTF8).Count
  Passo 'Faccio partire il nodo'
  & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $avvio
  # L'icona trova il nodo già acceso e lo tiene d'occhio; se non si può mostrare, il nodo resta acceso lo stesso.
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argomentiIcona -WindowStyle Hidden

  Passo 'Aspetto che il nodo si presenti al centro'
  $esito = ''
  $codice = ''
  for ($i = 0; $i -lt 90 -and $esito -eq ''; $i++) {
    Start-Sleep -Seconds 1
    $nuove = @(Get-Content -LiteralPath $registro -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Skip $inizio)
    $conCodice = @($nuove | Where-Object { $_ -match 'Codice di verifica:\s*([0-9 ]*[0-9])' })
    if ($conCodice.Count -gt 0) {
      $null = $conCodice[-1] -match 'Codice di verifica:\s*([0-9 ]*[0-9])'
      $codice = $Matches[1]
      $esito = 'attesa'
    } elseif (@($nuove | Where-Object { $_ -match 'Collegato:' }).Count -gt 0) {
      $esito = 'collegato'
    } elseif (@($nuove | Where-Object { $_ -match 'rifiutato' }).Count -gt 0) {
      $esito = 'rifiutato'
    }
  }

  Write-Host ''
  switch ($esito) {
    'attesa' {
      Write-Host "Il nodo aspetta il tuo consenso. Apri Shinka, pagina Ambienti, e approva la richiesta di «$SHINKA_NOME»"
      Write-Host "solo se il codice è questo: $codice" -ForegroundColor Green
    }
    'collegato' { Write-Host "Il nodo è collegato: l'ambiente «$SHINKA_NOME» è attivo." -ForegroundColor Green }
    'rifiutato' { Write-Host "Il centro ha rifiutato il nodo. Guarda che cosa dice: Get-Content -Tail 20 '$registro'" -ForegroundColor Yellow }
    default { Write-Host "Il nodo è partito, ma non si è ancora presentato al centro. Guarda che cosa dice: Get-Content -Tail 20 '$registro'" -ForegroundColor Yellow }
  }
  Write-Host 'Poi, nella pagina Impostazioni, fai gli accessi di Claude o Codex per questo ambiente.'
  Write-Host "Il nodo sta in $cartella; il suo registro è $registro."
  Write-Host "Nell'area di notifica c'è la sua icona: dal suo menu lo fermi, lo avvii e lo riavvii."
}

Prepara-AmbienteShinka
