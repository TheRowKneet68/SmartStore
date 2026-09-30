# Measures C-06 from the documents themselves. No dependency on any other script.
# Exits 1 if any invariant fails, so it can gate a commit.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$trace = Join-Path $root 'docs\product\requirements-traceability.md'
$audit = Join-Path $root 'docs\architecture\C-06-TRACEABILITY-REVIEW.md'
$enc = New-Object System.Text.UTF8Encoding($false)
$P = [char]124
$fail = New-Object System.Collections.Generic.List[string]

function Check { param([string]$Name, $Got, $Want)
    $ok = ($Got -eq $Want)
    if (-not $ok) { [void]$fail.Add("$Name : got [$Got], want [$Want]") }
    "{0,-56} {1,-8} {2}" -f $Name, $Got, $(if ($ok) { 'ok' } else { 'FAIL' })
}
function Report { param([string]$Name, $Value)
    "{0,-56} {1,-8} (measured, not asserted)" -f $Name, $Value
}

# ----------------------------------------------------------------- trace file
$tl = [System.IO.File]::ReadAllLines($trace, $enc)

# RT rows: | ID | Domain | Requirement | Pri | Actor | Business Rule | Deps | Acceptance | Phase |
$rts = New-Object System.Collections.Generic.List[object]
foreach ($l in $tl) {
    if ($l -notmatch '^\|\s*RT-\d{3}') { continue }
    $c = $l.Split($P)
    if ($c.Count -lt 10) { continue }
    if ($c[1].Trim() -notmatch '^RT-\d{3}$') { continue }
    [void]$rts.Add([pscustomobject]@{
        Id = $c[1].Trim()
        Priority = $c[4].Trim()
        Cite = $c[6].Trim()
    })
}
Check 'requirement rows' $rts.Count 529

$byId = @{}
foreach ($r in $rts) { $byId[$r.Id] = $r }
Check 'distinct requirement ids' $byId.Count 529
$nums = @($rts | ForEach-Object { [int]$_.Id.Substring(3) } | Sort-Object)
$gapFree = ($nums.Count -eq 529) -and ($nums[0] -eq 1) -and ($nums[528] -eq 529)
for ($i = 1; $i -lt $nums.Count; $i++) { if ($nums[$i] -ne $nums[$i - 1] + 1) { $gapFree = $false; break } }
Check 'RT ids contiguous RT-001..RT-529' $gapFree $true
Check 'rows drafted by this review (RT-355..529)' @($rts | Where-Object { [int]$_.Id.Substring(3) -ge 355 }).Count 175

# 26.2 coverage rows: | `AC-01` | doc | RT-010 | `mapped` |
$cov = New-Object System.Collections.Generic.List[object]
$inCov = $false
foreach ($l in $tl) {
    if ($l -match '^### 26\.2 ') { $inCov = $true; continue }
    if ($inCov -and $l -match '^#{2,3} ') { $inCov = $false }
    if (-not $inCov) { continue }
    if ($l -notmatch '^\|\s*`[A-Z]{2,3}-') { continue }
    $c = $l.Split($P)
    if ($c.Count -lt 5) { continue }
    [void]$cov.Add([pscustomobject]@{
        Rule = $c[1].Trim().Trim('`')
        Homes = @($c[3].Trim() -split ',' | ForEach-Object { $_.Trim() })
        Status = $c[4].Trim().Trim('`')
    })
}
Check 'coverage rows in 26.2' $cov.Count 1161
Check 'coverage rows with status mapped' @($cov | Where-Object { $_.Status -eq 'mapped' }).Count 1161
Check 'coverage rows with status inferred' @($cov | Where-Object { $_.Status -eq 'inferred' }).Count 0
Check 'distinct rules in 26.2' @($cov | ForEach-Object { $_.Rule } | Select-Object -Unique).Count 1161

