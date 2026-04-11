# Ejercicio 4: S3 + Sitio Web Estatico + API Gateway + Lambda + CloudFront

Stack de AWS CDK que despliega un sitio web estatico en S3 conectado al API CRUD del Ejercicio 2.

## Arquitectura

```
+------------------+          +------------------------------------------+
|    CloudFront    |          |           Ejercicio 2                    |
|      (CDN)       |          |  +----------------+    +---------------+ |
+--------+---------+          |  |  API Gateway   |--->|    Lambda     | |
         |                    |  +----------------+    +-------+-------+ |
         v                    |                                |         |
+-----------------+           |                        +-------v-------+ |
|   S3 Bucket     |           |                        |   DynamoDB    | |
| (Static Website)|-- AJAX -->|                        +---------------+ |
|                 |           +------------------------------------------+
|  - index.html   |
|  - styles.css   |
|  - script.js    |
+-----------------+
    Ejercicio 4
```

## Endpoints Cubiertos

El sitio web implementa **TODOS** los endpoints del Ejercicio 2:

| Endpoint | Metodo | Funcionalidad |
|----------|--------|---------------|
| `/health` | GET | Indicador de estado en el header (verde = online, rojo = offline) |
| `/repositories` | POST | Formulario para crear nuevo repositorio |
| `/repositories` | GET | Lista todos los repositorios con stats |
| `/repositories/{id}` | GET | Modal con detalle completo del repositorio |
| `/repositories/{id}` | PUT | Formulario de edicion en modal |
| `/repositories/{id}` | DELETE | Boton de eliminar con confirmacion |

## Funcionalidades del Sitio Web

- **Health Check**: Verifica automaticamente si el API esta online (cada 30 seg)
- **Crear Repositorio**: Formulario con nombre, owner, descripcion, visibilidad y branch
- **Listar Repositorios**: Muestra todos con stars, forks, issues y fechas
- **Ver/Editar**: Modal con todos los campos editables
- **Eliminar**: Con confirmacion antes de borrar

## Requisitos

1. **Desplegar primero el Ejercicio 2** (API + Lambda + DynamoDB)
2. Copiar la URL del API
3. Configurar la URL en `website/script.js`
4. Desplegar el Ejercicio 4 (sitio web)

## Despliegue Paso a Paso

### Paso 1: Desplegar Ejercicio 2

```bash
npm run deploy:crud
```

Guarda la URL que aparece en `ApiUrl`:
```
Outputs:
ApiLambdaDynamodbStack.ApiUrl = https://xxxxxx.execute-api.us-east-1.amazonaws.com/v1/
```

### Paso 2: Configurar la URL en el sitio web

Edita `website/script.js` y reemplaza `API_URL_PLACEHOLDER`:

```javascript
const API_BASE_URL = 'https://xxxxxx.execute-api.us-east-1.amazonaws.com/v1/';
```

### Paso 3: Desplegar Ejercicio 4

```bash
npm run deploy:website
```

### Paso 4: Abrir el sitio

Usa la URL de CloudFront que aparece en los outputs:
```
Outputs:
S3StaticWebsiteStack.CloudFrontURL = https://dxxxxxx.cloudfront.net
```

## Comandos Disponibles

| Comando | Descripcion |
|---------|-------------|
| `npm run deploy:crud` | Despliega Ejercicio 2 (API + DynamoDB) |
| `npm run deploy:website` | Despliega Ejercicio 4 (S3 + CloudFront) |
| `npm run destroy:website` | Elimina Ejercicio 4 |
| `npm run destroy:crud` | Elimina Ejercicio 2 |

## Estructura de Archivos

```
├── lib/stacks/
│   ├── api-lambda-dynamodb-stack.ts  # Ejercicio 2: API + Lambda + DynamoDB
│   └── s3-static-website-stack.ts    # Ejercicio 4: S3 + CloudFront
├── lambda/
│   └── repositories-crud/
│       └── index.js                  # Lambda CRUD con CORS
├── website/
│   ├── index.html                    # Pagina principal con formularios
│   ├── styles.css                    # Estilos responsive
│   └── script.js                     # Logica CRUD completa
└── bin/
    └── s3-static-website.ts          # Entry point Ejercicio 4
```

## Relacion entre Ejercicios

| Ejercicio | Stack | Que hace |
|-----------|-------|----------|
| 1 | HelloLambdaStack | Lambda "Hello World" |
| 2 | ApiLambdaDynamodbStack | API Gateway + Lambda + DynamoDB (CRUD) |
| 3 | S3DynamoSyncStack | S3 eventos -> Lambda -> DynamoDB |
| **4** | S3StaticWebsiteStack | S3 sitio web que consume API del Ej. 2 |

## Puntos Extra Implementados

- [x] CloudFront CDN configurado con HTTPS
- [x] Cache optimizado para archivos estaticos
- [x] Redirect automatico de HTTP a HTTPS

## Limpieza

Para eliminar todos los recursos:

```bash
# Primero el sitio web
npm run destroy:website

# Luego el API
npm run destroy:crud
```

## Troubleshooting

### El indicador de health esta rojo
- Verifica que el Ejercicio 2 este desplegado
- Verifica que la URL en `script.js` sea correcta
- Redespliega el Ejercicio 2: `npm run deploy:crud`

### Error CORS al llamar la API
- El Ejercicio 2 ya tiene CORS configurado
- Redespliega: `npm run deploy:crud`

### El sitio muestra "Configura API_BASE_URL"
- Edita `website/script.js` con la URL correcta
- Redespliega: `npm run deploy:website`

### CloudFront muestra contenido viejo
- Espera unos minutos (cache de CloudFront)
- O crea una invalidation en la consola de AWS CloudFront
