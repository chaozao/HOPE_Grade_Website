Write-Host "Step 1: Preparing login request..."

$loginBody = @{
    email = "bayagra@gmail.com"
    password = "Bayagra123!"
} | ConvertTo-Json

Write-Host "Step 2: Sending login request..."

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"
    Write-Host "Step 3: Login response received!"
    Write-Host ($loginResponse | ConvertTo-Json)
} catch {
    Write-Host "LOGIN FAILED:"
    Write-Host $_.Exception.Message
    Write-Host $_.ErrorDetails.Message
    exit
}

$token = $loginResponse.token
Write-Host "Step 4: Token extracted: $token"

try {
    $adminResponse = Invoke-RestMethod -Uri "http://localhost:3000/admin/teachers" -Method Get -Headers @{ Authorization = "Bearer $token" }
    Write-Host "Step 5: Admin route response:"
    Write-Host ($adminResponse | ConvertTo-Json)
} catch {
    Write-Host "ADMIN ROUTE FAILED:"
    Write-Host $_.Exception.Message
    Write-Host $_.ErrorDetails.Message
}