-- Databases
CREATE DATABASE IF NOT EXISTS tfm_users   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS tfm_events  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS tfm_surveys CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Users (RW)
CREATE USER IF NOT EXISTS 'tfm_users_rw'@'%'   IDENTIFIED BY 'tfm_users_password';
CREATE USER IF NOT EXISTS 'tfm_events_rw'@'%'  IDENTIFIED BY 'tfm_events_password';
CREATE USER IF NOT EXISTS 'tfm_surveys_rw'@'%' IDENTIFIED BY 'tfm_surveys_password';

GRANT ALL PRIVILEGES ON tfm_users.*   TO 'tfm_users_rw'@'%';
GRANT ALL PRIVILEGES ON tfm_events.*  TO 'tfm_events_rw'@'%';
GRANT ALL PRIVILEGES ON tfm_surveys.* TO 'tfm_surveys_rw'@'%';

FLUSH PRIVILEGES;