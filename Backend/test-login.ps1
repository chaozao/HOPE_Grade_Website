$body = @{
    email = "litianmei@gmail.com"
    password = "Litianmei123!"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/login" -Method Post -Body $body -ContentType "application/json"