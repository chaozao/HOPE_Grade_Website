Write-Host "=== Logging in as a Subject Teacher ==="

$loginBody = @{
    email = "golemite@gmail.com"
    password = "Golemite123!"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
Write-Host "Logged in!"

Write-Host ""
Write-Host "=== Step A: My Subjects ==="
$subjects = Invoke-RestMethod -Uri "http://localhost:3000/teacher/my-subjects" -Method Get -Headers @{ Authorization = "Bearer $token" }
Write-Host ($subjects | ConvertTo-Json)

Write-Host ""
Write-Host "=== Step B: Roster for first subject ==="
$subjectId = $subjects[0]._id
$roster = Invoke-RestMethod -Uri "http://localhost:3000/teacher/subjects/$subjectId/roster" -Method Get -Headers @{ Authorization = "Bearer $token" }
Write-Host ($roster | ConvertTo-Json -Depth 5)