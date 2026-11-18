param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Empty', 'Demo')]
    [string] $Mode
)

$ErrorActionPreference = 'Stop'
$previousD1Path = $env:OUAHAD_D1_PATH
$previewPort = if ($Mode -eq 'Demo') { 4174 } else { 4173 }
$env:OUAHAD_D1_PATH = if ($Mode -eq 'Demo') { '.local/d1-demo-phase3' } else { '.local/d1-empty-phase3' }

# Both preview stores are isolated from the owner's normal D1 database.
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm.cmd run catalog -- migrate
    if ($LASTEXITCODE -ne 0) { throw 'Local D1 migration failed.' }
    npm.cmd run catalog -- seed
    if ($LASTEXITCODE -ne 0) { throw 'The Phase 1 seed failed.' }

    if ($Mode -eq 'Demo') {
        # Approve a reviewed subset of the real Phase 1 editions through the owner CLI.
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
        if ($LASTEXITCODE -ne 0) { throw 'Could not check the empty preview store.' }
        if ($published.Trim() -ne '[]') {
            throw 'The empty preview store already has approvals. No editions were changed.'
        }
    }

    npm.cmd run preview -- --port $previewPort
    if ($LASTEXITCODE -ne 0) { throw 'The preview could not start.' }
} finally {
    Pop-Location
    $env:OUAHAD_D1_PATH = $previousD1Path
}
