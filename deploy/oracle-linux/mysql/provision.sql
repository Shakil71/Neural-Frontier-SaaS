-- Neural Frontier — MySQL 8.4 provisioning. Run once as root via scripts/install.sh,
-- which substitutes the two passwords. Idempotent.
--
-- Least privilege, two accounts, loopback only:
--   nf_migrate : schema changes (used only by deploy.sh to run `prisma migrate deploy`)
--                and re-applying the application grants after each migration.
--   nf_app     : runtime DML. Grants are per table (see grants.sql) so the audit trail can be
--                append-only: SELECT + INSERT on audit_events, never UPDATE or DELETE.

CREATE DATABASE IF NOT EXISTS neural_frontier
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'nf_migrate'@'127.0.0.1' IDENTIFIED BY '__NF_MIGRATE_PASSWORD__';
CREATE USER IF NOT EXISTS 'nf_app'@'127.0.0.1' IDENTIFIED BY '__NF_APP_PASSWORD__';
ALTER USER 'nf_migrate'@'127.0.0.1' IDENTIFIED BY '__NF_MIGRATE_PASSWORD__';
ALTER USER 'nf_app'@'127.0.0.1' IDENTIFIED BY '__NF_APP_PASSWORD__';

-- Prisma's shadow-database-free `migrate deploy` needs DDL on the schema only.
GRANT ALL PRIVILEGES ON neural_frontier.* TO 'nf_migrate'@'127.0.0.1' WITH GRANT OPTION;

-- Backups run as root through root's existing local MySQL access (scripts/backup.sh).

FLUSH PRIVILEGES;
