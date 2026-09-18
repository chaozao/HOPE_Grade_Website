# Step A: Log in and get a token
$loginBody = @{
    email = "litianmei@gmail.com"
    password = "Litianmei123!"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"

Write-Host "Login successful! Token received."

# Step B: Automatically use that same token to test the /profile route
$token = $loginResponse.token

Invoke-RestMethod -Uri "http://localhost:3000/profile" -Method Get -Headers @{ Authorization = "Bearer $token" }