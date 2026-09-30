<#
.SYNOPSIS
  One-time local database setup for SmartStore development (ADR-31 section 6).

.DESCRIPTION
  Creates the roles smartstore_owner and smartstore_app and the development database on a local PostgreSQL,
  then writes .env with both connection strings.

  The PostgreSQL superuser password is asked for, used for this run only, and never written anywhere.
  The two role passwords are generated randomly and are written only to .env, which is gitignored.

  Run it from the repository root:  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\db-setup.ps1
  Then:                              npm run db:migrate

.PARAMETER ResetPasswords
  Roles already exist and .env is missing or must be rotated: set new random passwords and rewrite .env.
#>
param(
  [string]$HostName = 'localhost',
  [int]$Port = 5432,
  [string]$SuperUser = 'postgres',
  [string]$Database = 'smartstore_dev',
  [securestring]$SuperPassword,
  [string]$EnvFile,
  [switch]$ResetPasswords
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }
if ((Test-Path $EnvFile) -and -not $ResetPasswords) {
  throw "$EnvFile already exists, so nothing was changed. Use -ResetPasswords to rotate the role passwords and rewrite it."
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql was not found on PATH. Add the PostgreSQL bin folder (for example C:\Program Files\PostgreSQL\17\bin) to PATH.'
}

function New-Secret {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  # 32 URL-safe characters, so the value needs no escaping in a connection string
  return [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').Replace('=', '')
}

if (-not $SuperPassword) { $SuperPassword = Read-Host "Password of the PostgreSQL user '$SuperUser'" -AsSecureString }
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SuperPassword)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $connect = @('-h', $HostName, '-p', $Port, '-U', $SuperUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X')

  $existing = & psql @connect -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('smartstore_owner','smartstore_app')"
  if ($LASTEXITCODE -ne 0) { throw 'Could not connect to PostgreSQL. Check the host, port and password.' }
  if ([int]$existing -gt 0 -and -not $ResetPasswords) {
    throw 'The smartstore roles already exist but their passwords are not known here. Re-run with -ResetPasswords.'
  }

  $ownerPassword = New-Secret
  $appPassword = New-Secret
  $reset = if ($ResetPasswords) { 'true' } else { 'false' }

  # The passwords go to psql on stdin, so they never appear on a command line.
  $prefix = "\set owner_password '$ownerPassword'`n\set app_password '$appPassword'`n\set dbname '$Database'`n\set reset_passwords '$reset'`n"
  $body = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'db-bootstrap.sql'))
  ($prefix + $body) | & psql @connect -f -
  if ($LASTEXITCODE -ne 0) { throw 'The bootstrap script failed. Nothing was written to .env.' }
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$text = @"
# Written by scripts/db-setup.ps1. Never commit this file: it holds database passwords.
DATABASE_URL=postgres://smartstore_app:$appPassword@${HostName}:$Port/${Database}?sslmode=disable
MIGRATION_DATABASE_URL=postgres://smartstore_owner:$ownerPassword@${HostName}:$Port/${Database}?sslmode=disable
"@
$text = $text.Replace("`r`n", "`n")
if ($text[-1] -ne "`n") { $text += "`n" }
[System.IO.File]::WriteAllText($EnvFile, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Done. Roles and database '$Database' are ready and $EnvFile was written. Next: npm run db:migrate"
