# YieldVault Smart Contract Storage Layout Reference

**Version:** 2.0  
**Target:** Stellar Soroban (WASM)  
**Last Updated:** May 29, 2026

---

## 1. Storage Architecture Overview

YieldVault uses a **namespace-partitioned storage model** with explicit collision prevention. All contract state is organized into nine logical namespaces, each serving a distinct functional domain:

| Namespace ID | Name | Purpose | Scope |
|------|------|---------|-------|
| 0 | `Core` | Token, shares, assets, admin, strategy state | Vault fundamentals |
| 1 | `Governance` | DAO voting, proposals, multisig configuration | Governance operations |
| 2 | `User` | Share balances, deposits, per-user caps | User holdings |
| 3 | `Shipment` | RWA shipment tracking and status | Asset provenance |
| 4 | `Fee` | Protocol fees, treasury, fee accumulation | Revenue management |
| 5 | `Withdrawal` | Timelocks, queues, minimum deposit rules | Withdrawal mechanics |
| 6 | `Oracle` | Price oracle configuration, heartbeat | Price validation |
| 7 | `Emergency` | Dual-approver actions, emergency proposals | Critical operations |
| 8 | `Strategy` | Strategy whitelist, caps, risk thresholds | Strategy management |

### Storage Layer Separation

- **Proxy Storage** (`ProxyDataKey` enum, `upgrade.rs`)
  - Lives in unstructured storage alongside the proxy implementation
  - **Never overlaps** with vault instance storage (`DataKey` enum)
  - Protected by EIP-1967-style hashed slot constants

- **Vault Instance Storage** (`DataKey` enum, `lib.rs`)
  - Contains global protocol state variables (Core, Governance, Fees, etc.)
  - Kept lightweight to minimize transaction footprints
  - Bounded TTL managed via `INSTANCE_LIFETIME_THRESHOLD` and `INSTANCE_BUMP_AMOUNT`

- **Vault Persistent Storage** (`DataKey` enum, `lib.rs`)
  - Contains per-user entries and historical snapshots (User, Checkpoint, Withdrawal queue entries)
  - Dedicated storage entry per key; unbounded scaling without bloating instance state
  - Managed via `PERSISTENT_LIFETIME_THRESHOLD` and `PERSISTENT_BUMP_AMOUNT` (see [`docs/storage-ttl-policy.md`](./storage-ttl-policy.md))

---

## 2. Proxy Storage Layout

The proxy contract maintains upgrade state using explicit numeric discriminators (0–4). These keys are **completely separate** from the vault's `DataKey` enum.

### ProxyDataKey Enum (upgrade.rs)

| Discriminator | Key Name | Type | Purpose | Slot Hash |
|---|---|---|---|---|
| 0 | `Admin` | `Address` | Current proxy admin | `0xb531276...` |
| 1 | `Implementation` | `BytesN<32>` | Current WASM hash | `0x360894a...` |
| 2 | `Initialized` | `bool` | Initialization flag | (derived from `ProxyDataKey::Initialized`) |
| 3 | `PendingAdmin` | `Address` | Pending admin for two-step transfer | (derived) |
| 4 | `StorageVersion` | `u32` | Storage schema version for migrations | (derived) |

**Immutable Constants:**
```rust
pub const ADMIN_SLOT: [u8; 32] = [0xb5, 0x31, 0x27, 0x68, ...]; // keccak256("contract.proxy.admin") - 1
pub const IMPLEMENTATION_SLOT: [u8; 32] = [0x36, 0x08, 0x94, 0xa1, ...]; // keccak256("contract.proxy.implementation") - 1
```

---

## 3. Vault Instance Storage Layout

### 3.1 Core Namespace (ID: 0)

Fundamental vault state and configuration.

