-- AlterTable
ALTER TABLE `identities` ADD COLUMN `scimExternalId` VARCHAR(255) NULL,
    ADD COLUMN `scimManaged` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `authProvider` VARCHAR(80) NULL,
    ADD COLUMN `idTokenSealed` VARBINARY(8192) NULL;

-- CreateTable
CREATE TABLE `scim_tokens` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `tokenHash` BINARY(32) NOT NULL,
    `hint` VARCHAR(8) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `scim_tokens_tokenHash_key`(`tokenHash`),
    INDEX `scim_tokens_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `identities_tenantId_scimExternalId_key` ON `identities`(`tenantId`, `scimExternalId`);

-- AddForeignKey
ALTER TABLE `scim_tokens` ADD CONSTRAINT `scim_tokens_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
