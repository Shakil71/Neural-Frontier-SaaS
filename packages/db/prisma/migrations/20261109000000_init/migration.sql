-- CreateTable
CREATE TABLE `tenants` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(63) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_domains` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `domain` VARCHAR(253) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tenant_domains_domain_key`(`domain`),
    INDEX `tenant_domains_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identities` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `displayName` VARCHAR(200) NOT NULL,
    `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    `oidcIssuer` VARCHAR(512) NULL,
    `oidcSubject` VARCHAR(255) NULL,
    `lastSignInAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `identities_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `identities_tenantId_displayName_idx`(`tenantId`, `displayName`),
    UNIQUE INDEX `identities_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `identities_tenantId_email_key`(`tenantId`, `email`),
    UNIQUE INDEX `identities_oidcIssuer_oidcSubject_key`(`oidcIssuer`, `oidcSubject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `builtIn` BOOLEAN NOT NULL DEFAULT false,
    `permissions` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `roles_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `roles_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_assignments` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `grantedById` CHAR(36) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_assignments_tenantId_roleId_idx`(`tenantId`, `roleId`),
    INDEX `role_assignments_tenantId_identityId_idx`(`tenantId`, `identityId`),
    UNIQUE INDEX `role_assignments_identityId_roleId_key`(`identityId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `tokenHash` BINARY(32) NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idleExpiresAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_tenantId_identityId_idx`(`tenantId`, `identityId`),
    INDEX `sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action` VARCHAR(64) NOT NULL,
    `outcome` ENUM('success', 'failure', 'denied') NOT NULL,
    `actorId` CHAR(36) NULL,
    `actorLabel` VARCHAR(320) NOT NULL,
    `targetType` VARCHAR(64) NULL,
    `targetId` VARCHAR(64) NULL,
    `targetLabel` VARCHAR(320) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `requestId` VARCHAR(64) NULL,
    `metadata` JSON NOT NULL,

    INDEX `audit_events_tenantId_occurredAt_idx`(`tenantId`, `occurredAt`),
    INDEX `audit_events_tenantId_action_occurredAt_idx`(`tenantId`, `action`, `occurredAt`),
    INDEX `audit_events_tenantId_actorId_occurredAt_idx`(`tenantId`, `actorId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `requestHash` BINARY(32) NOT NULL,
    `responseStatus` INTEGER NOT NULL,
    `responseBody` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `idempotency_keys_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `idempotency_keys_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_domains` ADD CONSTRAINT `tenant_domains_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identities` ADD CONSTRAINT `identities_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_tenantId_identityId_fkey` FOREIGN KEY (`tenantId`, `identityId`) REFERENCES `identities`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_tenantId_roleId_fkey` FOREIGN KEY (`tenantId`, `roleId`) REFERENCES `roles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tenantId_identityId_fkey` FOREIGN KEY (`tenantId`, `identityId`) REFERENCES `identities`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

