# Storage TTL Policy and Per-User State Architecture

**Version:** 1.0  
**Status:** Approved  
**Contract:** YieldVault (Stellar Soroban)  
**Last Updated:** October 2026  

---

## 1. Problem Statement

In Soroban, smart contract storage is partitioned into three durability tiers:
- **Instance Storage**: Shared across the entire contract instance. All instance entries share a single TTL and are bundled together in the contract instance ledger entry. Storing unbounded per-user entries in instance storage causes instance entry size to grow linearly with every user, increasing the transaction fees and resource footprint for *every* user operation and risking hitting the instance storage size limits.
- **Persistent Storage**: Individual ledger entries per storage key with independent TTLs and independent lifecycle management. Entries can be restored if archived. Ideal for per-user state that scales with user adoption.
- **Temporary Storage**: Ephemeral per-key storage that cannot be restored once expired.

Prior to Storage Version 4, YieldVault stored all per-user state (`ShareBalance`, `UserDeposit`, `LastDepositTime`, `PendingWithdrawal`, `WithdrawalQueueEntry`, `UserCheckpoint`, `UserBalanceAt`, `CheckpointTotals`) in **instance storage** without explicit TTL extension.

This specification establishes:
1. Moving all per-user and historical checkpoint data to **persistent storage**.
2. Explicit **TTL extension policies** on every read and write operation.
3. Storage schema migration through `migrate_storage` to transition existing instance entries to persistent storage.

---

## 2. TTL Parameters and Policy

Stellar ledgers close at an average interval of ~5 seconds:
- 1 hour ≈ 720 ledgers
- 1 day ≈ 17,280 ledgers
- 7 days ≈ 120,960 ledgers
- 30 days ≈ 518,400 ledgers

### 2.1 Instance Storage Policy
- **Threshold (`INSTANCE_LIFETIME_THRESHOLD`):** `17,280` ledgers (~1 day)
- **Bump Amount (`INSTANCE_BUMP_AMOUNT`):** `518,400` ledgers (~30 days)
- **Trigger:** Extended upon initialization, contract upgrades, migrations, deposits, withdrawals, and governance actions.

### 2.2 Persistent Storage Policy (Per-User Keys)
- **Threshold (`PERSISTENT_LIFETIME_THRESHOLD`):** `120,960` ledgers (~7 days)
- **Bump Amount (`PERSISTENT_BUMP_AMOUNT`):** `518,400` ledgers (~30 days)
- **Trigger:**
  - **On Read:** If the entry exists, its TTL is inspected. If remaining TTL is less than `PERSISTENT_LIFETIME_THRESHOLD`, it is extended to `PERSISTENT_BUMP_AMOUNT`.
  - **On Write:** Whenever an entry is created or modified, its TTL is extended to `PERSISTENT_BUMP_AMOUNT`.

---

## 3. Storage Key Classification

### 3.1 Instance Storage (Protocol Fundamentals & Config)
The following keys remain in **Instance Storage**:
- `TokenAsset`: Underlying SAC address
- `TotalShares`: Aggregate vault shares outstanding
- `TotalAssets`: Aggregate idle & strategy assets
- `Admin`, `PendingAdmin`: Vault administrator & two-step rotation
- `Strategy`, `BenjiStrategy`, `KoreanDebtStrategy`: Active strategy connectors
- `State`: High-level `VaultState` (totals + pause status)
- `PauseReason`: Vault pause reason enum
- `GovernanceConfig`, `DaoThreshold`, `ProposalNonce`, `Proposal(u32)`, `Vote(VoteKey)`
- `FeeBps`, `Treasury`, `TreasuryBalance`, `TreasuryRolloverExcess`
- `LargeWithdrawalThreshold`, `MinDeposit`, `MinLiquidityBuffer`, `WithdrawalCooldown`
- `WithdrawalQueueMeta`: Queue head & tail indices and change guards
- `CheckpointNonce`: Counter for historical balance checkpoints
- `PriceOracle`, `OracleEnabled`, `OracleHeartbeat`
- `StrategyWhitelist`, `StrategyCap`, `StrategyRiskThreshold`, `StrategyWatermark`
- `RelayerWhitelist`, `GaslessRelayer`, `MaxBatchSize`

### 3.2 Persistent Storage (Per-User & Scalable State)
The following keys are stored in **Persistent Storage**:
- `DataKey::ShareBalance(Address)`: User share holdings (`i128`).
- `DataKey::UserDeposit(Address)`: User cumulative deposit amount / cost basis (`i128`).
- `DataKey::LastDepositTime(Address)`: Timestamp of user's latest deposit for cooldown enforcement (`u64`).
- `DataKey::PendingWithdrawal(Address)`: Locked withdrawal timelock struct (`PendingWithdrawal`).
- `DataKey::WithdrawalQueueEntry(u64)`: FIFO liquidity queue item (`WithdrawalQueueEntry`).
- `DataKey::UserCheckpoint(Address)`: Checkpoint index snapshot for user (`u32`).
- `DataKey::UserBalanceAt(UserBalanceKey)`: Historical balance snapshot (`i128`).
- `DataKey::CheckpointTotals(u32)`: Historical total shares and assets at checkpoint (`CheckpointTotals`).

---

## 4. Migration Architecture (`migrate_storage`)

To transition live vaults from Storage Version 3 to Version 4:
1. **Target Version:** `STORAGE_VERSION = 4`.
2. **Deterministic Migration Hook:**
   - **Queued Withdrawals:** Loops from `WithdrawalQueueMeta.head` to `tail`. Any `WithdrawalQueueEntry(seq)` found in instance storage is moved to persistent storage with TTL extended, and its user's keys are migrated.
   - **Checkpoints:** Loops from `1` to `CheckpointNonce`. Any `CheckpointTotals(cp)` found in instance storage is moved to persistent storage with TTL extended.
   - **Staged Users:** If users were registered via `stage_migration_users(users)`, each user's `ShareBalance`, `UserDeposit`, `LastDepositTime`, `PendingWithdrawal`, `UserCheckpoint`, and `UserBalanceAt` keys are moved from instance to persistent storage with TTL extended.
   - **Direct Migration Utility:** `migrate_user_storage(users)` allows administrators to migrate batches of existing users on demand.
3. **On-Demand Lazy Migration (Zero Downtime Fallback):**
   - In all read and write methods, if an entry is requested and is absent from persistent storage but present in instance storage, the contract automatically copies the value to persistent storage, extends its TTL, and removes the legacy instance entry.