| Storage Key | Type | Purpose | Upgrade Rule |
|---|---|---|---|
| `TokenAsset` | `Address` | Underlying token (USDC SAC) | **NEVER** modify or reorder |
| `TotalShares` | `i128` | Aggregate vault shares outstanding | Can persist across versions |
| `TotalAssets` | `i128` | Aggregate deposited assets | Can persist across versions |
| `Admin` | `Address` | Current vault administrator | Proxy-managed, vault-stored |
| `Strategy` | `Address` | Active strategy connector address | Can modify, increment version |
| `State` | `VaultState` struct | Vault paused flag, totals snapshot | Can persist |
| `DaoThreshold` | `i128` | DAO proposal voting threshold | Can persist |
| `ProposalNonce` | `u32` | Counter for proposal IDs | Can persist |
| `GovernanceConfig` | `GovernanceConfig` struct | Multisig signers, threshold, migration | Can persist |
| `BenjiStrategy` | `Address` | BENJI strategy connector (deprecated) | Can persist; do not reorder |
| `KoreanDebtStrategy` | `Address` | Korean debt strategy connector | Can persist; do not reorder |
| `PauseReason` | `PauseReason` enum | Reason code for vault pause | Can persist |
| `IsPaused` | `bool` | *(DEPRECATED: use PauseReason)* | Not used; kept for compat |

**VaultState Struct:**
```rust
#[contracttype]
pub struct VaultState {
    pub total_shares: i128,      // Replica of TotalShares for atomic updates
    pub total_assets: i128,      // Replica of TotalAssets for atomic updates
    pub is_paused: bool,         // Redundant with PauseReason; maintained for compatibility
}
```

---

### 3.2 Governance Namespace (ID: 1)

DAO voting, governance configuration, and multisig setup.

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `DaoThreshold` | `i128` | Scalar | Voting threshold for proposals | Can persist |
| `ProposalNonce` | `u32` | Scalar | Counter for unique proposal IDs | Can persist |
| `GovernanceConfig` | `GovernanceConfig` struct | Scalar | Signers, threshold, migration deadline | Can persist |
| `BenjiStrategy` | `Address` | Scalar | Legacy BENJI strategy address | Can persist |
| `KoreanDebtStrategy` | `Address` | Scalar | Korean debt strategy address | Can persist |
| `Proposal(u32)` | `StrategyProposal` struct | Parameterized by `proposal_id` | DAO proposal state for strategy voting | Can persist; parameterization prevents collisions |
| `Vote(VoteKey)` | `bool` | Parameterized by `VoteKey` | Records whether voter has voted on proposal | Can persist |

**StrategyProposal Struct:**
```rust
#[contracttype]
pub struct StrategyProposal {
    pub strategy: Address,       // Strategy being proposed
    pub yes_votes: i128,         // Cumulative yes votes
    pub no_votes: i128,          // Cumulative no votes
    pub executed: bool,          // Proposal executed flag
}
```

**VoteKey Struct (inline in DataKey enum):**
```rust
// Embedded in DataKey::Vote(VoteKey)
pub struct VoteKey {
    pub proposal_id: u32,        // Which proposal
    pub voter: Address,          // Which voter
}
```

**GovernanceConfig Struct:**
```rust
#[contracttype]
pub struct GovernanceConfig {
    pub signers: Vec<Address>,              // Current authorized signers
    pub previous_signers: Vec<Address>,     // Prior signer set (migration window)
    pub threshold: u32,                     // Required signature count (M of N)
    pub migration_deadline: u64,            // Ledger timestamp after which old signers invalid
}
```

---

### 3.3 User Namespace (ID: 2)

Per-user share balances, deposit amounts, and usage caps.

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `ShareBalance(Address)` | `i128` | Parameterized by `user` | Share balance for each user | Can persist; parameterization prevents collisions |
| `UserDeposit(Address)` | `i128` | Parameterized by `user` | Cumulative deposit amount (cost basis) for tax tracking | Can persist |
| `PerUserCap` | `i128` | Scalar | Maximum deposit per user (0 = unlimited) | Can persist; can modify |
| `LastDepositTime(Address)` | `u64` | Parameterized by `user` | Timestamp of last deposit for cooldown enforcement | Can persist |
| `UserCheckpoint(Address)` | `u32` | Parameterized by `user` | Latest checkpoint ID for this user | Can persist |
| `UserBalanceAt(UserBalanceKey)` | `i128` | Parameterized by `user` + `checkpoint_id` | User's share balance snapshot at checkpoint | Can persist |