# expand citations: keep the left-hand form, so PR-Q11..PR-Q21 stays a Q range
function Expand-Cite([string]$s) {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($tok in ($s -split ',')) {
        $t = $tok.Trim()
        if ($t -eq '' -or $t -eq '-') { continue }
        if ($t -notmatch '\.\.') { [void]$out.Add($t); continue }
        $p = $t -split '\.\.'
        if ($p.Count -ne 2) { [void]$out.Add($t); continue }
        $m1 = [regex]::Match($p[0].Trim(), '^([A-Z]{2,3})-(Q?)(\d{1,3})([a-z]?)$')
        $m2 = [regex]::Match($p[1].Trim(), '^([A-Z]{2,3})-(Q?)(\d{1,3})([a-z]?)$')
        if (-not $m1.Success -or -not $m2.Success) { [void]$out.Add($t); continue }
        $pre = $m1.Groups[1].Value + '-' + $m1.Groups[2].Value
        $suf = $m2.Groups[4].Value
        $lo = [int]$m1.Groups[3].Value
        $hi = [int]$m2.Groups[3].Value
        for ($n = $lo; $n -le $hi; $n++) {
            [void]$out.Add($pre + $n.ToString().PadLeft(2, '0') + $suf)
        }
    }
    return $out
}
$cited = New-Object System.Collections.Generic.HashSet[string]
$prose = New-Object System.Collections.Generic.HashSet[string]
$idPat = '^[A-Z]{2,3}-Q?\d{1,3}[a-z]?$'
foreach ($r in $rts) {
    foreach ($x in (Expand-Cite $r.Cite)) {
        if ($x -match $idPat) { [void]$cited.Add($x) } else { [void]$prose.Add($x) }
    }
}
Check 'distinct rules cited by requirement rows' $cited.Count 1161
Report 'non-rule tokens ignored in the rule column' $prose.Count

# bijection, both directions
$inTable = New-Object System.Collections.Generic.HashSet[string]
foreach ($c in $cov) { [void]$inTable.Add($c.Rule) }
$onlyTable = @($inTable | Where-Object { -not $cited.Contains($_) })
$onlyCited = @($cited | Where-Object { -not $inTable.Contains($_) })
Check 'mapped but never cited' $onlyTable.Count 0
Check 'cited but absent from 26.2' $onlyCited.Count 0
if ($onlyTable.Count -gt 0) { "      e.g. $($onlyTable[0..([Math]::Min(4, $onlyTable.Count - 1))] -join ', ')" }
if ($onlyCited.Count -gt 0) { "      e.g. $($onlyCited[0..([Math]::Min(4, $onlyCited.Count - 1))] -join ', ')" }

# OUT OF SCOPE is a Pri value, not a word in the requirement text
$oosIds = New-Object System.Collections.Generic.HashSet[string]
foreach ($r in $rts) { if ($r.Priority -eq 'OUT OF SCOPE') { [void]$oosIds.Add($r.Id) } }
$oosFirst = 0
$oosAny = 0
foreach ($c in $cov) {
    if ($oosIds.Contains($c.Homes[0])) { $oosFirst++ }
    foreach ($h in $c.Homes) { if ($oosIds.Contains($h)) { $oosAny++; break } }
}
Report 'requirement rows with Pri = OUT OF SCOPE' $oosIds.Count
Report 'coverage rows, canonical home is OUT OF SCOPE' $oosFirst
Report 'coverage rows, any listed home is OUT OF SCOPE' $oosAny

# ----------------------------------------------------------------- audit file
$al = [System.IO.File]::ReadAllLines($audit, $enc)
$have = @{}
foreach ($l in $al) { if ($l -match '^## (\d+)\. ') { $have[$Matches[1]] = $true } }
$missing = @(1..22 | Where-Object { -not $have.ContainsKey("$_") })
Check 'audit: required elements 1..22 present' $missing.Count 0
if ($missing.Count -gt 0) { "      missing $($missing -join ', ')" }

$ownerHead = ($al | Select-String -Pattern '^## 18\. ' | Select-Object -First 1).LineNumber
$ownerRows = 0
if ($ownerHead) {
    for ($i = $ownerHead - 1; $i -lt $al.Count; $i++) {
        if ($i -gt $ownerHead - 1 -and $al[$i] -match '^# ') { break }
        if ($al[$i] -match ('^\|\s*RT-\d{3}\s*\|')) { $ownerRows++ }
    }
}
Check 'audit: owner confirmation list rows' $ownerRows 175

