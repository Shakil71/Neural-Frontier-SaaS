-- CreateTable
CREATE TABLE `connectors` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `kind` ENUM('microsoft_graph') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `config` JSON NOT NULL,
    `secretCiphertext` VARBINARY(2048) NULL,
    `secretHint` VARCHAR(16) NULL,
    `syncIntervalMinutes` INTEGER NOT NULL DEFAULT 60,
    `usersDeltaLink` TEXT NULL,
    `groupsDeltaLink` TEXT NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `lastSyncStatus` ENUM('queued', 'running', 'succeeded', 'failed') NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `connectors_status_lastSyncAt_idx`(`status`, `lastSyncAt`),
    UNIQUE INDEX `connectors_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `connectors_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_runs` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `connectorId` CHAR(36) NOT NULL,
    `status` ENUM('queued', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
    `trigger` VARCHAR(16) NOT NULL,
    `mode` VARCHAR(16) NULL,
    `requestedById` CHAR(36) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `usersUpserted` INTEGER NOT NULL DEFAULT 0,
    `usersRemoved` INTEGER NOT NULL DEFAULT 0,
    `groupsUpserted` INTEGER NOT NULL DEFAULT 0,
    `groupsRemoved` INTEGER NOT NULL DEFAULT 0,
    `membershipsChanged` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(1000) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sync_runs_tenantId_connectorId_createdAt_idx`(`tenantId`, `connectorId`, `createdAt`),
    UNIQUE INDEX `sync_runs_tenantId_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_users` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `connectorId` CHAR(36) NOT NULL,
    `externalId` VARCHAR(64) NOT NULL,
    `userPrincipalName` VARCHAR(320) NOT NULL,
    `mail` VARCHAR(320) NULL,
    `displayName` VARCHAR(256) NOT NULL,
    `jobTitle` VARCHAR(128) NULL,
    `department` VARCHAR(128) NULL,
    `accountEnabled` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `syncedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `directory_users_tenantId_displayName_idx`(`tenantId`, `displayName`),
    INDEX `directory_users_tenantId_connectorId_syncedAt_idx`(`tenantId`, `connectorId`, `syncedAt`),
    UNIQUE INDEX `directory_users_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `directory_users_tenantId_connectorId_externalId_key`(`tenantId`, `connectorId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_groups` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `connectorId` CHAR(36) NOT NULL,
    `externalId` VARCHAR(64) NOT NULL,
    `displayName` VARCHAR(256) NOT NULL,
    `description` VARCHAR(1024) NULL,
    `mail` VARCHAR(320) NULL,
    `securityEnabled` BOOLEAN NOT NULL DEFAULT false,
    `mailEnabled` BOOLEAN NOT NULL DEFAULT false,
    `groupTypes` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `syncedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `directory_groups_tenantId_displayName_idx`(`tenantId`, `displayName`),
    INDEX `directory_groups_tenantId_connectorId_syncedAt_idx`(`tenantId`, `connectorId`, `syncedAt`),
    UNIQUE INDEX `directory_groups_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `directory_groups_tenantId_connectorId_externalId_key`(`tenantId`, `connectorId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_memberships` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `connectorId` CHAR(36) NOT NULL,
    `groupExternalId` VARCHAR(64) NOT NULL,
    `memberExternalId` VARCHAR(64) NOT NULL,
    `memberType` VARCHAR(16) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL,

    INDEX `directory_memberships_tenantId_connectorId_memberExternalId_idx`(`tenantId`, `connectorId`, `memberExternalId`),
    INDEX `directory_memberships_tenantId_connectorId_syncedAt_idx`(`tenantId`, `connectorId`, `syncedAt`),
    UNIQUE INDEX `directory_memberships_tenantId_connectorId_groupExternalId_m_key`(`tenantId`, `connectorId`, `groupExternalId`, `memberExternalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('queued', 'running', 'succeeded', 'dead') NOT NULL DEFAULT 'queued',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `runAt` DATETIME(3) NOT NULL,
    `lockedBy` VARCHAR(64) NULL,
    `lockedUntil` DATETIME(3) NULL,
    `lastError` VARCHAR(2000) NULL,
    `activeKey` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `jobs_activeKey_key`(`activeKey`),
    INDEX `jobs_status_runAt_idx`(`status`, `runAt`),
    INDEX `jobs_status_tenantId_idx`(`status`, `tenantId`),
    INDEX `jobs_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_principals` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `clientId` VARCHAR(64) NOT NULL,
    `permissions` JSON NOT NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `createdById` CHAR(36) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `service_principals_clientId_key`(`clientId`),
    UNIQUE INDEX `service_principals_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `service_principals_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_principal_secrets` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `servicePrincipalId` CHAR(36) NOT NULL,
    `secretHash` BINARY(32) NOT NULL,
    `hint` VARCHAR(8) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `service_principal_secrets_secretHash_key`(`secretHash`),
    INDEX `service_principal_secrets_tenantId_servicePrincipalId_idx`(`tenantId`, `servicePrincipalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `connectors` ADD CONSTRAINT `connectors_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_runs` ADD CONSTRAINT `sync_runs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_runs` ADD CONSTRAINT `sync_runs_tenantId_connectorId_fkey` FOREIGN KEY (`tenantId`, `connectorId`) REFERENCES `connectors`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `directory_users` ADD CONSTRAINT `directory_users_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `directory_users` ADD CONSTRAINT `directory_users_tenantId_connectorId_fkey` FOREIGN KEY (`tenantId`, `connectorId`) REFERENCES `connectors`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `directory_groups` ADD CONSTRAINT `directory_groups_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `directory_groups` ADD CONSTRAINT `directory_groups_tenantId_connectorId_fkey` FOREIGN KEY (`tenantId`, `connectorId`) REFERENCES `connectors`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `directory_memberships` ADD CONSTRAINT `directory_memberships_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `directory_memberships` ADD CONSTRAINT `directory_memberships_tenantId_connectorId_fkey` FOREIGN KEY (`tenantId`, `connectorId`) REFERENCES `connectors`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_principals` ADD CONSTRAINT `service_principals_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_principal_secrets` ADD CONSTRAINT `service_principal_secrets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_principal_secrets` ADD CONSTRAINT `service_principal_secrets_tenantId_servicePrincipalId_fkey` FOREIGN KEY (`tenantId`, `servicePrincipalId`) REFERENCES `service_principals`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