**UserBalanceKey Struct (inline in DataKey enum):**
```rust
pub struct UserBalanceKey {
    pub user: Address,           // User address
    pub checkpoint_id: u32,      // Checkpoint iteration
}
```

---

### 3.4 Shipment Namespace (ID: 3)

RWA shipment tracking for asset provenance and status management.

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `ShipmentByStatus(ShipmentStatus)` | `Vec<u64>` | Parameterized by `status` enum variant | List of shipment IDs with given status | Can persist; status is enum discriminator |
| `ShipmentStatusOf(u64)` | `ShipmentStatus` enum | Parameterized by `shipment_id` | Current status of shipment | Can persist |

**ShipmentStatus Enum:**
```rust
#[contracttype]
pub enum ShipmentStatus {
    Pending,      // 0
    InTransit,    // 1
    Delivered,    // 2
    Cancelled,    // 3
}
```

---

### 3.5 Fee Namespace (ID: 4)

Protocol fee configuration, treasury management, and fee accumulation.

| Storage Key | Type | Purpose | Upgrade Rule |
|---|---|---|---|
| `FeeBps` | `i128` | Protocol fee rate in basis points (0–10000) | Can persist; can modify |
| `Treasury` | `Address` | Treasury recipient address for fees | Can persist; can modify |
| `TreasuryBalance` | `i128` | Accumulated protocol fees | Can persist |
| `TreasuryRolloverExcess` | `i128` | Cumulative fees exceeding bounded accumulator | Can persist |

---

### 3.6 Withdrawal Namespace (ID: 5)

Large-withdrawal timelocks, queued withdrawals, and minimum deposit enforcement.

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `LargeWithdrawalThreshold` | `i128` | Scalar | Share amount triggering 24-hour timelock | Can persist; can modify |
| `PendingWithdrawal(Address)` | `PendingWithdrawal` struct | Parameterized by `user` | Locked withdrawal awaiting timelock expiry | Can persist |
| `MinDeposit` | `i128` | Scalar | Minimum deposit amount (0 = no minimum) | Can persist; can modify |
| `MinLiquidityBuffer` | `i128` | Scalar | Minimum idle liquidity retained before strategy allocation | Can persist; can modify |
| `WithdrawalCooldown` | `u64` | Scalar | Cooldown duration in seconds (0 = disabled) | Can persist; can modify |
| `WithdrawalQueueMeta` | `WithdrawalQueueMeta` struct | Scalar | FIFO queue head/tail, admin param change guard | Can persist |
| `WithdrawalQueueEntry(u64)` | `WithdrawalQueueEntry` struct | Parameterized by `queue_sequence_number` | Queued withdrawal awaiting liquidity | Can persist |

**PendingWithdrawal Struct:**
```rust
#[contracttype]
pub struct PendingWithdrawal {
    pub shares: i128,            // Shares locked in timelock
    pub unlock_timestamp: u64,   // Ledger timestamp after which executable
}
```

**WithdrawalQueueMeta Struct:**
```rust
#[contracttype]
pub struct WithdrawalQueueMeta {
    pub head: u64,                         // FIFO queue head index
    pub tail: u64,                         // FIFO queue tail index
    pub admin_last_change_ts: u64,         // Timestamp of last admin param change
    pub admin_min_interval_secs: u64,      // Minimum interval between param changes
    pub admin_interval_armed: bool,        // Whether interval enforcement is active
}
```

