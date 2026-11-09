-- CreateTable
CREATE TABLE `tenant_identity_providers` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `issuer` VARCHAR(512) NOT NULL,
    `clientId` VARCHAR(255) NOT NULL,
    `secretCiphertext` VARBINARY(2048) NOT NULL,
    `secretHint` VARCHAR(16) NOT NULL,
    `requireEmailVerified` BOOLEAN NOT NULL DEFAULT true,
    `enforcement` ENUM('optional', 'required') NOT NULL DEFAULT 'optional',
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `tenant_identity_providers_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_identity_providers` ADD CONSTRAINT `tenant_identity_providers_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
