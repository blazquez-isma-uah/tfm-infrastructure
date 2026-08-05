-- initial_data.sql
-- Juego de datos de prueba para el entorno local (Docker Compose).
-- NUNCA ejecutar contra Aurora / entorno de produccion en AWS.
-- Requiere que 'realm-tfm-bandas.json' se haya importado con los mismos 15 usuarios e IDs fijos.

SET FOREIGN_KEY_CHECKS = 0;

-- ===================== LIMPIEZA =====================
USE tfm_users;
TRUNCATE TABLE user_profile_instrument;
TRUNCATE TABLE user_profile;
TRUNCATE TABLE instrument;

USE tfm_events;
TRUNCATE TABLE event;

USE tfm_surveys;
TRUNCATE TABLE survey_response;
TRUNCATE TABLE survey;

SET FOREIGN_KEY_CHECKS = 1;

-- ===================== TFM_USERS: INSTRUMENTOS =====================
USE tfm_users;
INSERT INTO instrument (id, instrument_name, voice, version) VALUES
(1, 'Director', 'Principal', 0),
(2, 'Trompeta', '1', 0),
(3, 'Trompeta', '2', 0),
(4, 'Trompeta', '3', 0),
(5, 'Clarinete', 'Principal', 0),
(6, 'Clarinete', '1', 0),
(7, 'Clarinete', '2', 0),
(8, 'Clarinete', '3', 0),
(9, 'Flauta', 'Principal', 0),
(10, 'Flauta', '1', 0),
(11, 'Flauta', '2', 0),
(12, 'Oboe', '1', 0),
(13, 'Oboe', '2', 0),
(14, 'Trompa', '1', 0),
(15, 'Trompa', '2', 0),
(16, 'Trompa', '3', 0),
(17, 'Trombon', '1', 0),
(18, 'Trombon', '2', 0),
(19, 'Bombardino', '1', 0),
(20, 'Bombardino', '2', 0),
(21, 'Tuba', '1', 0),
(22, 'Tuba', '2', 0),
(23, 'Saxofon Alto', '1', 0),
(24, 'Saxofon Alto', '2', 0),
(25, 'Saxofon Baritono', '1', 0),
(26, 'Percusion', '1', 0),
(27, 'Percusion', '2', 0),
(28, 'Percusion', '3', 0),
(29, 'Percusion', 'Timbal', 0),
(30, 'Percusion', 'Teclados', 0);

