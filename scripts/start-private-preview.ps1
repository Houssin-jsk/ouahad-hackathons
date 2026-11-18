param(
    [ValidateSet('Empty', 'Demo')]
    [string] $Mode = 'Empty',
    [ValidateRange(1, 65535)]
    [int] $Port = 4175
)

$ErrorActionPreference = 'Stop'
$previousD1Path = $env:OUAHAD_D1_PATH
$previousNodeEnv = $env:NODE_ENV
$previousDevAuth = $env:OUAHAD_DEV_AUTH
$env:OUAHAD_D1_PATH = if ($Mode -eq 'Demo') { '.local/d1-private-phase5-demo' } else { '.local/d1-private-phase5-empty' }
$env:NODE_ENV = 'development'
$env:OUAHAD_DEV_AUTH = '1'

Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm.cmd run catalog -- migrate
    if ($LASTEXITCODE -ne 0) { throw 'Local D1 migration failed.' }
    npm.cmd run catalog -- seed
    if ($LASTEXITCODE -ne 0) { throw 'The Phase 1 seed failed.' }
    if ($Mode -eq 'Demo') {
        # Explicit CLI approvals apply only to this separate, real-record demo store.
        $demoEditions = @(
            'add-open-data:hackathon-open-data-2026',
            'ibn-zohr-fsa:technovate-blue-tech-2026',
            'hack-united:united-hacks-v8',
            'github-game-off:game-off-2026',
            'nasa-space-apps:universal-event-2025',
            'hack-club:recDFXvSpx4603YEa',
            'uca-rss:https%3A%2F%2Fcim.uca.ma%2F%3Fp%3D5562'
        )
        foreach ($editionId in $demoEditions) {
            $approval = npm.cmd --silent run catalog -- review inspect $editionId | Out-String | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0) { throw "Could not inspect $editionId." }
            if ($approval.publicationState -eq 'draft' -and $approval.pendingId) {
                npm.cmd run catalog -- publish $editionId $approval.pendingId
                if ($LASTEXITCODE -ne 0) { throw "Could not publish $editionId in the demo store." }
            }
        }
    } else {
        $published = npm.cmd --silent run catalog -- list all | Out-String
        if ($LASTEXITCODE -ne 0 -or $published.Trim() -ne '[]') {
            throw 'The empty preview must have no approvals. No publications were changed.'
        }
    }
    npm.cmd run preview -- --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'The private preview could not start.' }
} finally {
    Pop-Location
    $env:OUAHAD_D1_PATH = $previousD1Path
    $env:NODE_ENV = $previousNodeEnv
    $env:OUAHAD_DEV_AUTH = $previousDevAuth
}
