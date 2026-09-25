-- Opt-in administrator operation. No passwords are generated or rotated here.
-- Configure SCRAM credentials through the approved secret-management channel.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL createrole_self_grant = '';
CREATE ROLE hzense_editorial_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
CREATE ROLE hzense_editorial_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
COMMIT;
