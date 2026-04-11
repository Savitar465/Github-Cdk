# Ejercicio 4: S3 + Sitio Web Estatico + API Gateway + Lambda + CloudFront

Stack de AWS CDK que despliega un sitio web estatico en S3 con una API serverless.

## Arquitectura

```
                                    +------------------+
                                    |    CloudFront    |
                                    |      (CDN)       |
                                    +--------+---------+
                                             |
                    +------------------------+------------------------+
                    |                                                 |
                    v                                                 v
          +-----------------+                               +------------------+
          |   S3 Bucket     |                               |   API Gateway    |
          | (Static Website)|                               |    (REST API)    |
          |                 |                               +--------+---------+
          |  - index.html   |                                        |
          |  - error.html   |                                        v
          |  - styles.css   |                               +------------------+
          |  - script.js    |                               |     Lambda       |
          +-----------------+                               | (Node.js 20.x)   |
                                                            +------------------+
```

## Componentes

| Componente | Descripcion |
|------------|-------------|
| **S3 Bucket** | Hosting del sitio web estatico con index.html |
| **CloudFront** | CDN para distribucion global con HTTPS |
| **API Gateway** | REST API con endpoint `/hello` |
| **Lambda** | Funcion serverless que responde con "Hello {name}!" |

## Estructura del Proyecto

```
├── bin/
│   └── s3-static-website.ts      # Entrada CDK
├── lib/stacks/
│   └── s3-static-website-stack.ts # Stack principal
├── website/
│   ├── index.html                 # Pagina principal
│   ├── error.html                 # Pagina de error 404
│   ├── styles.css                 # Estilos
│   └── script.js                  # Logica para llamar la API
└── package.json                   # Scripts de deploy
```

## Requisitos Previos

1. **Node.js** (v18 o superior)
2. **AWS CLI** configurado con credenciales
3. **AWS CDK** instalado globalmente (opcional)

## Configuracion Inicial (Primera Vez)

### 1. Configurar AWS CLI

```bash
aws configure
```

Ingresa:
- AWS Access Key ID
- AWS Secret Access Key
- Region (ej: `us-east-1`)
- Output format: `json`

### 2. Bootstrap de CDK

```bash
npx cdk bootstrap
```

## Comandos Disponibles

| Comando | Descripcion |
|---------|-------------|
| `npm run synth:website` | Genera el template CloudFormation |
| `npm run diff:website` | Muestra cambios pendientes |
| `npm run deploy:website` | Despliega el stack en AWS |
| `npm run destroy:website` | Elimina todos los recursos |

## Despliegue

### Paso 1: Instalar dependencias

```bash
npm install
```

### Paso 2: Compilar TypeScript

```bash
npm run build
```

### Paso 3: Desplegar

```bash
npm run deploy:website
```

### Paso 4: Copiar la URL de la API

Al finalizar el deploy, veras outputs como:

```
Outputs:
S3StaticWebsiteStack.ApiEndpoint = https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/
S3StaticWebsiteStack.CloudFrontURL = https://dxxxxx.cloudfront.net
S3StaticWebsiteStack.HelloApiEndpoint = https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/hello
S3StaticWebsiteStack.WebsiteURL = http://xxxxx.s3-website-us-east-1.amazonaws.com
```

### Paso 5: Actualizar script.js

Edita `website/script.js` y reemplaza `API_URL_PLACEHOLDER` con tu `HelloApiEndpoint`:

```javascript
const API_URL = 'https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/hello';
```

### Paso 6: Re-desplegar

```bash
npm run deploy:website
```

### Paso 7: Probar

Abre la URL de **CloudFrontURL** en tu navegador.

## Uso del Sitio Web

1. Ingresa tu nombre en el campo de texto
2. Presiona el boton "Llamar API"
3. La Lambda respondera con un mensaje personalizado

## API Endpoints

### POST /hello

Request:
```json
{
  "name": "Juan"
}
```

Response:
```json
{
  "message": "Hello Juan!",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET /hello

Response:
```json
{
  "message": "Hello World!",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Limpieza

Para eliminar todos los recursos de AWS:

```bash
npm run destroy:website
```

## Verificar en Consola AWS

| Servicio | Que buscar |
|----------|------------|
| S3 | Bucket `s3staticwebsitestack-websitebucket-*` |
| Lambda | Funcion `S3StaticWebsiteStack-ApiFunction-*` |
| API Gateway | API `StaticWebsiteApi` |
| CloudFront | Distribution apuntando al bucket S3 |

## Costos Estimados

Este stack utiliza servicios con capa gratuita de AWS:
- **S3**: 5GB almacenamiento gratis
- **Lambda**: 1M requests/mes gratis
- **API Gateway**: 1M requests/mes gratis
- **CloudFront**: 1TB transferencia/mes gratis

## Troubleshooting

### Error: "Access Denied" al acceder al sitio
- Verifica que el bucket tenga `publicReadAccess: true`
- El stack ya configura esto automaticamente

### Error: CORS al llamar la API
- El API Gateway ya tiene CORS configurado
- Verifica que la URL en `script.js` sea correcta

### CloudFront muestra contenido viejo
- CloudFront cachea el contenido
- Espera unos minutos o crea una invalidation en la consola

## Tecnologias

- AWS CDK v2 (TypeScript)
- AWS S3
- AWS Lambda (Node.js 20.x)
- AWS API Gateway
- AWS CloudFront
- HTML/CSS/JavaScript
