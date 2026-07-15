# Guía rápida Docker/Docker Compose - TFM Bandas

Cheat sheet breve para desarrollo diario. Cubre backend + frontend sin `profiles`.

## 0) Referencia rápida
- Servicios: `keycloak`, `keycloak-mysql`, `mysql`, `users`, `events`, `surveys`, `identity`, `gateway`, `frontend`
- Backend: `users events surveys identity gateway`
- Siempre: `--env-file env/local.env`

---

## 1) Arranque

```bash
# Todo (build completo)
docker compose --env-file env/local.env up -d --build

# Todo (sin rebuild)
docker compose --env-file env/local.env up -d

# Patrón por servicios
docker compose --env-file env/local.env up -d <servicio1> <servicio2> ...

# Solo un servicio sin dependencias
docker compose --env-file env/local.env up -d --no-deps <SERVICIO>
```

Ejemplos frecuentes:
```bash
# BBDD
docker compose --env-file env/local.env up -d mysql keycloak-mysql

# Auth
docker compose --env-file env/local.env up -d keycloak keycloak-mysql

# Backend completo
docker compose --env-file env/local.env up -d users events surveys identity gateway keycloak mysql

# Frontend + backend principal
docker compose --env-file env/local.env up -d frontend gateway users events surveys keycloak
```

---

## 2) Parar / reiniciar / borrar

```bash
# Parar
docker compose --env-file env/local.env stop
docker compose --env-file env/local.env stop <SERVICIO>

# Reiniciar
docker compose --env-file env/local.env restart
docker compose --env-file env/local.env restart <SERVICIO>

# Bajar
docker compose --env-file env/local.env down
docker compose --env-file env/local.env down --volumes   # destructivo

# Recrear servicio
docker compose --env-file env/local.env up -d --force-recreate <SERVICIO>
```

---

## 3) Build

```bash
docker compose --env-file env/local.env build
docker compose --env-file env/local.env build <SERVICIO>
docker compose --env-file env/local.env build --no-cache <SERVICIO>
docker compose --env-file env/local.env up -d --build <SERVICIO>
```

---

## 4) Logs y estado

```bash
docker compose --env-file env/local.env ps
docker compose --env-file env/local.env logs
docker compose --env-file env/local.env logs -f
docker compose --env-file env/local.env logs -f <SERVICIO>
docker compose --env-file env/local.env logs --tail=100 <SERVICIO>
docker compose --env-file env/local.env logs <SERVICIO> > logs_<SERVICIO>.txt
docker stats
```

---

## 5) Ejecutar dentro de contenedores

```bash
# Shell / comando
docker compose --env-file env/local.env exec <SERVICIO> sh
docker compose --env-file env/local.env exec <SERVICIO> <comando>
```

Ejemplos:
```bash
# JWKS desde users/events
docker compose --env-file env/local.env exec users  wget -q -O- http://keycloak:8080/realms/tfm-bandas/protocol/openid-connect/certs
docker compose --env-file env/local.env exec events wget -q -O- http://keycloak:8080/realms/tfm-bandas/protocol/openid-connect/certs

# Health de gateway desde frontend
docker compose --env-file env/local.env exec frontend wget -q -O- http://gateway:8080/actuator/health

# Config nginx frontend
docker compose --env-file env/local.env exec frontend cat /etc/nginx/nginx.conf
```

---

## 6) MySQL (operaciones clave)

```bash
# Entrar a MySQL principal
docker compose --env-file env/local.env exec mysql mysql -uroot -proot

# SQL rápido
docker compose --env-file env/local.env exec mysql mysql -uroot -proot -e "SHOW DATABASES;"

# Backup/restore
docker compose --env-file env/local.env exec mysql mysqldump -uroot -proot tfm_users > backup_users.sql
docker compose --env-file env/local.env exec -T mysql mysql -uroot -proot tfm_users < backup_users.sql
```

---

## 7) Inspección / red

```bash
docker compose --env-file env/local.env config
docker compose --env-file env/local.env config --services
docker network inspect tfm-bandas_tfm_net
docker compose --env-file env/local.env top <SERVICIO>
```

---

## 8) Flujos de trabajo cortos

### A) Backend Java
```bash
# En repo del microservicio
mvn clean package -DskipTests

# En infrastructure
docker compose --env-file env/local.env restart <SERVICIO_BACKEND>
docker compose --env-file env/local.env logs -f <SERVICIO_BACKEND>
```
Nota: `docker-compose.override.yml` ya monta `target/app.jar` para backend.

### B) Frontend en Docker
```bash
# En ../front-web
npm run build:docker

# En infrastructure
docker compose --env-file env/local.env up -d --build frontend
# Solo frontend (sin reiniciar keycloak, users, events, gateway)
docker compose --env-file env/local.env up -d --no-deps --build frontend
docker compose --env-file env/local.env logs -f frontend

# O más rápido si solo necesita reiniciar:
docker compose --env-file env/local.env restart frontend
```

### C) Frontend con hot reload local
```bash
# En ../front-web
npm run dev

# Backend en Docker
docker compose --env-file env/local.env up -d users events surveys identity gateway keycloak mysql
```

### D) Reset total
```bash
docker compose --env-file env/local.env down --volumes
docker image prune -a
docker compose --env-file env/local.env up -d --build
```

---

## 9) URLs
- Frontend: http://localhost:5173
- Gateway: http://localhost:8085
- Keycloak: http://localhost:8080
- Users: http://localhost:8081
- Events: http://localhost:8083
- Surveys: http://localhost:8084
- Identity: http://localhost:8086
- MySQL principal: `localhost:3307`
- MySQL Keycloak: `localhost:3308`

Nota: esos puertos son los publicados en el host. Dentro de cada contenedor, las apps Java siguen escuchando en 8080.

---

## 10) Troubleshooting express

```bash
# Diagnóstico base
docker compose --env-file env/local.env ps
docker compose --env-file env/local.env logs --tail=200 <SERVICIO>

# Frontend no carga
docker compose --env-file env/local.env logs frontend
docker compose --env-file env/local.env exec frontend ls -la /usr/share/nginx/html/

# Frontend no llega a backend
docker compose --env-file env/local.env ps gateway
docker compose --env-file env/local.env exec frontend wget -q -O- http://gateway:8080/actuator/health

# Keycloak con problemas
docker compose --env-file env/local.env logs keycloak-mysql
docker compose --env-file env/local.env restart keycloak
```

---

Última revisión: marzo 2026
