FROM quay.io/keycloak/keycloak:24.0.4

# Descargar el driver MySQL
COPY mysql-connector-j-8.0.33.jar /opt/keycloak/providers/

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]