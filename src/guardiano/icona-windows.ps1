# L'icona del nodo di Shinka nell'area di notifica di Windows (ADR 0045).
#
# Fa partire il nodo, se non è già acceso, e mostra com'è: il pallino è verde quando il nodo è
# collegato al centro, giallo quando si avvia, si collega o aspetta il consenso, rosso quando c'è un
# problema, grigio quando è fermo. Dal menu si ferma, si avvia e si riavvia, e si aprono Shinka, il
# registro e la cartella. Fermarlo da qui ferma anche ciò che il nodo ha avviato.
#
# Sta in guardiano\ accanto al guardiano, fuori dalla versione in funzione: un aggiornamento del
# nodo non la tocca. Il collegamento nella cartella Esecuzione automatica la avvia a ogni accesso a
# Windows; lo scrive prepara-ambiente.ps1. Lo stato lo legge da dati-nodo\stato-del-collegamento.json,
# che il nodo scrive a ogni cambio.
#
# Scritta per Windows PowerShell 5.1, che legge un file senza BOM come ANSI: il file va salvato in
# UTF-8 con il BOM. Con -SoloFunzioni definisce le funzioni e si ferma: serve alle prove.

param([switch] $SoloFunzioni)

$ErrorActionPreference = 'Stop'

# Com'è il nodo, in parole e in un genere che decide il colore del pallino. Riceve se il guardiano
# è acceso, ciò che il nodo ha scritto del suo collegamento (o $null) e se il processo che lo ha
# scritto è ancora acceso: un file di un nodo che non c'è più non dice nulla di quello di adesso.
function Descrivi-Stato([bool] $guardianoAcceso, $letto, [bool] $nodoAcceso) {
  if (-not $guardianoAcceso) { return @{ genere = 'fermo'; testo = 'Fermo' } }
  if ($null -eq $letto -or -not $nodoAcceso) { return @{ genere = 'avvio'; testo = 'Si avvia…' } }
  switch ([string] $letto.stato) {
    'collegamento' { return @{ genere = 'avvio'; testo = 'Si collega al centro…' } }
    'in-attesa' { return @{ genere = 'attesa'; testo = "Aspetta il tuo consenso in Shinka, codice $($letto.codice)"; codice = [string] $letto.codice } }
    'attivo' { return @{ genere = 'attivo'; testo = 'Collegato al centro' } }
    'scollegato' { return @{ genere = 'problema'; testo = 'Centro non raggiungibile: riprova da solo' } }
    'centro-non-riconosciuto' { return @{ genere = 'problema'; testo = 'Il centro non presenta il certificato che il nodo ricorda' } }
    'solo-cifrato' { return @{ genere = 'problema'; testo = 'Il centro vuole il collegamento cifrato, e il nodo non riesce ad aprirlo' } }
    'rifiutato' { return @{ genere = 'rifiutato'; testo = "Rifiutato dal centro: $($letto.motivo)" } }
  }
  return @{ genere = 'avvio'; testo = 'Si avvia…' }
}

