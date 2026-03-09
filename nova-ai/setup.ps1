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
  $setupPy = Join-Path $projectRoot "setup.py"
  $promptFile = Join-Path $projectRoot "prompts\image_instructions_prompt.txt"
  $venvPath = Join-Path $projectRoot ".venv"
  $venvPython = Join-Path $venvPath "Scripts\python.exe"

  if (-not (Test-Path $requirementsFile)) {
    throw "Missing requirements.txt at $requirementsFile"
  }

  if (-not (Test-Path $setupPy)) {
    throw "Missing setup.py at $setupPy"
  }

  if (-not (Test-Path $promptFile)) {
    throw "Missing prompt file at $promptFile"
  }

  if (Test-Path $envFile) {
    Write-Host "[1/6] Loading .env variables"
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
    Write-Host "[2/6] Creating venv (if missing)"
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

  Write-Host "[3/6] Upgrading pip"
  & $pythonCmd -m pip install --upgrade pip

  Write-Host "[4/6] Installing dependencies"
  & $pythonCmd -m pip install -r $requirementsFile

  Write-Host "[5/6] Installing project in editable mode"
  & $pythonCmd -m pip install -e $projectRoot

  Write-Host "[6/6] Verifying imports and prompt loading"
  & $pythonCmd -c "from script_runner import ScriptRunner; from prompt_loader import get_image_instructions_prompt; prompt = get_image_instructions_prompt(); assert prompt.strip(), 'image_instructions_prompt.txt is empty'; print(f'script_runner import OK / prompt loaded: {len(prompt)} chars')"

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
  Write-Host "GUI example: python gui_app.py"
  if ($PersistEnv) {
    Write-Host "Environment variables were persisted for current user."
  }
}
finally {
  Pop-Location
}
