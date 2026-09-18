$body = @{
    name = "Juan"
    email = "juan@example.com"
    password = "1234"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/signup" -Method Post -Body $body -ContentType "application/json"