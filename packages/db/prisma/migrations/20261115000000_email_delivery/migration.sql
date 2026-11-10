-- CreateTable
CREATE TABLE `tenant_email_settings` (
    `tenantId` CHAR(36) NOT NULL,
    `host` VARCHAR(253) NOT NULL,
    `port` INTEGER NOT NULL,
    `security` VARCHAR(16) NOT NULL,
    `username` VARCHAR(254) NULL,
    `passwordSealed` VARBINARY(2048) NULL,
    `passwordHint` VARCHAR(12) NULL,
    `fromAddress` VARCHAR(254) NOT NULL,
    `fromName` VARCHAR(120) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastTestAt` DATETIME(3) NULL,
    `lastTestOk` BOOLEAN NULL,
    `lastTestMessage` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_messages` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `toAddress` VARCHAR(254) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `bodySealed` MEDIUMBLOB NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `email_messages_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_email_settings` ADD CONSTRAINT `tenant_email_settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

