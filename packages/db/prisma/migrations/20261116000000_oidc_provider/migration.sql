-- CreateTable
CREATE TABLE `oauth_applications` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `type` VARCHAR(16) NOT NULL,
    `clientId` VARCHAR(64) NOT NULL,
    `secretHash` BINARY(32) NULL,
    `secretHint` VARCHAR(12) NULL,
    `redirectUris` JSON NOT NULL,
    `postLogoutRedirectUris` JSON NOT NULL,
    `allowedRoleIds` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastUsedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `oauth_applications_clientId_key`(`clientId`),
    INDEX `oauth_applications_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_authorization_codes` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `applicationId` CHAR(36) NOT NULL,
    `identityId` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `codeHash` BINARY(32) NOT NULL,
    `redirectUri` VARCHAR(1024) NOT NULL,
    `scope` VARCHAR(255) NOT NULL,
    `nonce` VARCHAR(255) NULL,
    `codeChallenge` VARCHAR(128) NOT NULL,
    `authTime` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_authorization_codes_codeHash_key`(`codeHash`),
    INDEX `oauth_authorization_codes_tenantId_applicationId_idx`(`tenantId`, `applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oidc_signing_keys` (
    `kid` VARCHAR(64) NOT NULL,
    `alg` VARCHAR(16) NOT NULL,
    `publicJwk` JSON NOT NULL,
    `privateKeySealed` VARBINARY(4096) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `retiredAt` DATETIME(3) NULL,

    PRIMARY KEY (`kid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `oauth_applications` ADD CONSTRAINT `oauth_applications_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_authorization_codes` ADD CONSTRAINT `oauth_authorization_codes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

