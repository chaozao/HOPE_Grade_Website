Write-Host "=== Logging in as admin ==="

$loginBody = @{
    email = "bayagra@gmail.com"
    password = "Bayagra123!"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
Write-Host "Logged in!"

Write-Host ""
Write-Host "=== Step A: Creating a Subject (teacher = gongjiaoche) ==="

$subjectBody = @{
    name = "Algebra II"
    classId = "6aa7a4218dbeda6e791c9619"
    teacherId = "6aa25f8221cca26932a4ed76"
} | ConvertTo-Json

try {
    $subjectResponse = Invoke-RestMethod -Uri "http://localhost:3000/admin/subjects" -Method Post -Body $subjectBody -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" }
    Write-Host ($subjectResponse | ConvertTo-Json)
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}

Write-Host ""
Write-Host "=== Step B: Listing all Subjects ==="

try {
    $subjects = Invoke-RestMethod -Uri "http://localhost:3000/admin/subjects" -Method Get -Headers @{ Authorization = "Bearer $token" }
    Write-Host ($subjects | ConvertTo-Json)
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}

Write-Host ""
Write-Host "=== Step C: Deactivating gongjiaoche ==="

try {
    $deactivateResponse = Invoke-RestMethod -Uri "http://localhost:3000/admin/teachers/6aa25f8221cca26932a4ed76/deactivate" -Method Patch -Headers @{ Authorization = "Bearer $token" }
    Write-Host ($deactivateResponse | ConvertTo-Json)
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}

Write-Host ""
Write-Host "=== Step D: Confirming gongjiaoche can no longer log in ==="

$deactivatedLoginBody = @{
    email = "gongjiaoche@gmail.com"
    password = "PUT_THEIR_REAL_PASSWORD_HERE"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $deactivatedLoginBody -ContentType "application/json"
} catch {
    Write-Host "BLOCKED (expected):" $_.ErrorDetails.Message
}