-- ===================== TFM_USERS: USUARIOS =====================
-- iam_id debe coincidir exactamente con el 'id' fijado en realm-tfm-bandas.json
INSERT INTO user_profile (id, iam_id, username, first_name, last_name, second_last_name, email, birth_date, band_join_date, system_signup_date, active, phone, notes, profile_picture_url, role_names, version) VALUES
(1, '00000000-0000-0000-0000-000000000001', 'admin', 'Admin', 'Sistema', NULL, 'admin@bandas.com', '2023-09-16', '2023-01-10', '2023-09-16', 1, '611000001', "Usuario auto generado", NULL, 'ADMIN,MUSICIAN', 0),
(2, '00000000-0000-0000-0000-000000000002', 'ismablazquez', 'Ismael', 'Blazquez', NULL, 'ismablazquez@bandas.com', '1998-05-12', '2023-02-01', '2023-09-16', 1, '611000002', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(3, '00000000-0000-0000-0000-000000000101', 'laurafernandez', 'Laura', 'Fernandez', NULL, 'laurafernandez@bandas.com', '1995-03-22', '2022-09-01', '2023-10-02', 1, '611000101', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(4, '00000000-0000-0000-0000-000000000102', 'carlosgomez', 'Carlos', 'Gomez', NULL, 'carlosgomez@bandas.com', '1990-07-14', '2021-05-15', '2023-10-03', 1, '611000102', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(5, '00000000-0000-0000-0000-000000000103', 'mariaruiz', 'Maria', 'Ruiz', NULL, 'mariaruiz@bandas.com', '2000-11-02', '2023-01-10', '2023-10-04', 1, '611000103', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(6, '00000000-0000-0000-0000-000000000104', 'javiertorres', 'Javier', 'Torres', NULL, 'javiertorres@bandas.com', '1988-01-30', '2019-03-20', '2023-10-05', 1, '611000104', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(7, '00000000-0000-0000-0000-000000000105', 'saramolina', 'Sara', 'Molina', NULL, 'saramolina@bandas.com', '1997-06-18', '2022-02-11', '2023-10-06', 1, '611000105', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(8, '00000000-0000-0000-0000-000000000106', 'diegonavarro', 'Diego', 'Navarro', NULL, 'diegonavarro@bandas.com', '1993-09-09', '2020-11-01', '2023-10-07', 1, '611000106', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(9, '00000000-0000-0000-0000-000000000107', 'luciaortega', 'Lucia', 'Ortega', NULL, 'luciaortega@bandas.com', '2001-12-25', '2023-06-01', '2023-10-08', 1, '611000107', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(10, '00000000-0000-0000-0000-000000000108', 'pabloiglesias', 'Pablo', 'Iglesias', NULL, 'pabloiglesias@bandas.com', '1985-04-04', '2018-09-01', '2023-10-09', 1, '611000108', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(11, '00000000-0000-0000-0000-000000000109', 'elenacastro', 'Elena', 'Castro', NULL, 'elenacastro@bandas.com', '1999-08-17', '2022-12-01', '2023-10-10', 1, '611000109', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(12, '00000000-0000-0000-0000-000000000110', 'adrianvega', 'Adrian', 'Vega', NULL, 'adrianvega@bandas.com', '1992-02-28', '2021-01-15', '2023-10-11', 1, '611000110', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(13, '00000000-0000-0000-0000-000000000111', 'martaserrano', 'Marta', 'Serrano', NULL, 'martaserrano@bandas.com', '1996-10-05', '2022-07-20', '2023-10-12', 1, '611000111', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(14, '00000000-0000-0000-0000-000000000112', 'alvarodominguez', 'Alvaro', 'Dominguez', NULL, 'alvarodominguez@bandas.com', '1989-05-23', '2019-10-10', '2023-10-13', 1, '611000112', "Usuario auto generado", NULL, 'MUSICIAN', 0),
(15, '00000000-0000-0000-0000-000000000113', 'cristinaherrera', 'Cristina', 'Herrera', NULL, 'cristinaherrera@bandas.com', '2002-01-15', '2023-09-01', '2023-10-14', 1, '611000113', "Usuario auto generado", NULL, 'MUSICIAN', 0);

-- ===================== TFM_USERS: INSTRUMENTOS ASIGNADOS =====================
INSERT INTO user_profile_instrument (user_profile_id, instrument_id) VALUES
(1, 1),
(2, 2),
(2, 3),
(2, 4),
(2, 11),
(3, 7),
(4, 10),
(4, 17),
(5, 13),
(6, 16),
(6, 23),
(7, 19),
(8, 22),
(8, 29),
(9, 25),
(10, 28),
(10, 5),
(11, 4),
(12, 4),
(12, 11),
(13, 7),
(14, 10),
(14, 17),
(15, 13);

-- ===================== TFM_EVENTS =====================
USE tfm_events;
INSERT INTO event (id, title, description, start_at, end_at, location, type, status, visibility, created_at, updated_at, version) VALUES
('00000000-0000-0000-0000-000000000201', 'Reunion de banda - Diciembre 2026', 'Reunion general de la banda para repasar el repertorio y organizar la agenda del mes de diciembre.', '2026-12-05 19:00:00', '2026-12-05 21:00:00', 'Local de ensayo', 'MEETING', 'SCHEDULED', 'BAND_ONLY', NOW(), NOW(), 0),
('00000000-0000-0000-0000-000000000202', 'Concierto de Navidad 2026', 'Actuacion navideña anual de la banda en el auditorio municipal.', '2026-12-20 20:00:00', '2026-12-20 22:00:00', 'Auditorio Municipal', 'PERFORMANCE', 'SCHEDULED', 'BAND_ONLY', NOW(), NOW(), 0);

-- ===================== TFM_SURVEYS: ENCUESTAS =====================
USE tfm_surveys;
INSERT INTO survey (id, event_id, title, description, status, response_type, survey_type, opens_at, closes_at, created_by, created_at, updated_at, version) VALUES
('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', 'Encuesta de asistencia a "Reunion de banda - Diciembre 2026"', 'Confirma tu asistencia a la reunion de diciembre.', 'OPEN', 'YES_NO_MAYBE', 'ATTENDANCE', '2026-07-30 10:00:00', '2026-12-04 23:59:00', '00000000-0000-0000-0000-000000000001', NOW(), NOW(), 0),
('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000202', 'Encuesta de asistencia a "Concierto de Navidad 2026"', 'Confirma tu asistencia al concierto e indica con que instrumento participas.', 'OPEN', 'YES_NO_MAYBE_WITH_INSTRUMENT', 'ATTENDANCE', '2026-07-30 10:00:00', '2026-12-19 23:59:00', '00000000-0000-0000-0000-000000000001', NOW(), NOW(), 0),
('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', 'Cena posterior al concierto', 'Encuesta para organizar la cena de despues del concierto de Navidad. Aun sin abrir.', 'DRAFT', 'YES_NO_MAYBE', 'OTHER', '2026-07-30 10:00:00', '2026-12-19 23:59:00', '00000000-0000-0000-0000-000000000001', NOW(), NOW(), 0),
('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000201', 'Encuesta de prueba (cancelada)', 'Encuesta de prueba usada para verificar el historial de encuestas canceladas.', 'CANCELLED', 'YES_NO_MAYBE', 'OTHER', '2026-06-01 10:00:00', '2026-06-10 23:59:00', '00000000-0000-0000-0000-000000000001', NOW(), NOW(), 0);

-- ===================== TFM_SURVEYS: RESPUESTAS =====================
INSERT INTO survey_response (id, survey_id, user_iam_id, answer_yes_no_maybe, instrument_id, comment, answered_at, version) VALUES
('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000002', 'YES', NULL, NULL, '2026-08-01 12:00:00', 0),
('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'YES', NULL, 'Alli estare', '2026-08-02 12:00:00', 0),
('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000102', 'NO', NULL, NULL, '2026-08-03 12:00:00', 0),
('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000103', 'MAYBE', NULL, 'No estoy seguro todavía', '2026-08-04 12:00:00', 0),
('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000104', 'YES', NULL, NULL, '2026-08-05 12:00:00', 0),
('00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000105', 'NO', NULL, 'No puedo asistir', '2026-08-06 12:00:00', 0),
('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000106', 'YES', NULL, NULL, '2026-08-07 12:00:00', 0),
('00000000-0000-0000-0000-000000000508', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000107', 'MAYBE', NULL, NULL, '2026-08-08 12:00:00', 0),
('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000108', 'YES', NULL, 'Cuenten conmigo', '2026-08-09 12:00:00', 0),
('00000000-0000-0000-0000-000000000510', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000109', 'NO', NULL, 'Avisaré mas cerca de la fecha', '2026-08-01 12:00:00', 0),
('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000001', 'YES', '1', NULL, '2026-08-11 12:00:00', 0),
('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000101', 'YES', '7', 'Alli estare', '2026-08-12 12:00:00', 0),
('00000000-0000-0000-0000-000000000513', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000102', 'NO', '17', NULL, '2026-08-13 12:00:00', 0),
('00000000-0000-0000-0000-000000000514', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000103', 'YES', '13', 'Cuenten conmigo', '2026-08-14 12:00:00', 0),
('00000000-0000-0000-0000-000000000515', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000104', 'MAYBE', '16', NULL, '2026-08-15 12:00:00', 0),
('00000000-0000-0000-0000-000000000516', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000105', 'YES', '19', NULL, '2026-08-16 12:00:00', 0),
('00000000-0000-0000-0000-000000000517', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000106', 'NO', '22', 'No podré asistir', '2026-08-17 12:00:00', 0),
('00000000-0000-0000-0000-000000000518', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000107', 'YES', '25', 'Avisaré mas cerca de la fecha', '2026-08-18 12:00:00', 0),
('00000000-0000-0000-0000-000000000519', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000108', 'YES', '28', NULL, '2026-08-19 12:00:00', 0),
('00000000-0000-0000-0000-000000000520', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000109', 'NO', '4', 'No podré acudir', '2026-08-11 12:00:00', 0),
('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000002', 'YES', NULL, NULL, '2026-06-02 09:00:00', 0),
('00000000-0000-0000-0000-000000000522', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000001', 'NO', NULL, NULL, '2026-06-03 09:00:00', 0),
('00000000-0000-0000-0000-000000000523', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000101', 'MAYBE', NULL, NULL, '2026-06-04 09:00:00', 0),
('00000000-0000-0000-0000-000000000524', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000102', 'YES', NULL, NULL, '2026-06-05 09:00:00', 0),
('00000000-0000-0000-0000-000000000525', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000103', 'NO', NULL, NULL, '2026-06-06 09:00:00', 0),
('00000000-0000-0000-0000-000000000526', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000104', 'YES', NULL, NULL, '2026-06-07 09:00:00', 0);