$batchHeads = @($al | Select-String -Pattern '^## Batch (\d+[a-z]?) - .* - (\d+) rules$')
Check 'audit: batch sections' $batchHeads.Count 10
$sum = 0
foreach ($b in $batchHeads) { $sum += [int]$b.Matches[0].Groups[2].Value }
Check 'audit: batch populations sum' $sum 342
$b3b = @($batchHeads | Where-Object { $_.Line -match '^## Batch 3b ' })
Check 'audit: Batch 3b population' $(if ($b3b) { [int]$b3b[0].Matches[0].Groups[2].Value } else { -1 }) 30

$notRe = @($al | Where-Object { $_ -match '^## (19|20|21|22)\. Not reconstructable$' }).Count
Check 'audit: elements 19-22 marked not reconstructable' $notRe 4

$appHead = ($al | Select-String -Pattern '^# Appendix A' | Select-Object -First 1).LineNumber
$reconHead = ($al | Select-String -Pattern '^### Reconciliation against the 342' | Select-Object -First 1).LineNumber
$appA = 0
$appRef = 0
if ($appHead -and $reconHead) {
    for ($i = $appHead - 1; $i -lt $reconHead - 1; $i++) {
        if ($al[$i] -match ('^\|\s*`[A-Z]{2,3}-Q?\d')) { $appA++ }
        elseif ($al[$i] -match ('^\|\s*`overview')) { $appRef++ }
    }
}
Check 'audit: Appendix A rule rows' $appA 279
Check 'audit: Appendix A non-rule section references' $appRef 3
$recon = @{}
for ($i = $reconHead - 1; $i -lt [Math]::Min($reconHead + 12, $al.Count); $i++) {
    if ($al[$i] -match '^\|\s*Rules cited by a row drafted') { $recon['a'] = [int]([regex]::Match($al[$i], '(\d+)\s*\|?\s*$').Groups[1].Value) }
    if ($al[$i] -match 'identities not reconstructable') { $recon['b'] = [int]([regex]::Match($al[$i], '(\d+)\s*\|?\s*$').Groups[1].Value) }
}
if ($recon.ContainsKey('a') -and $recon.ContainsKey('b')) {
    Check 'audit: reconciliation adds up to 342' (279 + (342 - 279 - $recon['b']) + $recon['b']) 342
    Check 'audit: Appendix A count matches reconciliation' $recon['a'] $appA
    Check 'audit: not-reconstructable count matches' $recon['b'] (342 - $appA - 14)
}
$findings = @($al | Where-Object { $_ -match ('^\|\s*`[A-Z]{2,3}-Q?\d') -and $_ -match '`(CONFIRMED|WEAK MATCH|WRONG HOME|ADDS BEHAVIOUR NOT IN SOURCE)`' }).Count
Check 'audit: verification findings listed' $findings 13

# ----------------------------------------------------------------- encoding
foreach ($f in @($trace, $audit)) {
    $b = [System.IO.File]::ReadAllBytes($f)
    $s = $enc.GetString($b)
    $nm = Split-Path -Leaf $f
    Check "$nm : no BOM" ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) $false
    Check "$nm : LF only" ([regex]::Matches($s, "`r`n")).Count 0
    Check "$nm : ends with LF" ($b[$b.Length - 1] -eq 10) $true
    Check "$nm : no U+FFFD" ([regex]::Matches($s, [string][char]0xFFFD)).Count 0
    Check "$nm : no mojibake C2/C3" ([regex]::Matches($s, '[\u00C2\u00C3]')).Count 0
}

''
if ($fail.Count -eq 0) {
    "ALL CHECKS PASSED"
    exit 0
} else {
    "FAILURES ($($fail.Count)):"
    foreach ($x in $fail) { "  - $x" }
    exit 1
}
