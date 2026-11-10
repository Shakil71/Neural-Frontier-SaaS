-- CreateTable
CREATE TABLE `agent_enrollment_keys` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `keyHash` BINARY(32) NOT NULL,
    `hint` VARCHAR(8) NOT NULL,
    `uses` INTEGER NOT NULL DEFAULT 0,
    `maxUses` INTEGER NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_enrollment_keys_keyHash_key`(`keyHash`),
    INDEX `agent_enrollment_keys_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servers` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `hostname` VARCHAR(253) NOT NULL,
    `machineId` CHAR(32) NOT NULL,
    `lifecycle` ENUM('active', 'retired') NOT NULL DEFAULT 'active',
    `agentTokenHash` BINARY(32) NULL,
    `agentVersion` VARCHAR(64) NULL,
    `enrolledViaKey` CHAR(36) NULL,
    `inventory` JSON NULL,
    `packages` JSON NULL,
    `packagesHash` VARCHAR(64) NULL,
    `packageCount` INTEGER NOT NULL DEFAULT 0,
    `lastSeenAt` DATETIME(3) NULL,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `servers_agentTokenHash_key`(`agentTokenHash`),
    INDEX `servers_tenantId_hostname_idx`(`tenantId`, `hostname`),
    UNIQUE INDEX `servers_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `servers_tenantId_machineId_key`(`tenantId`, `machineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_enrollment_keys` ADD CONSTRAINT `agent_enrollment_keys_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servers` ADD CONSTRAINT `servers_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
