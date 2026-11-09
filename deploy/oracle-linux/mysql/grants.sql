-- Re-applied by deploy.sh (as nf_migrate) after every migration, so new tables get exactly
-- the runtime privileges they need and nothing more. Keep in sync with prisma/schema.prisma.

GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.tenants          TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.tenant_domains   TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.identities       TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.roles            TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.role_assignments TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.sessions         TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.idempotency_keys TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.connectors                TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.sync_runs                 TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.directory_users           TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.directory_groups          TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.directory_memberships     TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.jobs                      TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.service_principals        TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.service_principal_secrets TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.tenant_identity_providers TO 'nf_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON neural_frontier.scim_tokens TO 'nf_app'@'127.0.0.1';
-- Append-only audit trail.
GRANT SELECT, INSERT                 ON neural_frontier.audit_events     TO 'nf_app'@'127.0.0.1';
