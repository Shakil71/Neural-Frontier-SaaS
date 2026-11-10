-- CreateTable
CREATE TABLE `server_finding_acceptances` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `serverId` CHAR(36) NOT NULL,
    `findingKey` VARCHAR(128) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `acceptedById` CHAR(36) NOT NULL,
    `acceptedBy` VARCHAR(320) NOT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `server_finding_acceptances_tenantId_serverId_findingKey_key`(`tenantId`, `serverId`, `findingKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `server_finding_acceptances` ADD CONSTRAINT `server_finding_acceptances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `server_finding_acceptances` ADD CONSTRAINT `server_finding_acceptances_tenantId_serverId_fkey` FOREIGN KEY (`tenantId`, `serverId`) REFERENCES `servers`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
