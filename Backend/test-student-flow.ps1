Write-Host "=== Logging in as Class Adviser (Justine) ==="

$loginBody = @{
    email = "golemite@gmail.com"
    password = "Golemite123!"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
Write-Host "Logged in!"

Write-Host ""
Write-Host "=== Adding students ==="

$students = @(
    @{ lastName = "Abalos"; firstName = "Maria"; middleInitial = "D."; gender = "Female" },
    @{ lastName = "Dela Cruz"; firstName = "Juan"; middleInitial = "P."; gender = "Male" },
    @{ lastName = "Bayabas"; firstName = "Ana"; middleInitial = ""; gender = "Female" }
)

foreach ($student in $students) {
    $body = $student | ConvertTo-Json
    $result = Invoke-RestMethod -Uri "http://localhost:3000/adviser/students" -Method Post -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" }
    Write-Host $result.message
}

Write-Host ""
Write-Host "=== Confirming via my-class ==="
$myClass = Invoke-RestMethod -Uri "http://localhost:3000/adviser/my-class" -Method Get -Headers @{ Authorization = "Bearer $token" }
Write-Host ($myClass | ConvertTo-Json -Depth 5)