**WithdrawalQueueEntry Struct:**
```rust
#[contracttype]
pub struct WithdrawalQueueEntry {
    pub user: Address,           // User requesting withdrawal
    pub shares: i128,            // Shares to burn
    pub assets: i128,            // Assets promised to user
    pub enqueued_at: u64,        // Ledger timestamp of enqueue
}
```

---

### 3.7 Oracle Namespace (ID: 6)

Oracle price feed configuration and validation parameters.

| Storage Key | Type | Purpose | Upgrade Rule |
|---|---|---|---|
| `PriceOracle` | `Address` | Oracle contract address | Can persist; can modify |
| `OracleEnabled` | `bool` | Oracle validation enabled flag | Can persist; can modify |
| `OracleHeartbeat` | `u64` | Maximum stale price duration (seconds) | Can persist; can modify |

---

### 3.8 Emergency Namespace (ID: 7)

Dual-approver operations for critical emergency actions (pause, divest, upgrade).

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `EmergencyApprovers` | `EmergencyApprovers` struct | Scalar | Primary and secondary approver addresses | Can persist; can modify |
| `EmergencyProposalNonce` | `u32` | Scalar | Counter for emergency proposal IDs | Can persist |
| `Emergency(EmergencyStorageKey::Proposal(u32))` | `EmergencyProposal` struct | Parameterized by `proposal_id` | Emergency action proposal state | Can persist |
| `Emergency(EmergencyStorageKey::DisputeWindow)` | `u64` | Scalar | Dispute window duration (seconds) | Can persist; default 3600 |

**EmergencyApprovers Struct:**
```rust
#[contracttype]
pub struct EmergencyApprovers {
    pub primary: Address,        // Initiator of emergency actions
    pub secondary: Address,      // Confirmer of emergency actions (must be distinct)
}
```

**EmergencyProposal Struct:**
```rust
#[contracttype]
pub struct EmergencyProposal {
    pub kind: EmergencyActionKind,         // Type of emergency action
    pub pause_reason_code: u32,            // Pause reason (0 = N/A)
    pub divest_amount: Option<i128>,       // Amount to divest (if divest action)
    pub wasm_hash: Option<BytesN<32>>,     // New WASM hash (if upgrade action)
    pub initiator: Address,                // Who initiated the proposal
    pub confirmed: bool,                   // Whether secondary has confirmed
    pub executed: bool,                    // Whether action has been executed
    pub cancelled: bool,                   // Whether proposal was cancelled
    pub dispute_deadline: u64,             // Ledger timestamp before which admin can cancel
}
```

**EmergencyActionKind Enum:**
```rust
#[contracttype]
pub enum EmergencyActionKind {
    Pause = 1,             // Pause vault operations
    Unpause = 2,           // Resume vault operations
    EmergencyDivest = 3,   // Forcibly recall from strategy
    ForceUpgrade = 4,      // Execute code upgrade without normal DAO
}
```

---

### 3.9 Strategy Namespace (ID: 8)

Strategy connector lifecycle, performance thresholds, and whitelisting.

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `StrategyWhitelist(Address)` | `u32` | Parameterized by `strategy_address` | Registration state: `1` = Pending, `2` = Active, `3` = Retired | Can persist; state transitions guarded |
| `StrategyCap(Address)` | `i128` | Parameterized by `strategy_address` | Maximum allocation to strategy (0 = unlimited) | Can persist; can modify |
| `StrategyRiskThreshold(Address)` | `i128` | Parameterized by `strategy_address` | Allocation limit based on risk tier | Can persist; can modify |
| `StrategyWatermark(Address)` | `i128` | Parameterized by `strategy_address` | High-water mark for performance fees | Can persist; can modify |
| `StrategyHeartbeat` | `u64` | Scalar | Maximum duration between strategy updates before "stale" | Can persist; can modify |
| `StrategyHeartbeat(Address)` | `u64` | Parameterized by `strategy_address` | Last update timestamp for strategy | Can persist; automatically managed |

**Strategy Registration State Machine:**
```
None → STATE_PENDING (1)
       ↓
STATE_ACTIVE (2) ← accepted for allocation
       ↓
STATE_RETIRED (3) ← no new allocations allowed
```

