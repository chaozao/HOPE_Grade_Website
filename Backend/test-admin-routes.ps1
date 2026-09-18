Write-Host "=== Logging in as admin ==="

$loginBody = @{
    email = "bayagra@gmail.com"
    password = "Bayagra123!"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
Write-Host "Logged in!"

Write-Host ""
Write-Host "=== Step A: Creating a Class (adviser = Justine) ==="

$classBody = @{
    name = "Grade 10 - Diamond"
    adviserId = "6aa756ffaa725fb64cb7020e"
} | ConvertTo-Json

try {
    $classResponse = Invoke-RestMethod -Uri "http://localhost:3000/admin/classes" -Method Post -Body $classBody -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" }
    Write-Host ($classResponse | ConvertTo-Json)
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}

Write-Host ""
Write-Host "=== Step B: Listing all Classes ==="

try {
    $classes = Invoke-RestMethod -Uri "http://localhost:3000/admin/classes" -Method Get -Headers @{ Authorization = "Bearer $token" }
    Write-Host ($classes | ConvertTo-Json)
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}