# Ciò che il nodo ha scritto del suo collegamento, o $null se non c'è o non si legge.
function Leggi-StatoDelCollegamento([string] $cartella) {
  $file = Join-Path (Join-Path $cartella 'dati-nodo') 'stato-del-collegamento.json'
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# Le scelte del nodo: l'indirizzo del centro e il nome dell'ambiente.
function Leggi-SceltaDelNodo([string] $cartella) {
  $file = Join-Path (Join-Path $cartella 'dati-nodo') 'nodo.json'
  try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# Vero se la riga di comando è quella del guardiano di questa cartella. I nodi preparati prima
# dell'icona lo avviano con il percorso relativo: anche quello vale.
function E-IlGuardiano([string] $rigaDiComando, [string] $cartella) {
  if ([string]::IsNullOrEmpty($rigaDiComando)) { return $false }
  $assoluto = $cartella.TrimEnd('\') + '\guardiano\avvio-nodo.ts'
  if ($rigaDiComando.IndexOf($assoluto, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  return $rigaDiComando -match '(^|[\s"])guardiano[\\/]avvio-nodo\.ts'
}

# Il testo del suggerimento sull'icona: Windows non ne accetta più di 63 caratteri.
function Testo-Suggerimento([string] $nome, [string] $testo) {
  $tutto = if ([string]::IsNullOrEmpty($nome)) { "Shinka: $testo" } else { "Shinka · ${nome}: $testo" }
  if ($tutto.Length -le 63) { return $tutto }
  return $tutto.Substring(0, 62) + '…'
}

if ($SoloFunzioni) { return }

$cartella = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$avvio = Join-Path $cartella 'avvia-nodo.ps1'
$registro = Join-Path $cartella 'nodo.log'

# Una sola icona per cartella del nodo, anche se il collegamento parte due volte.
$sha = [Security.Cryptography.SHA1]::Create()
$impronta = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cartella.ToLowerInvariant()))).Replace('-', '')
$unaSola = New-Object Threading.Mutex($false, "Local\ShinkaIconaNodo-$impronta")
if (-not $unaSola.WaitOne(0)) { return }

$script:pidGuardiano = $null
$script:avviatoAlle = $null
# Vero se il processo c'è ed è Node: un numero di processo, liberato, può passare a un altro programma.
function Node-Acceso($id) {
  if ($null -eq $id) { return $false }
  $processo = Get-Process -Id ([int] $id) -ErrorAction SilentlyContinue
  return $null -ne $processo -and $processo.ProcessName -eq 'node'
}
function Trova-Guardiani {
  @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { E-IlGuardiano $_.CommandLine $cartella })
}
# Vero se il guardiano è acceso. Il processo noto si controlla senza cercarlo tra tutti.
function Guardiano-Acceso {
  if (Node-Acceso $script:pidGuardiano) { return $true }
  $trovati = Trova-Guardiani
  if ($trovati.Count -eq 0) { $script:pidGuardiano = $null; return $false }
  $script:pidGuardiano = $trovati[0].ProcessId
  return $true
}
function Avvia-Nodo {
  if (Guardiano-Acceso) { return }
  if (-not (Test-Path -LiteralPath $avvio)) { throw "Manca ${avvio}: rilancia il comando della pagina Ambienti." }
  $script:avviatoAlle = Get-Date
  & $avvio
}
function Ferma-Nodo {
  foreach ($guardiano in (Trova-Guardiani)) { & taskkill.exe /PID $guardiano.ProcessId /T /F | Out-Null }
  $script:pidGuardiano = $null
  $script:avviatoAlle = $null
}

# Il nodo parte prima di tutto il resto: se l'icona non si può mostrare, resta acceso lo stesso.
Avvia-Nodo

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

# Le icone si disegnano una volta: il quadrato di Shinka con la S, e il pallino del colore dello stato.
function Disegna-Icona([string] $colore) {
  $lato = 32
  $immagine = New-Object Drawing.Bitmap($lato, $lato)
  $pennello = [Drawing.Graphics]::FromImage($immagine)
  $pennello.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $pennello.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $forma = New-Object Drawing.Drawing2D.GraphicsPath
  $r = 8
  $forma.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $forma.AddArc($lato - 1 - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $forma.AddArc($lato - 1 - $r * 2, $lato - 1 - $r * 2, $r * 2, $r * 2, 0, 90)
  $forma.AddArc(0, $lato - 1 - $r * 2, $r * 2, $r * 2, 90, 90)
  $forma.CloseFigure()
  # I colori del logo: il fondo viola scuro e la S ciano.
  $pennello.FillPath((New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#2d0a52'))), $forma)
  $carattere = New-Object Drawing.Font('Segoe UI', 17, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
  $centrato = New-Object Drawing.StringFormat
  $centrato.Alignment = [Drawing.StringAlignment]::Center
  $centrato.LineAlignment = [Drawing.StringAlignment]::Center
  $pennello.DrawString('S', $carattere, (New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#00f0ff'))), (New-Object Drawing.RectangleF(-3, -1, $lato, $lato)), $centrato)
  $pennello.FillEllipse([Drawing.Brushes]::White, 17, 17, 15, 15)
  $pennello.FillEllipse((New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml($colore))), 19, 19, 11, 11)
  $pennello.Dispose()
  return [Drawing.Icon]::FromHandle($immagine.GetHicon())
}
$icone = @{
  attivo = Disegna-Icona '#1f9d55'
  avvio = Disegna-Icona '#d99a06'
  attesa = Disegna-Icona '#d99a06'
  problema = Disegna-Icona '#d64545'
  rifiutato = Disegna-Icona '#d64545'
  fermo = Disegna-Icona '#8a8f98'
}

$icona = New-Object Windows.Forms.NotifyIcon
$icona.Icon = $icone['avvio']
$icona.Text = 'Shinka: nodo'
$menu = New-Object Windows.Forms.ContextMenuStrip
$voceStato = $menu.Items.Add('Nodo di Shinka')
$voceStato.Enabled = $false
[void] $menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$voceApri = $menu.Items.Add('Apri Shinka')
$voceApri.Font = New-Object Drawing.Font($voceApri.Font, [Drawing.FontStyle]::Bold)
$voceRiavvia = $menu.Items.Add('Riavvia il nodo')
$voceFermaAvvia = $menu.Items.Add('Ferma il nodo')
[void] $menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$voceRegistro = $menu.Items.Add('Apri il registro')
$voceCartella = $menu.Items.Add('Apri la cartella del nodo')
$icona.ContextMenuStrip = $menu
$icona.Visible = $true

$script:genere = ''
$script:fermatoDaQui = $false

function Aggiorna {
  $acceso = Guardiano-Acceso
  $letto = Leggi-StatoDelCollegamento $cartella
  $nodoAcceso = $false
  if ($null -ne $letto) { $nodoAcceso = Node-Acceso $letto.pid }
  # Appena avviato, il guardiano impiega un momento a comparire tra i processi: non è fermo.
  $appenaAvviato = $null -ne $script:avviatoAlle -and ((Get-Date) - $script:avviatoAlle).TotalSeconds -lt 15
  $stato = Descrivi-Stato ($acceso -or $appenaAvviato) $letto $nodoAcceso
  $scelte = Leggi-SceltaDelNodo $cartella
  $nome = if ($null -ne $scelte) { [string] $scelte.nome } else { '' }

  $voceStato.Text = if ($nome -ne '') { "${nome}: $($stato.testo)" } else { $stato.testo }
  $voceFermaAvvia.Text = if ($acceso) { 'Ferma il nodo' } else { 'Avvia il nodo' }
  $voceRiavvia.Enabled = $acceso
  $icona.Text = Testo-Suggerimento $nome $stato.testo
  if ($stato.genere -ne $script:genere) {
    $icona.Icon = $icone[$stato.genere]
    # Un avviso solo per ciò che chiede di fare qualcosa, o che non ci si aspetta.
    if ($stato.genere -eq 'attesa') {
      $icona.ShowBalloonTip(10000, 'Shinka', "Approva il nodo nella pagina Ambienti di Shinka, se il codice è $($stato.codice).", [Windows.Forms.ToolTipIcon]::Info)
    } elseif ($stato.genere -eq 'rifiutato') {
      $icona.ShowBalloonTip(10000, 'Shinka', $stato.testo, [Windows.Forms.ToolTipIcon]::Warning)
    } elseif ($stato.genere -eq 'fermo' -and $script:genere -ne '' -and -not $script:fermatoDaQui) {
      $icona.ShowBalloonTip(10000, 'Shinka', 'Il nodo si è fermato. Dal menu dell''icona lo fai ripartire.', [Windows.Forms.ToolTipIcon]::Warning)
    }
    $script:genere = $stato.genere
  }
}

# Un errore in un'azione si dice nell'avviso dell'icona, e l'icona resta.
function Fai([scriptblock] $azione) {
  try { & $azione } catch { $icona.ShowBalloonTip(10000, 'Shinka', $_.Exception.Message, [Windows.Forms.ToolTipIcon]::Error) }
  try { Aggiorna } catch {}
}
function Apri-Shinka {
  $scelte = Leggi-SceltaDelNodo $cartella
  if ($null -eq $scelte -or [string]::IsNullOrEmpty([string] $scelte.centro)) { throw 'Il nodo non sa ancora l''indirizzo del centro.' }
  Start-Process ([string] $scelte.centro)
}

$voceApri.add_Click({ Fai { Apri-Shinka } })
$icona.add_DoubleClick({ Fai { Apri-Shinka } })
$voceRiavvia.add_Click({ Fai { $script:fermatoDaQui = $false; Ferma-Nodo; Start-Sleep -Milliseconds 800; Avvia-Nodo } })
$voceFermaAvvia.add_Click({
  Fai {
    if (Guardiano-Acceso) { $script:fermatoDaQui = $true; Ferma-Nodo } else { $script:fermatoDaQui = $false; Avvia-Nodo }
  }
})
$voceRegistro.add_Click({ Fai { Start-Process notepad.exe -ArgumentList "`"$registro`"" } })
$voceCartella.add_Click({ Fai { Start-Process explorer.exe -ArgumentList "`"$cartella`"" } })

$orologio = New-Object Windows.Forms.Timer
$orologio.Interval = 3000
$orologio.add_Tick({ try { Aggiorna } catch {} })
$orologio.Start()
Aggiorna

try {
  [Windows.Forms.Application]::Run((New-Object Windows.Forms.ApplicationContext))
} finally {
  $icona.Visible = $false
  $icona.Dispose()
  $unaSola.ReleaseMutex()
}