---

### 3.10 Batch Deposit & Relayer Management

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `RelayerWhitelist(Address)` | `bool` | Parameterized by `relayer_address` | Whether relayer is authorized for batch deposits | Can persist; can modify |
| `MaxBatchSize` | `u32` | Scalar | Maximum entries per `batch_deposit` call (default 50) | Can persist; can modify |

---

### 3.11 Checkpointing & Balance Snapshots

| Storage Key | Type | Parameterization | Purpose | Upgrade Rule |
|---|---|---|---|---|
| `CheckpointNonce` | `u32` | Scalar | Counter for checkpoint iterations | Can persist |
| `CheckpointTotals(u32)` | `CheckpointTotals` struct | Parameterized by `checkpoint_id` | Total shares/assets at checkpoint | Can persist |
| `UserCheckpoint(Address)` | `u32` | Parameterized by `user` | Latest checkpoint ID for user | Can persist |
| `UserBalanceAt(UserBalanceKey)` | `i128` | Parameterized by `user` + `checkpoint_id` | User balance snapshot at checkpoint | Can persist |

**CheckpointTotals Struct:**
```rust
#[contracttype]
pub struct CheckpointTotals {
    pub total_shares: i128,      // Aggregate shares at checkpoint
    pub total_assets: i128,      // Aggregate assets at checkpoint
}
```

---

## 4. Storage Key Collision Prevention

### 4.1 Namespace Isolation

Each `DataKey` variant is assigned to exactly one namespace via `StorageNamespace` enum (0–8). Soroban's `contracttype` macro encodes the enum discriminator in the storage key, ensuring variants in different enum values never collide.

### 4.2 Parameterized Key Encoding

Parameterized keys (e.g., `ShareBalance(Address)`) embed their parameter in the storage key hash:

```rust
// Soroban encodes as:
// storage_key = hash(variant_discriminator, Address)
env.storage().instance().set(&DataKey::ShareBalance(user), &balance);
```

- Different `user` values produce different storage keys
- `ShareBalance(alice)` and `ShareBalance(bob)` are distinct slots
- Parameter types must be `#[contracttype]`-compatible

### 4.3 Proxy Storage Separation

`ProxyDataKey` uses explicit numeric discriminators (0–4) and stores in proxy-managed slots, which are **completely separate** from vault instance storage. The vault's `DataKey` enum cannot reuse these discriminators.

### 4.4 Registry Validation

The `storage_registry.rs` module provides runtime validation:

```rust
pub fn validate_registry_no_collisions(
    keys: &Vec<StorageKeyDescriptor>
) -> Result<(), Symbol>
```

All registered keys are tested at deployment to ensure no two keys share the same `(namespace, name)` pair.

---

## 5. Upgrade Safety Constraints

### 5.1 Safe Operations

✅ **Appending New State Variables:**
- Add new `DataKey` variant at the end of the enum
- Use unique discriminator (next available integer)
- Assign to appropriate namespace
- Initialize to sensible default in all code paths
- Must not affect existing storage slots

✅ **Adding New Parameterized Keys:**
- Create new enum variant with distinct name
- Parameterize by new or existing `#[contracttype]` struct
- Ensure parameter type encodes uniquely
- Test collision detection

✅ **Extending Struct Fields:**
- Only at **end of struct** (does not break binary layout)
- Must update all access paths to handle field presence
- Can initialize missing field as `default()` during first access
- Document migration path for nodes decoding old state

✅ **Changing Storage Version:**
- Increment `STORAGE_VERSION` constant
- Implement migration hook in `run_storage_migration()`
- Ensure forward and backward compatibility semantics

✅ **Modifying Parameter Types:**
- Only if new type can be decoded from old serialization
- Add version stamp to struct if unsure
- Test deserialization with legacy data

### 5.2 Forbidden Operations

