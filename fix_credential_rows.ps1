$filePath = 'd:\APEC\Work\Projects\MANAGER ALL\public\app.js'
$content = [System.IO.File]::ReadAllText($filePath)

# Search for the broken section
$searchPattern = "credentialDepartmentName(credential))}</div>`r`n          `${canRevealEntryPassword"

if ($content.Contains($searchPattern)) {
    Write-Output "Found the broken pattern (CRLF)"
} else {
    $searchPattern2 = "credentialDepartmentName(credential))}</div>`n          `${canRevealEntryPassword"
    if ($content.Contains($searchPattern2)) {
        Write-Output "Found the broken pattern (LF only)"
    } else {
        Write-Output "Pattern NOT found, searching substring..."
        $idx = $content.IndexOf('canRevealEntryPassword ? `<span class="risk-badge">Nh')
        if ($idx -ge 0) {
            Write-Output "Found risk-badge at index $idx"
            $snippet = $content.Substring([Math]::Max(0, $idx - 100), 300)
            Write-Output "Context: $snippet"
        } else {
            Write-Output "risk-badge NOT found either"
        }
    }
}

# Check for revealAction variable usage (should have been removed)
$idx2 = $content.IndexOf('${revealAction}')
if ($idx2 -ge 0) {
    Write-Output "revealAction still used at index $idx2"
    $snippet2 = $content.Substring([Math]::Max(0, $idx2 - 200), 500)
    Write-Output "Context around revealAction:"
    Write-Output $snippet2
} else {
    Write-Output "revealAction not found (good)"
}
