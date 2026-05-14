# Github CDK

AWS CDK application (TypeScript) que provisiona la plataforma completa **GithubX** sobre AWS ECS (Fargate) con PostgreSQL RDS, MongoDB, y Application Load Balancers.

## Servicios desplegados

| Servicio | DNS interno (VPC) | Puerto |
|---|---|---|
| Keycloak | ALB público | 8080 |
| Users MS | `users.github.local` | 8081 |
| Files MS | `files-ms.github.local` | 8083 |
| Pull Requests MS | `pullrequest-ms.github.local` | 8084 |
| Organizations MS | `organizations-ms.github.local` | 8085 |
| Repository MS | `repository-ms.github.local` | 8090 |
| Issues MS | `issues-ms.github.local` | 8091 |
| Git Server | `git-server.github.local` | 9080 / SSH 2222 |
| MongoDB | `mongodb.github.local` | 27017 |
| Frontend | ALB público | 80 |

---

## Requisitos previos

| Herramienta | Versión mínima |
|---|---|
| Node.js | 18.x |
| npm | 9.x |
| AWS CDK CLI | 2.x |
| AWS CLI | 2.x |
| Docker | 20.x (solo para rebuild de imágenes) |

Instalar el CDK CLI globalmente:

```bash
npm install -g aws-cdk
```

Configurar credenciales AWS y hacer bootstrap de la cuenta (una sola vez por cuenta/región):

```bash
aws configure
cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

---

## Instalación

```bash
git clone <url-del-repo>
cd Github-Cdk
npm install
```

---

## Configuración

Copia el archivo de ejemplo y edita los valores:

```bash
cp .env.example .env
```

### Variables principales

#### Infraestructura AWS

| Variable | Descripción | Ejemplo |
|---|---|---|
| `AWS_ACCOUNT_ID` | ID de la cuenta AWS | `919968175219` |
| `AWS_REGION` | Región de despliegue | `us-east-1` |
| `CDK_STACK_NAME` | Nombre del stack CloudFormation | `Github-cdk` |
| `ECS_CLUSTER_NAME` | Nombre del cluster ECS | `github-ecs` |
| `ECS_INSTANCE_TYPE` | Tipo de instancia EC2 del cluster | `t3.large` |
| `VPC_NAT_GATEWAYS` | NAT Gateways (`0` = sin costo, subnets públicas) | `1` |

#### PostgreSQL (RDS)

| Variable | Descripción |
|---|---|
| `DB_PASSWORD` | Contraseña del usuario `postgres` |
| `KEYCLOAK_DB_NAME` | Base de datos de Keycloak |
| `USERS_DB_NAME` | Base de datos de users-ms |
| `RDS_INSTANCE_TYPE` | Tipo de instancia (`t4g.micro` para free tier) |
| `RDS_ENGINE_VERSION` | Versión de PostgreSQL: `15.10`, `16.4` o `17.2` |
| `RDS_MULTI_AZ` | Alta disponibilidad (`true`/`false`) |

#### Keycloak

| Variable | Descripción |
|---|---|
| `KEYCLOAK_ADMIN_USER` | Usuario administrador |
| `KEYCLOAK_ADMIN_PASSWORD` | Contraseña del administrador |

#### Microservicios

Cada microservicio tiene su bloque en el `.env`. Las variables siguen el patrón `<SERVICIO>_<PROPIEDAD>`:

- `SERVER_PORT`, `KEYCLOAK_*`, `USUARIOS_DB_*` — **users-ms**
- `REPO_*` — **repository-ms**
- `FILES_*` — **files-ms**
- `PR_*`, `JWT_ISSUER_URI`, `APP_*` — **pull-requests-ms**
- `ORG_*` — **organizations-ms**
- `ISSUES_*` — **issues-ms**
- `NEXT_PUBLIC_*` — **frontend** (Next.js)

> **Nota sobre el frontend:** Las variables `NEXT_PUBLIC_*` se incrustan en el bundle JavaScript en tiempo de build, no en runtime. Los valores del `.env` de CDK se pasan como env vars al contenedor pero no tienen efecto en el código del browser. Para actualizar las URLs del frontend es necesario reconstruir la imagen Docker (ver [Rebuild del frontend](#rebuild-del-frontend)).

---

## Comandos

```bash
# Compilar TypeScript
npm run build

