$body = @{
    name = "Maria"
    email = "maria@example.com"
    password = "mypassword456"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/signup" -Method Post -Body $body -ContentType "application/json"