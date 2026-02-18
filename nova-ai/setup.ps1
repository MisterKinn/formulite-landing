param(
  [Alias("Persist")]
  [switch]$PersistEnv,
  [switch]$SkipVenv
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Push-Location $PSScriptRoot
try {
  $projectRoot = $PSScriptRoot
  $envFile = Join-Path $projectRoot ".env"
  $requirementsFile = Join-Path $projectRoot "requirements.txt"
  $venvPath = Join-Path $projectRoot ".venv"
  $venvPython = Join-Path $venvPath "Scripts\python.exe"

  if (-not (Test-Path $requirementsFile)) {
    throw "Missing requirements.txt at $requirementsFile"
  }

  if (Test-Path $envFile) {
    Write-Host "[1/5] Loading .env variables"
    foreach ($rawLine in Get-Content $envFile) {
      $line = $rawLine.Trim()
      if ($line.Length -eq 0) { continue }
      if ($line.StartsWith("#")) { continue }

      $parts = $line.Split("=", 2)
      if ($parts.Count -ne 2) { continue }

      $name = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"').Trim("'")
      if ($name.Length -eq 0) { continue }

      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
      if ($PersistEnv) {
        [System.Environment]::SetEnvironmentVariable($name, $value, "User")
      }
    }

    if (-not $env:GEMINI_MODEL -and $env:LITEPRO_MODEL) {
      [System.Environment]::SetEnvironmentVariable("GEMINI_MODEL", $env:LITEPRO_MODEL, "Process")
      if ($PersistEnv) {
        [System.Environment]::SetEnvironmentVariable("GEMINI_MODEL", $env:LITEPRO_MODEL, "User")
      }
    }
  }
  else {
    Write-Warning ".env not found. Continuing, but AI/OCR features may fail."
  }

  if (-not $SkipVenv) {
    Write-Host "[2/5] Creating venv (if missing)"
    if (-not (Test-Path $venvPython)) {
      try {
        & py -3 -m venv $venvPath
      }
      catch {
        & python -m venv $venvPath
      }
    }
  }

  $pythonCmd = if ((-not $SkipVenv) -and (Test-Path $venvPython)) { $venvPython } else { "python" }

  Write-Host "[3/5] Upgrading pip"
  & $pythonCmd -m pip install --upgrade pip

  Write-Host "[4/5] Installing dependencies"
  & $pythonCmd -m pip install -r $requirementsFile

  Write-Host "[5/5] Verifying script_runner import"
  & $pythonCmd -c "from script_runner import ScriptRunner; print('script_runner import OK')"

  if ($env:TESSERACT_CMD) {
    if (Test-Path $env:TESSERACT_CMD) {
      Write-Host "Tesseract path OK: $($env:TESSERACT_CMD)"
    }
    else {
      Write-Warning "TESSERACT_CMD is set but file not found: $($env:TESSERACT_CMD)"
    }
  }

  Write-Host ""
  Write-Host "Setup completed."
  if (-not $SkipVenv) {
    Write-Host "Activate venv: .\.venv\Scripts\Activate.ps1"
  }
  Write-Host "Run example: python app.py detect"
  if ($PersistEnv) {
    Write-Host "Environment variables were persisted for current user."
  }
}
finally {
  Pop-Location
}
