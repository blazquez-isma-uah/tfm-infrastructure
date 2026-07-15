# Arranque limpio desde cero

Checklist para levantar el stack completo en otro ordenador, desde un clon limpio, con Docker Compose, base de datos, Keycloak y microservicios.

## 1. Requisitos previos

- Instala Docker Desktop con Docker Compose v2.
- Instala Git.
- Instala Maven y Java si vas a compilar los microservicios en local.
- Instala Node.js si vas a compilar el frontend en local.
- En Windows, asegúrate de que Docker Desktop comparte el disco donde vas a clonar los repositorios.
- Si vas a usar el bootstrap de Keycloak, instala `jq` y `curl`.

## 2. Estructura esperada de carpetas

Clona los repositorios al mismo nivel que esta carpeta `infrastructure`:

```text
TFM Bandas/
  infrastructure/
  users/
  events/
  gateway/
  identity/
  surveys/
  front-web/
```

El fichero `env/local.env` usa rutas relativas:

- `../users`
- `../events`
- `../gateway`
- `../identity`
- `../surveys`
- `../front-web`

## 3. Clonado inicial

1. Crea una carpeta de trabajo vacia.
2. Clona este repositorio en `infrastructure`.
3. Clona los repos de `users`, `events`, `gateway`, `identity`, `surveys` y `front-web` en rutas vecinas.
4. Comprueba que las rutas del punto 2 existen exactamente como se han escrito.

## 4. Verificacion de ficheros clave

Antes de arrancar, revisa estos puntos:

- [env/local.env](env/local.env) apunta a las rutas correctas de los repos vecinos.
- [config/keycloak/Dockerfile](config/keycloak/Dockerfile) descarga el driver MySQL de forma directa.
- [mysql/init.d/00-init.sql](mysql/init.d/00-init.sql) existe y crea las bases y usuarios necesarios.
- [docker-compose.yml](docker-compose.yml) y [docker-compose.override.yml](docker-compose.override.yml) estan presentes en la carpeta `infrastructure`.

## 5. Compilacion previa de los servicios

Los contenedores de backend y frontend esperan artefactos ya compilados en los repos vecinos.

### Backend Java

En cada repo backend:

```bash
mvn clean package -DskipTests
```

Asegurate de que exista el JAR esperado en `target/`.

### Frontend

En `front-web`:

```bash
npm install
npm run build:docker
```

## 6. Arranque limpio de base de datos y voluemenes

Si quieres empezar desde cero de verdad, elimina los voluemenes del stack antes del primer arranque:

```bash
docker compose --env-file env/local.env down --volumes
```

Esto obliga a que MySQL ejecute otra vez el script de inicializacion y recree:

- `tfm_users`
- `tfm_events`
- `tfm_surveys`
- los usuarios MySQL asociados

## 7. Arranque del stack

Desde la carpeta `infrastructure`:

```bash
docker compose --env-file env/local.env up -d --build
```

Orden esperado de puesta en marcha:

1. `keycloak-mysql`
2. `mysql`
3. `keycloak`
4. `users`, `events`, `surveys`, `identity`
5. `gateway`
6. `frontend`

## 8. Verificacion rapida

Comprueba el estado de los contenedores:

```bash
docker compose --env-file env/local.env ps
```

Comprueba logs si algo no arranca:

```bash
docker compose --env-file env/local.env logs -f
```

## 9. URLs y puertos

Puertos publicados en el host:

- Frontend: `http://localhost:5173`
- Gateway: `http://localhost:8085`
- Keycloak: `http://localhost:8080`
- Users: `http://localhost:8081`
- Events: `http://localhost:8083`
- Surveys: `http://localhost:8084`
- Identity: `http://localhost:8086`
- MySQL negocio: `localhost:3307`
- MySQL Keycloak: `localhost:3308`

Nota: dentro de los contenedores Java, las aplicaciones siguen escuchando en `8080`.

## 10. Bootstrap opcional de Keycloak

Si quieres recrear realm, roles y usuarios por API, ejecuta:

```bash
bash config/keycloak/keycloak_bootstrap.sh
```

Requisitos:

- `jq`
- `curl`
- Keycloak levantado en `http://localhost:8080`

## 11. Problemas tipicos

- Si Keycloak no arranca, revisa el build de `config/keycloak/Dockerfile`.
- Si una app backend aparece como unhealthy, revisa que el healthcheck apunte a `8080` dentro del contenedor.
- Si no se crean las bases, borra los voluemenes y vuelve a levantar el stack.
- Si una ruta absoluta no existe, revisa `env/local.env` y la estructura de carpetas vecinas.

## 12. Resumen minimo

```bash
# 1. Clonar todos los repos al mismo nivel
# 2. Compilar backend y frontend
# 3. docker compose --env-file env/local.env down --volumes
# 4. docker compose --env-file env/local.env up -d --build
# 5. Revisar docker compose --env-file env/local.env ps
```
