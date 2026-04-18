-- This script runs once per tenant schema on first provisioning.
-- The {SCHEMA} token is replaced by DbUp's variable substitution with the tenant's schema name.

-- ASP.NET Core Identity tables
CREATE TABLE {SCHEMA}.AspNetUsers (
    Id                   NVARCHAR(450)  NOT NULL PRIMARY KEY,
    UserName             NVARCHAR(256)  NULL,
    NormalizedUserName   NVARCHAR(256)  NULL,
    Email                NVARCHAR(256)  NULL,
    NormalizedEmail      NVARCHAR(256)  NULL,
    EmailConfirmed       BIT            NOT NULL DEFAULT 0,
    PasswordHash         NVARCHAR(MAX)  NULL,
    SecurityStamp        NVARCHAR(MAX)  NULL,
    ConcurrencyStamp     NVARCHAR(MAX)  NULL,
    PhoneNumber          NVARCHAR(MAX)  NULL,
    PhoneNumberConfirmed BIT            NOT NULL DEFAULT 0,
    TwoFactorEnabled     BIT            NOT NULL DEFAULT 0,
    LockoutEnd           DATETIMEOFFSET NULL,
    LockoutEnabled       BIT            NOT NULL DEFAULT 0,
    AccessFailedCount    INT            NOT NULL DEFAULT 0,
    DisplayName          NVARCHAR(255)  NULL,
    EmployeeId           INT            NULL
);

CREATE UNIQUE INDEX idx_aspnetusers_normalizedusername ON {SCHEMA}.AspNetUsers(NormalizedUserName)
    WHERE NormalizedUserName IS NOT NULL;
CREATE UNIQUE INDEX idx_aspnetusers_normalizedemail ON {SCHEMA}.AspNetUsers(NormalizedEmail)
    WHERE NormalizedEmail IS NOT NULL;

CREATE TABLE {SCHEMA}.AspNetRoles (
    Id               NVARCHAR(450) NOT NULL PRIMARY KEY,
    Name             NVARCHAR(256) NULL,
    NormalizedName   NVARCHAR(256) NULL,
    ConcurrencyStamp NVARCHAR(MAX) NULL
);

CREATE UNIQUE INDEX idx_aspnetroles_normalizedname ON {SCHEMA}.AspNetRoles(NormalizedName)
    WHERE NormalizedName IS NOT NULL;

CREATE TABLE {SCHEMA}.AspNetUserRoles (
    UserId NVARCHAR(450) NOT NULL REFERENCES {SCHEMA}.AspNetUsers(Id),
    RoleId NVARCHAR(450) NOT NULL REFERENCES {SCHEMA}.AspNetRoles(Id),
    PRIMARY KEY (UserId, RoleId)
);

CREATE TABLE {SCHEMA}.AspNetUserClaims (
    Id         INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    UserId     NVARCHAR(450) NOT NULL REFERENCES {SCHEMA}.AspNetUsers(Id),
    ClaimType  NVARCHAR(MAX) NULL,
    ClaimValue NVARCHAR(MAX) NULL
);

CREATE TABLE {SCHEMA}.AspNetRoleClaims (
    Id         INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
    RoleId     NVARCHAR(450) NOT NULL REFERENCES {SCHEMA}.AspNetRoles(Id),
    ClaimType  NVARCHAR(MAX) NULL,
    ClaimValue NVARCHAR(MAX) NULL
);

CREATE TABLE {SCHEMA}.AspNetUserTokens (
    UserId        NVARCHAR(450) NOT NULL REFERENCES {SCHEMA}.AspNetUsers(Id),
    LoginProvider NVARCHAR(450) NOT NULL,
    Name          NVARCHAR(450) NOT NULL,
    Value         NVARCHAR(MAX) NULL,
    PRIMARY KEY (UserId, LoginProvider, Name)
);

CREATE TABLE {SCHEMA}.AspNetUserLogins (
    LoginProvider       NVARCHAR(450) NOT NULL,
    ProviderKey         NVARCHAR(450) NOT NULL,
    ProviderDisplayName NVARCHAR(MAX) NULL,
    UserId              NVARCHAR(450) NOT NULL REFERENCES {SCHEMA}.AspNetUsers(Id),
    PRIMARY KEY (LoginProvider, ProviderKey)
);

-- Refresh tokens table (JWT refresh flow)
CREATE TABLE {SCHEMA}.refresh_tokens (
    id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    user_id     NVARCHAR(450)    NOT NULL REFERENCES {SCHEMA}.AspNetUsers(Id),
    token_hash  NVARCHAR(500)    NOT NULL UNIQUE,
    expires_at  DATETIME2        NOT NULL,
    revoked_at  DATETIME2        NULL,
    created_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE()
);

-- Invoice number sequence (per-tenant, atomic, no race condition)
DECLARE @sql NVARCHAR(500) = 'CREATE SEQUENCE {SCHEMA}.invoice_number_seq START WITH 1 INCREMENT BY 1';
EXEC sp_executesql @sql;

-- Seed default roles
INSERT INTO {SCHEMA}.AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp)
VALUES
    (NEWID(), 'admin',      'ADMIN',      NEWID()),
    (NEWID(), 'dispatcher', 'DISPATCHER', NEWID()),
    (NEWID(), 'readonly',   'READONLY',   NEWID());
