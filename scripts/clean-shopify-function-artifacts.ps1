$ErrorActionPreference = "Stop"

$extensionDir = "extensions/loopdesk-discount-function"
$shopifyToml = "$extensionDir/shopify.extension.toml"
$cargoLock = "$extensionDir/Cargo.lock"
$targetDir = "$extensionDir/target"

Write-Host "Restoring tracked Shopify extension configuration..."
git restore -- $shopifyToml

if (Test-Path $targetDir) {
  Write-Host "Removing Rust build output: $targetDir"
  Remove-Item -Recurse -Force $targetDir
}
else {
  Write-Host "No Rust build output found: $targetDir"
}

if (Test-Path $cargoLock) {
  git ls-files --error-unmatch -- $cargoLock *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Keeping tracked Cargo.lock: $cargoLock"
  }
  else {
    Write-Host "Removing untracked Cargo.lock: $cargoLock"
    Remove-Item -Force $cargoLock
  }
}
else {
  Write-Host "No Cargo.lock found: $cargoLock"
}

Write-Host "Current git status:"
git status --short
