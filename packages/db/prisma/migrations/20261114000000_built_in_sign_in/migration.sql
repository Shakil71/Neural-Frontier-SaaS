-- CreateTable
CREATE TABLE `local_credentials` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `passwordHash` VARCHAR(255) NULL,
    `passwordUpdatedAt` DATETIME(3) NULL,
    `totpSecretSealed` VARBINARY(256) NULL,
    `totpEnabledAt` DATETIME(3) NULL,
    `totpPendingSealed` VARBINARY(256) NULL,
    `totpPendingAt` DATETIME(3) NULL,
    `totpLastStep` INTEGER NULL,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `local_credentials_tenantId_identityId_key`(`tenantId`, `identityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recovery_codes` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `codeHash` BINARY(32) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `recovery_codes_codeHash_key`(`codeHash`),
    INDEX `recovery_codes_tenantId_identityId_idx`(`tenantId`, `identityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sign_in_links` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `tokenHash` BINARY(32) NOT NULL,
    `purpose` VARCHAR(16) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sign_in_links_tokenHash_key`(`tokenHash`),
    INDEX `sign_in_links_tenantId_identityId_idx`(`tenantId`, `identityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_sign_in_policies` (
    `tenantId` CHAR(36) NOT NULL,
    `passwordSignIn` BOOLEAN NOT NULL DEFAULT true,
    `twoFactor` VARCHAR(16) NOT NULL DEFAULT 'optional',
    `minPasswordLength` INTEGER NOT NULL DEFAULT 12,
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `local_credentials` ADD CONSTRAINT `local_credentials_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `local_credentials` ADD CONSTRAINT `local_credentials_tenantId_identityId_fkey` FOREIGN KEY (`tenantId`, `identityId`) REFERENCES `identities`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_tenantId_identityId_fkey` FOREIGN KEY (`tenantId`, `identityId`) REFERENCES `identities`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sign_in_links` ADD CONSTRAINT `sign_in_links_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sign_in_links` ADD CONSTRAINT `sign_in_links_tenantId_identityId_fkey` FOREIGN KEY (`tenantId`, `identityId`) REFERENCES `identities`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_sign_in_policies` ADD CONSTRAINT `tenant_sign_in_policies_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

