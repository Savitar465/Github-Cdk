# Cómo revivir el entorno AWS después de un `cdk destroy`

Tiempo total estimado: 40–60 minutos. Requisitos: Docker Desktop abierto,
AWS CLI configurada (`aws sts get-caller-identity` debe responder), y el
archivo `.env` de este repo intacto (contiene todas las contraseñas).

> Nota Avast: si la AWS CLI falla con "SSL validation failed", ejecutar antes:
> `$env:AWS_CA_BUNDLE = 'C:\ProgramData\Avast Software\Avast\wscert.pem'`

## Paso 1 — Primer deploy (~25 min)

```powershell
cd Github-Cdk
npx cdk deploy --require-approval never
```

Al terminar, apuntar de los Outputs:
- `KeycloakServiceLoadBalancerDns...` → DNS del ALB de Keycloak
- `SharedApiAlbDns` → DNS del ALB compartido de APIs
- `FrontendUrl` → URL pública del frontend

## Paso 2 — Actualizar el `.env` con los DNS nuevos

Los ALB se recrean con nombres nuevos. Reemplazar en `.env` el DNS viejo por el
nuevo en TODAS las líneas que lo contengan:

- Todas las URIs con el ALB de Keycloak viejo (`Github-Keycl-...`):
  `KEYCLOAK_ISSUER_URI`, `KEYCLOAK_JWK_SET_URI`, `KEYCLOAK_SERVER_URL`,
  `REPO_JWT_*`, `REPO_KEYCLOAK_HOST`, `ORG_JWT_*`, `ISSUES_JWT_*`,
  `FILES_JWT_ISSUER_URI`, `JWT_ISSUER_URI`
- Todas las URLs con el ALB compartido viejo (`Github-Share-...`):
  `NEXT_PUBLIC_USERS_API_URL`, `NEXT_PUBLIC_PR_API_URL`,
  `NEXT_PUBLIC_ORG_API_URL`, `NEXT_PUBLIC_ISSUES_API_URL`

Truco (PowerShell), repetir para cada DNS viejo→nuevo:

```powershell
(Get-Content .env) -replace 'DNS-VIEJO', 'DNS-NUEVO' | Set-Content .env -Encoding ASCII
```

## Paso 3 — Configurar Keycloak (~2 min)

Editar **ambos** scripts en `scripts/` actualizando la variable `$KC` con el
DNS nuevo del ALB de Keycloak:
- `configure-keycloak.ps1` — realm, token de 8h, clientes, usuario harold
- `configure-keycloak-usuarios.ps1` — roles ADMIN/USER_MANAGER + usuarios
  jonas/david/daniel con rol ADMIN

Luego ejecutarlos en ese orden:

```powershell
.\scripts\configure-keycloak.ps1
.\scripts\configure-keycloak-usuarios.ps1
```

⚠️ Las contraseñas de TODOS los usuarios se regeneran en cada revivida y se
agregan al final de `.env.keycloak-notes` — usar siempre las últimas.

## Paso 4 — Segundo deploy (rebuild del frontend, ~15 min)

Con el `.env` ya actualizado (las URLs se hornean en el bundle del frontend):

```powershell
npx cdk deploy --require-approval never
```

## Paso 5 — Verificar

- Abrir la `FrontendUrl` → login con `harold` (password en `.env.keycloak-notes`)
- Crear un repo (sin espacios en el nombre), subir un archivo, ver su contenido
- Revisar pestañas de organizaciones, usuarios, issues y pull requests

## Para volver a apagar

```powershell
npx cdk destroy --force
```

Después del destroy, revisar en la consola RDS → Snapshots si quedó un
snapshot final de la base y borrarlo si no se necesita (cuesta centavos/mes).
