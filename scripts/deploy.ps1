param(
    [string[]]$Profiles = @('baseline','openai','cursor','claude','openrouter','grok')
)
$ErrorActionPreference = 'Stop'
if ($Profiles -notcontains 'baseline') { throw 'Deployment must include the baseline profile' }
$project = Split-Path $PSScriptRoot -Parent
$endpoint = Get-Content -LiteralPath (Join-Path $project 'config/server.json') -Raw | ConvertFrom-Json
if ($endpoint.sshUser -notmatch '^[a-z_][a-z0-9_-]*$' -or $endpoint.ipv4 -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Invalid SSH destination' }
$destination = "$($endpoint.sshUser)@$($endpoint.ipv4)"
$release = '/root/smartdns-staging/release-' + [Guid]::NewGuid().ToString('N')
$sshArgs = @('-o','KexAlgorithms=curve25519-sha256','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes')
Push-Location $project
try {
    & node --input-type=module -e "import {requireDeploymentConfig} from './src/config.mjs'; requireDeploymentConfig();"
    if ($LASTEXITCODE) { throw 'Configure your own public endpoint before deployment' }
    & node src/render.mjs build @Profiles
    if ($LASTEXITCODE) { throw 'Render failed' }
    & ssh @sshArgs $destination "install -d -m 700 $release"
    if ($LASTEXITCODE) { throw 'Staging creation failed' }
    & scp @sshArgs -r build server "${destination}:$release/"
    if ($LASTEXITCODE) { throw 'Upload failed' }
    # Opening public access is a separate, explicit migration command in operations.md.
    $result = & ssh @sshArgs $destination "bash $release/server/update.sh $release/build"
    $result | Write-Output
    if ($LASTEXITCODE) { throw 'Server rejected update; inspect rollback' }
    $match = [regex]::Match(($result -join "`n"), '/root/smartdns-backup/domain-update\.[A-Za-z0-9]+')
    if (!$match.Success) { throw 'Cannot identify backup; stopping' }
    $backup = $match.Value
    try {
        & node scripts/check-dns.mjs ('--profiles=' + ($Profiles -join ','))
        if ($LASTEXITCODE) { throw 'Post-deploy DNS check failed; rollback required' }
        & node scripts/check-https.mjs www.wikipedia.org
        if ($LASTEXITCODE) { throw 'Baseline transport failed; rollback required' }
    } catch {
        & ssh @sshArgs $destination "bash $release/server/rollback.sh $backup"
        if ($LASTEXITCODE) { Write-Warning "Automatic rollback failed. Backup: $backup" }
        throw
    }
    & ssh @sshArgs $destination "ln -sfnT $release /root/smartdns-staging/current"
    if ($LASTEXITCODE) { throw 'Deployment passed, but updating the current-release link failed' }
    Write-Output "Deployment passed. Backup: $backup"
} finally { Pop-Location }