# Sintetizar CloudFormation (verificar sin desplegar)
npm run synth

# Ver diferencias respecto al estado desplegado
npm run diff:dev

# Desplegar en dev (sin prompt de aprobación)
npm run deploy:dev

# Desplegar en prod (requiere aprobación manual)
npm run deploy:prod

# Ejecutar tests
npm run test
npm run test:coverage
```

---

## Primer despliegue

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con los valores de tu entorno

# 3. Compilar
npm run build

# 4. Verificar síntesis
npm run synth

# 5. Desplegar
npm run deploy:dev
```

Al finalizar, CDK imprime los outputs del stack:

```
Github-cdk.ClusterName                    = github-ecs
Github-cdk.DbEndpoint                     = <rds-endpoint>.rds.amazonaws.com
Github-cdk.LoadBalancerDns                = <alb-dns>.us-east-1.elb.amazonaws.com   ← Keycloak
Github-cdk.FrontendUrl                    = http://<alb-dns>.us-east-1.elb.amazonaws.com
Github-cdk.RepositoryMsUrl               = http://<alb-dns>.us-east-1.elb.amazonaws.com
Github-cdk.UsersServiceDiscoveryDns       = users.github.local
Github-cdk.IssuesMsServiceDiscoveryDns   = issues-ms.github.local
```

Copiar el valor de `LoadBalancerDns` y actualizar `KEYCLOAK_*` y `NEXT_PUBLIC_KEYCLOAK_URL` en el `.env` antes del siguiente deploy.

---

## Teardown

```bash
cdk destroy --context env=dev
```

> **Advertencia:** Todos los recursos usan `RemovalPolicy.DESTROY`. RDS, logs y datos serán eliminados permanentemente.

---

## Rebuild del frontend

Cuando se cambian URLs de microservicios, reconstruir y pushear la imagen:

```bash
cd ../Github-front

# .env.production ya contiene las URLs correctas de github.local
docker build -t cfulano/github-frontend:latest .
docker push cfulano/github-frontend:latest
```

Luego forzar un nuevo deployment en ECS:

```bash
aws ecs update-service \
  --cluster github-ecs \
  --service <nombre-servicio-frontend> \
  --force-new-deployment \
  --region us-east-1
```

---

## Arquitectura

```
Internet
    │
    ├──[ALB Keycloak]──► [Keycloak ECS]──────────────────────┐
    │                                                         │
    ├──[ALB Repository]─► [Repository ECS]──► MongoDB ECS    │
    │                                                         ▼
    └──[ALB Frontend]───► [Frontend ECS]      [RDS PostgreSQL]
                                               ├── keycloak
VPC privada (github.local)                     ├── ms-users
  users.github.local:8081 ◄──────────────┐    ├── github_files
  files-ms.github.local:8083 ◄───────────┤    ├── github_pull_requests
  pullrequest-ms.github.local:8084 ◄─────┤    ├── github_organizations
  organizations-ms.github.local:8085 ◄───┘    └── github_issues_db
  issues-ms.github.local:8091
  git-server.github.local:9080
  mongodb.github.local:27017
```

### Modo sin NAT Gateway (`VPC_NAT_GATEWAYS=0`)

Las tareas ECS e instancias EC2 se ubican en subnets públicas con IP pública. Elimina el costo del NAT Gateway (~$32/mes por AZ). Solo recomendado para desarrollo.

---

## Consideraciones para producción

- Cambiar `RemovalPolicy.DESTROY` a `RETAIN` en RDS.
- Mover credenciales a AWS Secrets Manager.
- Setear `VPC_NAT_GATEWAYS=1` para aislar contenedores en subnets privadas.
- Setear `RDS_MULTI_AZ=true` para alta disponibilidad.
- Setear `RDS_PUBLICLY_ACCESSIBLE=false`.
- Agregar HTTPS en los ALBs con un certificado ACM.