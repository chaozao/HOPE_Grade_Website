Write-Host "=== Logging in as Golemite ==="

$loginBody = @{
    email = "golemite@gmail.com"
    password = "Golemite123!"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
Write-Host "Logged in!"

Write-Host ""
Write-Host "=== HAT 1: Class Adviser view (my-class) ==="
try {
    $myClass = Invoke-RestMethod -Uri "http://localhost:3000/adviser/my-class" -Method Get -Headers @{ Authorization = "Bearer $token" }
    Write-Host "Class:" $myClass.class.name
    Write-Host "Student count:" $myClass.students.Count
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}

Write-Host ""
Write-Host "=== HAT 2: Subject Teacher view (my-subjects) ==="
try {
    $subjects = Invoke-RestMethod -Uri "http://localhost:3000/teacher/my-subjects" -Method Get -Headers @{ Authorization = "Bearer $token" }
    Write-Host ($subjects | ConvertTo-Json)
} catch {
    Write-Host "FAILED:" $_.ErrorDetails.Message
}