❌ **Reordering DataKey Variants:**
- Changes discriminator values for existing keys
- Breaks deserialization of live storage
- **Always append, never reorder**

❌ **Deleting or Renaming Existing Variants:**
- Breaks access to live storage
- Must deprecate with warning instead
- Keep zombie variant marked `#[deprecated]`

❌ **Mutating Parameter Types:**
- Changes storage key hash
- Existing data becomes inaccessible under new key
- Requires explicit migration hook to copy data

❌ **Changing Field Order in Structs:**
- Breaks binary deserialization layout
- Only append new fields at the end

❌ **Reducing Numeric Type Capacity:**
- E.g., `i128` → `i64`: data loss
- E.g., `u32` → `u16`: overflow risk
- Always expand or maintain type size

---

## 6. Migration Patterns

### 6.1 Version-Gated Migration

Each upgrade runs `run_storage_migration()` to adapt state for the new contract version:

```rust
fn run_storage_migration(env: &Env, target_version: u32) -> Result<(), VaultError> {
    let current_version = get_storage_version(env);
    
    // Version 1 → 2: Example migration
    if current_version < 2 && target_version >= 2 {
        // Copy data from old key to new key (if needed)
        // Initialize new mandatory fields
        // Validate invariants
    }
    
    set_storage_version(env, target_version);
    Ok(())
}
```

### 6.2 Field Presence Patterns

When extending a struct, support both old and new shapes:

```rust
// During migration
if let Some(old_value) = env.storage().instance().get(&DataKey::OldField) {
    // Migrate old data
    env.storage().instance().set(&DataKey::NewField, &migrated_value);
}

// In read paths
let value = env.storage().instance()
    .get(&DataKey::NewField)
    .or_else(|| default_value());  // Graceful fallback
```

### 6.3 Immutable Field Preservation

Never relocate or modify core identifiers:

```rust
// NEVER change:
TokenAsset        // Hardcoded contract instantiation
Admin             // Proxy-layer field
Initialized       // One-time setup flag
PauseReason enum  // Existing reason codes 0–6
```

---

## 7. Storage Namespace Audit Checklist

Before deploying contract upgrades, verify:

- [ ] All existing `DataKey` variants remain unchanged and ordered identically
- [ ] New variants appended at end of enum (no reordering)
- [ ] New variant has unique discriminator (≥ current max + 1)
- [ ] Assigned to appropriate `StorageNamespace`
- [ ] Parameterized keys use only `#[contracttype]` types
- [ ] No two keys map to same `(namespace, name)` pair
- [ ] `storage_registry.rs` updated with new keys
- [ ] Collision validation test passes
- [ ] All access paths initialize new fields with sensible defaults
- [ ] Migration hook (if needed) implemented and tested
- [ ] Storage version incremented (if schema changes)
- [ ] Backward compatibility preserved for reads
- [ ] Emergency unwind and data recovery tested

---

## 8. Storage Slot Reference Table

### Quick Lookup by Namespace

**Core (0):** TokenAsset, TotalShares, TotalAssets, Admin, Strategy, State, DaoThreshold, ProposalNonce, GovernanceConfig, BenjiStrategy, KoreanDebtStrategy, PauseReason, EmergencyApprovers, EmergencyProposalNonce

**Governance (1):** DaoThreshold, ProposalNonce, GovernanceConfig, BenjiStrategy, KoreanDebtStrategy, Proposal(u32), Vote(VoteKey)

**User (2):** ShareBalance(Address), UserDeposit(Address), PerUserCap, LastDepositTime(Address), UserCheckpoint(Address), UserBalanceAt(UserBalanceKey)

**Shipment (3):** ShipmentByStatus(ShipmentStatus), ShipmentStatusOf(u64)

**Fee (4):** FeeBps, Treasury, TreasuryBalance, TreasuryRolloverExcess

**Withdrawal (5):** LargeWithdrawalThreshold, PendingWithdrawal(Address), MinDeposit, MinLiquidityBuffer, WithdrawalCooldown, WithdrawalQueueMeta, WithdrawalQueueEntry(u64)

