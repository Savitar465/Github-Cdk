# Roles ADMIN/USER_MANAGER + usuarios jonas/david/daniel tras recrear el realm
$ErrorActionPreference = 'Stop'
$KC = 'http://Github-Keycl-Zsxubd8lEksg-1780593735.us-east-1.elb.amazonaws.com'

$envVars = @{}
Get-Content 'c:\Users\harold\OneDrive\Escritorio\proyecto IA devops\Github-Cdk\.env' | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$') { $envVars[$Matches[1]] = $Matches[2] }
}
$tok = Invoke-RestMethod -Method Post -Uri "$KC/realms/master/protocol/openid-connect/token" `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{ grant_type='password'; client_id='admin-cli'; username='admin'; password=$envVars['KEYCLOAK_ADMIN_PASSWORD'] }
$h = @{ Authorization = "Bearer $($tok.access_token)" }

foreach ($roleName in @('ADMIN','USER_MANAGER')) {
    try {
        Invoke-RestMethod -Method Post -Uri "$KC/admin/realms/Github/roles" -Headers $h `
            -ContentType 'application/json' -Body (@{name=$roleName} | ConvertTo-Json) | Out-Null
        Write-Output "Rol $roleName creado"
    } catch { if ([int]$_.Exception.Response.StatusCode -eq 409) { Write-Output "Rol $roleName ya existia" } else { throw } }
}
$adminRole = Invoke-RestMethod -Uri "$KC/admin/realms/Github/roles/ADMIN" -Headers $h
$roleBody = ConvertTo-Json @(@{id=$adminRole.id; name=$adminRole.name})
$chars = ([char[]](48..57)) + ([char[]](65..90)) + ([char[]](97..122))

foreach ($u in @('harold','jonas','david','daniel')) {
    $usr = Invoke-RestMethod -Uri "$KC/admin/realms/Github/users?username=$u&exact=true" -Headers $h
    if (-not $usr -or $usr.Count -eq 0) {
        $pass = -join (1..16 | ForEach-Object { Get-Random -InputObject $chars })
        # email + lastName son OBLIGATORIOS: sin ellos Keycloak 26 rechaza el
        # login directo con "Account is not fully set up".
        $body = @{ username=$u; enabled=$true; emailVerified=$true; email="$u@minigithub.local"; firstName=$u.Substring(0,1).ToUpper()+$u.Substring(1); lastName='MiniGithub'; requiredActions=@(); credentials=@(@{type='password'; value=$pass; temporary=$false}) } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Method Post -Uri "$KC/admin/realms/Github/users" -Headers $h -ContentType 'application/json' -Body $body | Out-Null
        Add-Content -Path 'c:\Users\harold\OneDrive\Escritorio\proyecto IA devops\Github-Cdk\.env.keycloak-notes' `
            -Value "Usuario Keycloak (stack $(Get-Date -Format dd-MMM)) -> realm: Github | usuario: $u | password: $pass | rol: ADMIN" -Encoding ASCII
        $usr = Invoke-RestMethod -Uri "$KC/admin/realms/Github/users?username=$u&exact=true" -Headers $h
        Write-Output "Usuario $u creado (password nuevo en .env.keycloak-notes)"
    } else {
        Write-Output "Usuario $u ya existia"
    }
    Invoke-RestMethod -Method Post -Uri "$KC/admin/realms/Github/users/$($usr[0].id)/role-mappings/realm" `
        -Headers $h -ContentType 'application/json' -Body $roleBody | Out-Null
    Write-Output "  rol ADMIN asignado a $u"
}
Write-Output 'ROLES Y USUARIOS COMPLETOS'

