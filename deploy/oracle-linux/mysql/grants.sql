-- Re-applied by deploy.sh (as nf_migrate) after every migration, so new tables get exactly
-- the runtime privileges they need and nothing more. Keep in sync with prisma/schema.prisma.

GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.tenants          TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.tenant_domains   TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.identities       TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.roles            TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.role_assignments TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.sessions         TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.idempotency_keys TO 'nf_app'@'127.0.0.1';
-- Append-only audit trail.
GRANT SELECT, INSERT                 ON neural_frontier.audit_events     TO 'nf_app'@'127.0.0.1';
