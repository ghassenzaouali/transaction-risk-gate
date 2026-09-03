[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepositoryRoot = (git rev-parse --show-toplevel).Trim()
$VirtualEnvironment = Join-Path $RepositoryRoot ".local\tools\pre-commit"
$Python = Join-Path $VirtualEnvironment "Scripts\python.exe"
$PreCommit = Join-Path $VirtualEnvironment "Scripts\pre-commit.exe"
$env:PRE_COMMIT_HOME = Join-Path $RepositoryRoot ".local\cache\pre-commit"

$Npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $Npm) {
    throw "Node.js 22 or newer and npm are required to install project tooling."
}

& $Npm.Source ci --ignore-scripts
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install pinned project tooling."
}

function Test-PythonRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable
    )

    if (-not (Test-Path -LiteralPath $Executable)) {
        return $false
    }

    try {
        & $Executable -c "import encodings, sys, venv; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

if (-not (Test-PythonRuntime -Executable $Python)) {
    $Candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"),
        "C:\Python313\python.exe",
        "C:\Python312\python.exe",
        "C:\Python311\python.exe"
    )

    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($PythonCommand) {
        $Candidates += $PythonCommand.Source
    }

    $SelectedPython = $Candidates |
        Select-Object -Unique |
        Where-Object { $_ -and (Test-PythonRuntime -Executable $_) } |
        Select-Object -First 1

    if (-not $SelectedPython) {
        throw "Python 3.11 or newer is required to install project-local hooks."
    }

    & $SelectedPython -m venv --clear $VirtualEnvironment
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Python)) {
        throw "Failed to create the project-local pre-commit environment."
    }
}

& $Python -m pip install --disable-pip-version-check --upgrade "pip==26.2"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install the pinned pip version."
}

& $Python -m pip install --disable-pip-version-check "pre-commit==4.6.0"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install pre-commit 4.6.0."
}

& $PreCommit install-hooks
if ($LASTEXITCODE -ne 0) {
    throw "Failed to initialize the hook environments."
}

git config --local core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure the repository-owned Git hooks."
}

Write-Host "Transaction Risk Gate hooks initialized."
