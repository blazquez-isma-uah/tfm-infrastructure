# Guía de Comandos Docker y Docker Compose - TFM Bandas

Esta guía contiene todos los comandos útiles de Docker y Docker Compose para el desarrollo del proyecto TFM Bandas.

---

## 📋 Índice

1. [Comandos de Inicio y Construcción](#comandos-de-inicio-y-construcción)
2. [Comandos de Parada y Limpieza](#comandos-de-parada-y-limpieza)
3. [Comandos de Logs y Monitorización](#comandos-de-logs-y-monitorización)
4. [Comandos de Ejecución en Contenedores](#comandos-de-ejecución-en-contenedores)
5. [Comandos de Desarrollo y Recarga](#comandos-de-desarrollo-y-recarga)
6. [Comandos de Inspección y Debugging](#comandos-de-inspección-y-debugging)
7. [Comandos de Base de Datos](#comandos-de-base-de-datos)
8. [Comandos de Volúmenes y Limpieza](#comandos-de-volúmenes-y-limpieza)
9. [Comandos de Red](#comandos-de-red)
10. [Comandos Útiles de Maven](#comandos-útiles-de-maven)

---

## 🚀 Comandos de Inicio y Construcción

### Arrancar todos los servicios (construcción completa)
```bash
docker compose --env-file env/local.env up -d --build
```
Levanta toda la infraestructura: Keycloak, MySQL, microservicios (users, events, surveys, identity), gateway y frontend, construyendo las imágenes desde cero.

### Arrancar todos los servicios (sin reconstruir)
```bash
docker compose --env-file env/local.env up -d
```
Levanta todos los servicios usando las imágenes ya construidas.

### Arrancar solo las bases de datos
```bash
docker compose --env-file env/local.env up -d mysql keycloak-mysql
```
Levanta únicamente las bases de datos MySQL (principal y de Keycloak).

### Arrancar solo Keycloak y sus dependencias
```bash
docker compose --env-file env/local.env up -d keycloak keycloak-mysql
```
Levanta Keycloak con su base de datos MySQL dedicada.

### Arrancar servicio de usuarios y sus dependencias
```bash
docker compose --env-file env/local.env up -d users mysql keycloak
```
Levanta el microservicio de usuarios con Keycloak y MySQL.

### Arrancar servicio de eventos y sus dependencias
```bash
docker compose --env-file env/local.env up -d events mysql keycloak
```
Levanta el microservicio de eventos con Keycloak y MySQL.

### Arrancar servicio de encuestas y sus dependencias
```bash
docker compose --env-file env/local.env up -d surveys mysql keycloak
```
Levanta el microservicio de encuestas con Keycloak y MySQL.

### Arrancar servicio de identidad y sus dependencias
```bash
docker compose --env-file env/local.env up -d identity keycloak
```
Levanta el microservicio de identidad con Keycloak.

### Arrancar gateway y sus dependencias
```bash
docker compose --env-file env/local.env up -d gateway users events surveys keycloak
```
Levanta el gateway con todos los microservicios necesarios.

### Arrancar frontend y sus dependencias
```bash
docker compose --env-file env/local.env up -d frontend gateway users events surveys keycloak
```
Levanta el frontend con el gateway y todos los microservicios backend necesarios.

### Arrancar solo el frontend (si gateway ya está corriendo)
```bash
docker compose --env-file env/local.env up -d frontend
```
Levanta solo el servicio frontend (requiere que gateway esté disponible).

### Arrancar solo un servicio específico (sin dependencias)
```bash
docker compose --env-file env/local.env up -d --no-deps users
```
Levanta solo el servicio de usuarios sin sus dependencias (útil si ya están corriendo).

### Reconstruir y arrancar un servicio específico
```bash
docker compose --env-file env/local.env up -d --build users
```
Reconstruye y levanta el servicio de usuarios.

### Arrancar con logs en primer plano (sin -d)
```bash
docker compose --env-file env/local.env up users
```
Levanta el servicio mostrando los logs en consola (útil para debugging).

---

## 🛑 Comandos de Parada y Limpieza

### Parar todos los servicios (sin eliminar contenedores)
```bash
docker compose --env-file env/local.env stop
```
Detiene todos los contenedores pero los mantiene para poder reiniciarlos rápidamente.

### Parar un servicio específico
```bash
docker compose --env-file env/local.env stop users
```
Detiene solo el servicio de usuarios.

### Bajar todos los servicios (elimina contenedores y red)
```bash
docker compose --env-file env/local.env down
```
Detiene y elimina todos los contenedores, redes creadas, pero mantiene los volúmenes.

### Bajar todo incluyendo volúmenes (elimina datos)
```bash
docker compose --env-file env/local.env down --volumes
```
⚠️ **CUIDADO**: Elimina todo incluyendo los datos de las bases de datos.

### Bajar todo eliminando también las imágenes
```bash
docker compose --env-file env/local.env down --rmi all
```
Elimina contenedores, redes e imágenes Docker creadas.

### Reiniciar todos los servicios
```bash
docker compose --env-file env/local.env restart
```
Reinicia todos los contenedores (útil después de cambios en variables de entorno).

### Reiniciar un servicio específico
```bash
docker compose --env-file env/local.env restart users
```
Reinicia solo el servicio de usuarios (útil después de recompilar con Maven).

---

## 📊 Comandos de Logs y Monitorización

### Ver logs de todos los servicios
```bash
docker compose --env-file env/local.env logs
```
Muestra los logs de todos los servicios.

### Ver logs en tiempo real (seguimiento)
```bash
docker compose --env-file env/local.env logs -f
```
Muestra logs de todos los servicios en tiempo real.

### Ver logs de un servicio específico
```bash
docker compose --env-file env/local.env logs users
```
Muestra los logs del servicio de usuarios.

### Ver logs de un servicio en tiempo real
```bash
docker compose --env-file env/local.env logs -f users
```
Sigue los logs del servicio de usuarios en tiempo real.

### Ver logs de múltiples servicios específicos
```bash
docker compose --env-file env/local.env logs -f users events gateway
```
Sigue los logs de usuarios, eventos y gateway simultáneamente.

### Ver logs del frontend
```bash
docker compose --env-file env/local.env logs -f frontend
```
Sigue los logs del servicio frontend en tiempo real.

### Ver últimas N líneas de logs
```bash
docker compose --env-file env/local.env logs --tail=100 users
```
Muestra las últimas 100 líneas de logs del servicio de usuarios.

### Ver logs con timestamps
```bash
docker compose --env-file env/local.env logs -f -t users
```
Muestra logs con marca de tiempo.

### Listar todos los contenedores y su estado
```bash
docker compose --env-file env/local.env ps
```
Muestra el estado de todos los servicios (corriendo, detenido, etc.).

### Ver recursos utilizados por los contenedores
```bash
docker stats
```
Muestra CPU, memoria, red y I/O de todos los contenedores en tiempo real.

### Ver recursos de contenedores específicos
```bash
docker stats tfm-bandas-users-1 tfm-bandas-events-1
```
Monitoriza recursos de servicios específicos.

---

## 🔧 Comandos de Ejecución en Contenedores

### Acceder a la shell de un contenedor
```bash
docker compose --env-file env/local.env exec users sh
```
Abre una terminal interactiva dentro del contenedor de usuarios.

### Ejecutar comando en un contenedor sin entrar
```bash
docker compose --env-file env/local.env exec users ls -la /app
```
Lista los archivos del directorio /app en el contenedor de usuarios.

### Verificar JWKS desde el contenedor de usuarios
```bash
docker compose --env-file env/local.env exec users curl -X GET http://keycloak:8080/realms/tfm-bandas/protocol/openid-connect/certs
```
Comprueba que el servicio de usuarios puede acceder al endpoint JWKS de Keycloak.

### Verificar JWKS desde el contenedor de eventos
```bash
docker compose --env-file env/local.env exec events wget -q -O- http://keycloak:8080/realms/tfm-bandas/protocol/openid-connect/certs
```
Comprueba la conectividad con Keycloak desde eventos.

### Verificar conectividad entre servicios
```bash
docker compose --env-file env/local.env exec gateway curl -I http://users:8080/actuator/health
```
Comprueba que el gateway puede comunicarse con el servicio de usuarios.

### Verificar variables de entorno en un contenedor
```bash
docker compose --env-file env/local.env exec users env | grep SPRING
```
Lista todas las variables de entorno que empiezan con SPRING.

### Ejecutar comando como root en el contenedor
```bash
docker compose --env-file env/local.env exec -u root users apk add curl
```
Instala curl en el contenedor (útil para debugging).

### Acceder a la shell del contenedor frontend
```bash
docker compose --env-file env/local.env exec frontend sh
```
Abre una terminal interactiva dentro del contenedor frontend (Nginx).

### Verificar conectividad desde frontend al gateway
```bash
docker compose --env-file env/local.env exec frontend wget -q -O- http://gateway:8080/actuator/health
```
Verifica que el frontend puede comunicarse con el gateway.

### Ver configuración de Nginx en el frontend
```bash
docker compose --env-file env/local.env exec frontend cat /etc/nginx/nginx.conf
```
Muestra la configuración de Nginx del contenedor frontend.

---

## 🔄 Comandos de Desarrollo y Recarga

### Flujo completo de desarrollo (después de cambios en código)
```bash
# 1. Navegar al proyecto (ejemplo: users)
cd "../users"

# 2. Compilar con Maven (sin tests para rapidez)
mvn clean package -DskipTests

# 3. Volver a infrastructure
cd "../infrastructure"

# 4. Reiniciar el servicio
docker compose --env-file env/local.env restart users
```
Ciclo completo para aplicar cambios en el código sin reconstruir la imagen Docker.

### Recompilar y reiniciar todos los microservicios
```bash
# Compilar todos los proyectos Java
cd "../users" && mvn clean package -DskipTests && cd "../infrastructure"
cd "../events" && mvn clean package -DskipTests && cd "../infrastructure"
cd "../surveys" && mvn clean package -DskipTests && cd "../infrastructure"
cd "../identity" && mvn clean package -DskipTests && cd "../infrastructure"
cd "../gateway" && mvn clean package -DskipTests && cd "../infrastructure"

# Reiniciar todos los servicios backend
docker compose --env-file env/local.env restart users events surveys identity gateway
```
Actualiza todos los microservicios backend con cambios recientes.

### Desarrollo con el frontend (React/Vue/Angular)
```bash
# 1. Editar código en ../front-web/src/...

# 2. Compilar/Construir el frontend (ejemplo con npm)
cd "../front-web" && npm run build && cd "../infrastructure"

# 3. Reconstruir y reiniciar el contenedor frontend
docker compose --env-file env/local.env up -d --build frontend

# 4. Ver logs para verificar
docker compose --env-file env/local.env logs -f frontend
```
Ciclo completo para aplicar cambios en el código del frontend.

### Reiniciar frontend sin reconstruir
```bash
docker compose --env-file env/local.env restart frontend
```
Reinicia el contenedor frontend (útil si solo cambiaron variables de entorno).

### Forzar recreación de un servicio
```bash
docker compose --env-file env/local.env up -d --force-recreate users
```
Recrea el contenedor desde cero sin reconstruir la imagen.

### Reconstruir imágenes sin usar caché
```bash
docker compose --env-file env/local.env build --no-cache users
```
Reconstruye la imagen del servicio ignorando la caché de Docker.

### Actualizar servicio con nueva imagen
```bash
docker compose --env-file env/local.env up -d --build --no-deps users
```
Reconstruye solo el servicio de usuarios sin afectar dependencias.

---

## 🔍 Comandos de Inspección y Debugging

### Inspeccionar configuración del servicio
```bash
docker compose --env-file env/local.env config
```
Muestra la configuración final de docker-compose (con variables interpoladas).

### Ver configuración de un servicio específico
```bash
docker compose --env-file env/local.env config --services
```
Lista todos los servicios definidos.

### Verificar health checks
```bash
docker inspect tfm-bandas-users-1 | grep -A 10 Health
```
Muestra el estado del health check del contenedor de usuarios.

### Ver puertos expuestos
```bash
docker compose --env-file env/local.env ps --format json | jq '.[].Publishers'
```
Lista todos los puertos publicados por los servicios.

### Inspeccionar red
```bash
docker network inspect tfm-bandas_tfm_net
```
Muestra información detallada de la red Docker, incluyendo IPs asignadas.

### Ver procesos corriendo en un contenedor
```bash
docker compose --env-file env/local.env top users
```
Muestra los procesos que se ejecutan dentro del contenedor de usuarios.

### Ver eventos de Docker en tiempo real
```bash
docker events --filter 'network=tfm-bandas_tfm_net'
```
Muestra eventos relacionados con la red del proyecto.

### Verificar health de todos los servicios
```bash
docker compose --env-file env/local.env ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
```
Muestra una tabla con nombre, estado y puertos de todos los servicios.

### Exportar logs a archivo
```bash
docker compose --env-file env/local.env logs users > logs_users.txt
```
Guarda los logs del servicio de usuarios en un archivo.

---

## 💾 Comandos de Base de Datos

### Acceder a MySQL principal
```bash
docker compose --env-file env/local.env exec mysql mysql -uroot -proot
```
Abre la consola MySQL como root.

### Acceder a base de datos de usuarios
```bash
docker compose --env-file env/local.env exec mysql mysql -utfm_users_rw -ptfm_users_password tfm_users
```
Conecta directamente a la base de datos de usuarios.

### Acceder a base de datos de eventos
```bash
docker compose --env-file env/local.env exec mysql mysql -utfm_events_rw -ptfm_events_password tfm_events
```
Conecta directamente a la base de datos de eventos.

### Acceder a base de datos de encuestas
```bash
docker compose --env-file env/local.env exec mysql mysql -utfm_surveys_rw -ptfm_surveys_password tfm_surveys
```
Conecta directamente a la base de datos de encuestas.

### Acceder a MySQL de Keycloak
```bash
docker compose --env-file env/local.env exec keycloak-mysql mysql -ukeycloak -pkeycloakpass keycloak
```
Abre la consola de la base de datos de Keycloak.

### Backup de base de datos
```bash
docker compose --env-file env/local.env exec mysql mysqldump -uroot -proot tfm_users > backup_users.sql
```
Exporta la base de datos de usuarios a un archivo SQL.

### Restaurar base de datos desde backup
```bash
docker compose --env-file env/local.env exec -T mysql mysql -uroot -proot tfm_users < backup_users.sql
```
Importa un backup SQL a la base de datos de usuarios.

### Ejecutar script SQL en la base de datos
```bash
docker compose --env-file env/local.env exec -T mysql mysql -uroot -proot tfm_users < ./mysql/init.d/00-init.sql
```
Ejecuta un script SQL específico.

### Listar bases de datos
```bash
docker compose --env-file env/local.env exec mysql mysql -uroot -proot -e "SHOW DATABASES;"
```
Muestra todas las bases de datos en MySQL.

### Ver tablas de una base de datos
```bash
docker compose --env-file env/local.env exec mysql mysql -uroot -proot -e "USE tfm_users; SHOW TABLES;"
```
Lista las tablas de la base de datos de usuarios.

---

## 🧹 Comandos de Volúmenes y Limpieza

### Listar volúmenes de Docker
```bash
docker volume ls
```
Muestra todos los volúmenes Docker en el sistema.

### Inspeccionar volumen específico
```bash
docker volume inspect tfm-bandas_mysql_data
```
Muestra información detallada del volumen de datos de MySQL.

### Eliminar volumen específico (servicio debe estar parado)
```bash
docker volume rm tfm-bandas_mysql_data
```
⚠️ **CUIDADO**: Elimina permanentemente el volumen de datos de MySQL.

### Limpiar volúmenes no utilizados
```bash
docker volume prune
```
Elimina todos los volúmenes que no están siendo usados por ningún contenedor.

### Limpiar todo el sistema Docker (contenedores, redes, imágenes, caché)
```bash
docker system prune -a --volumes
```
⚠️ **CUIDADO**: Limpieza agresiva de todo Docker (usar solo si hay problemas de espacio).

### Limpiar imágenes no utilizadas
```bash
docker image prune -a
```
Elimina todas las imágenes que no están siendo usadas por contenedores.

### Ver espacio utilizado por Docker
```bash
docker system df
```
Muestra cuánto espacio ocupan imágenes, contenedores, volúmenes y caché.

### Backup de volumen
```bash
docker run --rm -v tfm-bandas_mysql_data:/data -v $(pwd):/backup alpine tar czf /backup/mysql_data_backup.tar.gz -C /data .
```
Crea un backup comprimido del volumen de MySQL.

### Restaurar volumen desde backup
```bash
docker run --rm -v tfm-bandas_mysql_data:/data -v $(pwd):/backup alpine tar xzf /backup/mysql_data_backup.tar.gz -C /data
```
Restaura un volumen desde un archivo de backup.

---

## 🌐 Comandos de Red

### Listar redes Docker
```bash
docker network ls
```
Muestra todas las redes Docker disponibles.

### Inspeccionar la red del proyecto
```bash
docker network inspect tfm-bandas_tfm_net
```
Muestra configuración detallada y contenedores conectados a la red.

### Eliminar red (todos los servicios deben estar parados)
```bash
docker network rm tfm-bandas_tfm_net
```
Elimina la red del proyecto.

### Conectar un contenedor a la red
```bash
docker network connect tfm-bandas_tfm_net <container_name>
```
Conecta un contenedor externo a la red del proyecto.

### Desconectar un contenedor de la red
```bash
docker network disconnect tfm-bandas_tfm_net <container_name>
```
Desconecta un contenedor de la red.

### Probar conectividad entre contenedores
```bash
docker compose --env-file env/local.env exec users ping -c 3 keycloak
```
Verifica conectividad de red entre usuarios y Keycloak.

---

## 🎨 Comandos Específicos para Frontend

### Construir el proyecto frontend
```bash
cd ../front-web
npm run build
# o con yarn
yarn build
```
Compila el proyecto frontend (React/Vue/Angular) para producción.

### Ejecutar frontend en modo desarrollo (fuera de Docker)
```bash
cd ../front-web
npm run dev
# o
npm start
```
Inicia el servidor de desarrollo con hot-reload automático (generalmente en puerto 5173 o 3000).

### Instalar dependencias del frontend
```bash
cd ../front-web
npm install
# o
yarn install
```
Instala todas las dependencias definidas en package.json.

### Limpiar y reconstruir frontend
```bash
cd ../front-web
rm -rf dist/ build/ node_modules/
npm install
npm run build
```
Limpieza completa y reconstrucción del frontend desde cero.

### Ver estructura de archivos del frontend en Docker
```bash
docker compose --env-file env/local.env exec frontend ls -la /usr/share/nginx/html/
```
Muestra los archivos servidos por Nginx en el contenedor.

### Actualizar configuración de Nginx en el frontend
```bash
# 1. Editar archivo de configuración (si existe en el proyecto)
cd ../front-web
# Editar nginx.conf o similar

# 2. Reconstruir imagen
cd ../infrastructure
docker compose --env-file env/local.env up -d --build frontend
```

### Verificar rutas y assets del frontend
```bash
docker compose --env-file env/local.env exec frontend find /usr/share/nginx/html -type f
```
Lista todos los archivos servidos por el frontend.

---

## ☕ Comandos Útiles de Maven

### Compilar proyecto sin tests
```bash
mvn clean package -DskipTests
```
Compila el proyecto y genera el JAR sin ejecutar tests.

### Compilar proyecto con tests
```bash
mvn clean package
```
Compila el proyecto y ejecuta todos los tests.

### Ejecutar solo tests
```bash
mvn test
```
Ejecuta únicamente los tests del proyecto.

### Limpiar proyecto
```bash
mvn clean
```
Elimina el directorio target con todos los archivos compilados.

### Ver dependencias del proyecto
```bash
mvn dependency:tree
```
Muestra el árbol de dependencias del proyecto.

### Actualizar dependencias
```bash
mvn versions:display-dependency-updates
```
Muestra qué dependencias tienen actualizaciones disponibles.

### Instalar en repositorio local
```bash
mvn clean install -DskipTests
```
Compila e instala el proyecto en el repositorio Maven local.

---

## 🎯 Escenarios Comunes de Uso

### Escenario 1: Primer arranque del proyecto
```bash
# Levantar toda la infraestructura por primera vez
docker compose --env-file env/local.env up -d --build

# Esperar a que todo esté listo (puede tomar 2-3 minutos)
docker compose --env-file env/local.env logs -f

# Verificar que todo está corriendo
docker compose --env-file env/local.env ps
```

### Escenario 2: Desarrollo diario (trabajando en el servicio users)
```bash
# 1. Editar código en ../users/src/...

# 2. Compilar
cd "../users" && mvn clean package -DskipTests && cd "../infrastructure"

# 3. Reiniciar servicio
docker compose --env-file env/local.env restart users

# 4. Ver logs para verificar
docker compose --env-file env/local.env logs -f users
```

### Escenario 3: Reset completo del entorno
```bash
# Bajar todo y eliminar volúmenes
docker compose --env-file env/local.env down --volumes

# Limpiar imágenes antiguas
docker image prune -a

# Levantar desde cero
docker compose --env-file env/local.env up -d --build
```

### Escenario 4: Debugging de problemas de conectividad
```bash
# Ver estado de la red
docker network inspect tfm-bandas_tfm_net

# Verificar health checks
docker compose --env-file env/local.env ps

# Probar conectividad desde gateway a users
docker compose --env-file env/local.env exec gateway curl http://users:8080/actuator/health

# Ver logs de todos los servicios relevantes
docker compose --env-file env/local.env logs -f gateway users keycloak
```

### Escenario 5: Actualizar Keycloak realm configuration
```bash
# Editar config/keycloak/realm-tfm-bandas.json

# Bajar y reconstruir Keycloak
docker compose --env-file env/local.env down keycloak
docker compose --env-file env/local.env up -d --build keycloak

# Verificar que importó correctamente
docker compose --env-file env/local.env logs keycloak | grep "realm"
```

### Escenario 6: Desarrollo en el frontend
```bash
# 1. Hacer cambios en el código del frontend
cd "../front-web"

# 2. Construir el proyecto frontend (ejemplo con npm/yarn)
npm run build
# o con yarn
yarn build

# 3. Volver a infrastructure
cd "../infrastructure"

# 4. Reconstruir y levantar el contenedor frontend
docker compose --env-file env/local.env up -d --build frontend

# 5. Verificar en el navegador
# Abrir http://localhost:5173

# 6. Ver logs si hay problemas
docker compose --env-file env/local.env logs -f frontend
```

### Escenario 7: Desarrollo con hot-reload del frontend (modo desarrollo)
```bash
# Opción alternativa: correr el frontend en modo desarrollo fuera de Docker
# (con hot-reload automático) y solo usar Docker para el backend

cd "../front-web"
npm run dev
# El frontend estará disponible en http://localhost:5173 con hot-reload

# Backend en Docker
cd "../infrastructure"
docker compose --env-file env/local.env up -d gateway users events surveys identity keycloak mysql
```

---

## 📌 URLs de Acceso (configuración por defecto)

- **Frontend (Aplicación Web)**: http://localhost:5173
- **Keycloak**: http://localhost:8080 (admin/admin)
- **Gateway (API REST)**: http://localhost:8085
- **Users Service**: http://localhost:8081
- **Events Service**: http://localhost:8083
- **Surveys Service**: http://localhost:8084
- **Identity Service**: http://localhost:8086
- **MySQL Principal**: localhost:3307 (root/root)
- **MySQL Keycloak**: localhost:3308 (keycloak/keycloakpass)

### 🎨 Acceso Principal para Usuarios

La **aplicación web frontend** es el punto de entrada principal para los usuarios finales. Accede a través de:

**http://localhost:5173**

El frontend se comunica con el backend a través del **Gateway** en el puerto 8085.

---

## 🛠️ Tips y Best Practices

1. **Siempre usar `--env-file env/local.env`** para garantizar que las variables de entorno se carguen correctamente.

2. **Usar `-d` (detached mode)** para que los contenedores corran en segundo plano.

3. **Compilar con `-DskipTests`** durante desarrollo para mayor rapidez (microservicios Java).

4. **El docker-compose.override.yml** monta los JARs como volúmenes, permitiendo hot-reload sin reconstruir imágenes (solo para servicios Java).

5. **Health checks**: Los servicios tienen health checks configurados, usa `docker compose ps` para ver su estado.

6. **Order matters**: MySQL y Keycloak deben estar listos antes de los microservicios, y el Gateway debe estar listo antes del Frontend (las dependencias están configuradas).

7. **Logs persistentes**: Para guardar logs importantes, redirige la salida a archivos.

8. **Backups regulares**: Haz backup de los volúmenes antes de hacer cambios destructivos.

9. **Network isolation**: Todos los servicios están en la red `tfm_net`, aislados del host excepto por los puertos publicados.

10. **Restart policy**: Los servicios no tienen restart policy automática (por defecto en desarrollo).

11. **Desarrollo Frontend**: Para desarrollo activo del frontend, considera ejecutarlo fuera de Docker (con `npm run dev`) para aprovechar hot-reload, y usar Docker solo para el backend.

12. **Frontend en Docker**: El frontend usa Nginx para servir archivos estáticos. Cualquier cambio requiere reconstruir con `npm run build` y luego reconstruir la imagen Docker.

13. **CORS**: Si el frontend en desarrollo (fuera de Docker) no puede comunicarse con el backend, verifica la configuración CORS en el Gateway.

14. **Variables de entorno del Frontend**: Si el frontend usa variables de entorno (API URLs), asegúrate de que estén correctamente configuradas durante el build (usando archivos .env o similar).

15. **Caché del navegador**: Si no ves cambios en el frontend, limpia la caché del navegador o usa modo incógnito.

---

## 🆘 Troubleshooting

### Los servicios no se comunican entre sí
```bash
# Verificar que todos están en la misma red
docker network inspect tfm-bandas_tfm_net

# Verificar DNS interno
docker compose exec users nslookup keycloak
```

### Un servicio no arranca
```bash
# Ver logs detallados
docker compose --env-file env/local.env logs --tail=200 users

# Verificar health check
docker inspect tfm-bandas-users-1 | grep -A 10 Health
```

### Base de datos corrupta
```bash
# Restaurar desde backup
docker compose down
docker volume rm tfm-bandas_mysql_data
docker compose up -d mysql
# Importar backup
```

### Keycloak no responde
```bash
# Verificar que MySQL de Keycloak está listo
docker compose logs keycloak-mysql

# Reiniciar Keycloak
docker compose restart keycloak

# Dar más tiempo al start_period si es necesario (editar docker-compose.yml)
```

### Cambios en código no se reflejan
```bash
# Verificar que el JAR se compiló
ls -lh ../users/target/app.jar

# Verificar que el volumen está montado
docker compose exec users ls -lh /app/app.jar

# Forzar restart
docker compose restart users
```

### Frontend muestra página en blanco o error 404
```bash
# Verificar que el frontend está corriendo
docker compose --env-file env/local.env ps frontend

# Ver logs del frontend
docker compose --env-file env/local.env logs frontend

# Verificar que el build se generó correctamente
cd ../front-web
ls -la dist/  # o build/ dependiendo del framework

# Reconstruir el frontend desde cero
cd ../front-web
rm -rf dist/ node_modules/
npm install
npm run build
cd ../infrastructure
docker compose --env-file env/local.env up -d --build --force-recreate frontend
```

### Frontend no puede comunicarse con el backend
```bash
# Verificar que el gateway está corriendo y saludable
docker compose --env-file env/local.env ps gateway

# Verificar desde el frontend que puede alcanzar el gateway
docker compose --env-file env/local.env exec frontend wget -q -O- http://gateway:8080/actuator/health

# Verificar configuración de API endpoint en el frontend
# (revisar variables de entorno o archivos de configuración del frontend)

# Ver logs del gateway por si hay errores CORS
docker compose --env-file env/local.env logs -f gateway
```

### Frontend tarda mucho en cargar
```bash
# Verificar recursos del contenedor
docker stats tfm-bandas-frontend-1

# Verificar health check
docker inspect tfm-bandas-frontend-1 | grep -A 10 Health

# Probar acceso directo al contenedor
curl -I http://localhost:5173
```

---

**Última actualización**: Marzo 2026
**Proyecto**: TFM Bandas - Sistema de Gestión de Bandas Musicales