**Oracle (6):** PriceOracle, OracleEnabled, OracleHeartbeat

**Emergency (7):** EmergencyApprovers, EmergencyProposalNonce, Emergency(EmergencyStorageKey::Proposal(u32)), Emergency(EmergencyStorageKey::DisputeWindow)

**Strategy (8):** StrategyWhitelist(Address), StrategyCap(Address), StrategyRiskThreshold(Address), StrategyWatermark(Address), StrategyHeartbeat, StrategyHeartbeat(Address)

---

## 9. Critical Constants

| Constant | Value | Purpose |
|---|---|---|
| `STORAGE_VERSION` | 4 | Current schema version |
| `INSTANCE_LIFETIME_THRESHOLD` | 17,280 | Min instance TTL before extension (~1 day) |
| `INSTANCE_BUMP_AMOUNT` | 518,400 | Instance TTL extension target (~30 days) |
| `PERSISTENT_LIFETIME_THRESHOLD` | 120,960 | Min persistent TTL before extension (~7 days) |
| `PERSISTENT_BUMP_AMOUNT` | 518,400 | Persistent TTL extension target (~30 days) |
| `MAX_PAGE_SIZE` | 50 | Max items in paginated queries |
| `SHARE_PRICE_SCALE` | 1e18 | Decimal scaling for share price math |
| `IMPLEMENTATION_SLOT` | `0x360894a...` | EIP-1967 proxy implementation slot hash |
| `ADMIN_SLOT` | `0xb531276...` | EIP-1967 proxy admin slot hash |

---

## 10. Appendix: Reserved and Deprecated Fields

| Key | Status | Reason | Replacement |
|---|---|---|---|
| `IsPaused` | Deprecated | Redundant with `PauseReason` | Use `PauseReason` enum |
| `ShipmentByStatus(ShipmentStatus)` | Active | RWA provenance tracking | No replacement (core feature) |
| `BenjiStrategy` | Active | Legacy strategy; kept for compat | Use `Strategy` instead |

---

## 11. Governance Storage Transitions

**Governance Signer Migration (Active):**
- Old signers stored in `GovernanceConfig.previous_signers`
- New signers in `GovernanceConfig.signers`
- Migration window controlled by `migration_deadline`
- After deadline, only new signers are valid
- Migration finalized by `finalize_governance_migration()`

---

## 12. Example: Safe Schema Extension

**Scenario:** Add a new "vault insurance provider" address field.

**Safe Implementation:**

1. Add new `DataKey` variant:
```rust
#[contracttype]
pub enum DataKey {
    // ... existing variants ...
    InsuranceProvider,  // NEW: append at end
}
```

2. Update registry:
```rust
keys.push_back(scalar(StorageNamespace::Core, "InsuranceProvider"));
```

3. Initialize on upgrade:
```rust
fn run_storage_migration(env: &Env, target_version: u32) {
    if target_version >= 3 {
        env.storage().instance().set(&DataKey::InsuranceProvider, &Address::default());
    }
}
```

4. Access with fallback:
```rust
fn insurance_provider(env: Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::InsuranceProvider)
}
```

**Result:** Existing storage untouched. New field available for future business logic.

---

## 13. Example: Unsafe Schema Change (Do NOT Do)

**❌ Forbidden:** Reorder `DataKey` variants

```rust
// WRONG: Breaks all existing storage access
pub enum DataKey {
    State,             // Was 5th, now 1st → different discriminator
    TotalShares,       // Was 1st, now 2nd → different discriminator
    TotalAssets,       // Was 2nd, now 3rd → different discriminator
    // ...
}
```

**Why:** Discriminator changes mean `env.storage().instance().get(&DataKey::State)` now points to the wrong slot. The old `State` data is still in storage but unreachable. New contract can't read old balances.

**Correct Approach:** Add new variant at end, implement migration to copy data if semantics change.

