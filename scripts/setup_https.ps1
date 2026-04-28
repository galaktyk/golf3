param(
    [string[]]$HostNames = @()
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $repoRoot '.certs'
$certFile = Join-Path $certDir 'dev-cert.pem'
$keyFile = Join-Path $certDir 'dev-key.pem'

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    throw "mkcert was not found in PATH. Install mkcert first, then rerun this script."
}

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$ipAddresses = @(
    Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -ne '127.0.0.1' -and
            $_.ValidLifetime -gt [TimeSpan]::Zero
        } |
        Select-Object -ExpandProperty IPAddress -Unique
)

$names = @(
    'localhost',
    '127.0.0.1',
    '::1',
    $env:COMPUTERNAME,
    $HostNames,
    $ipAddresses
) | Where-Object { $_ } | Select-Object -Unique

Write-Host "Installing local mkcert root CA if needed..."
mkcert -install | Out-Host

Write-Host "Generating HTTPS certificate for:" ($names -join ', ')
mkcert -cert-file $certFile -key-file $keyFile @names | Out-Host

Write-Host ""
Write-Host "Certificate written to $certFile"
Write-Host "Key written to $keyFile"
Write-Host "Start HTTPS with: python .\run_https.py"