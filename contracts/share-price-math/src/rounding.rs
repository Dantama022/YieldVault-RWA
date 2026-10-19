//! Deterministic rounding policy for vault share conversions.
//!
//! The vault must never round in the user's favour: rounding always leaves the
//! residual dust with the vault, so `deposit -> withdraw` round trips can never
//! mint value out of nothing.
//!
//! ### Conversion Operations & Rounding Directions
//!
//! The table below defines the canonical ERC-4626 rounding policy implemented by this module:
//!
//! | Operation  | Direction        | Rounding           | Vault Public Entrypoint / Application Context |
//! |------------|------------------|--------------------|-----------------------------------------------|
//! | `deposit`  | assets to shares | [`Rounding::Down`] | `vault::deposit(user, amount)` (mints shares) |
//! | `redeem`   | shares to assets | [`Rounding::Down`] | `vault::withdraw(user, shares)` (burns shares)|
//! | `mint`     | shares to assets | [`Rounding::Up`]   | Required asset quote for exact shares         |
//! | `withdraw` | assets to shares | [`Rounding::Up`]   | Required share quote for exact assets (ERC-4626)|
//!
//! **Important note on vault `withdraw` semantics**:
//! In ERC-4626 standard terminology, `withdraw` refers to asset-denominated withdrawals
//! (specifying assets out, burning shares rounded up). However, in this vault contract,
//! the public entrypoint is `withdraw(user, shares)` which takes **shares as input** and converts
//! them to assets using round-down ([`Rounding::Down`]), matching the `redeem` operation.
//! The vault does not currently provide an asset-denominated withdrawal entrypoint.
//!
//! [`FIXTURES`] is the canonical cross-language conformance table. The same
//! vectors are published as `fixtures/rounding_fixtures.json` so that the
//! TypeScript SDK and the backend quote service can assert byte-identical
//! results against this implementation.

use crate::MathError;

/// Rounding direction applied to the residual of an integer division.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Rounding {
    /// Truncate the remainder (floor for non-negative operands).
    Down,
    /// Push the result away from zero whenever a remainder exists.
    Up,
}

impl Rounding {
    /// Stable string tag used in the JSON fixture file.
    pub fn as_str(&self) -> &'static str {
        match self {
            Rounding::Down => "down",
            Rounding::Up => "up",
        }
    }
}

/// Vault operation covered by the rounding policy.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Op {
    Deposit,
    Mint,
    Withdraw,
    Redeem,
}

impl Op {
    /// Rounding direction mandated by the policy for this operation.
    pub fn rounding(&self) -> Rounding {
        match self {
            Op::Deposit | Op::Redeem => Rounding::Down,
            Op::Mint | Op::Withdraw => Rounding::Up,
        }
    }

    /// Stable string tag used in the JSON fixture file.
    pub fn as_str(&self) -> &'static str {
        match self {
            Op::Deposit => "deposit",
            Op::Mint => "mint",
            Op::Withdraw => "withdraw",
            Op::Redeem => "redeem",
        }
    }
}

/// `a * b / denom` with an explicit rounding direction.
///
/// Returns an error on i128 overflow or a zero denominator.
pub fn mul_div(a: i128, b: i128, denom: i128, rounding: Rounding) -> Result<i128, MathError> {
    if denom == 0 {
        return Err(MathError::DivisionByZero);
    }

    let product = a.checked_mul(b).ok_or(MathError::Overflow)?;
    let quotient = product.checked_div(denom).ok_or(MathError::Overflow)?;

    match rounding {
        Rounding::Down => Ok(quotient),
        Rounding::Up => {
            let remainder = product.checked_rem(denom).ok_or(MathError::Overflow)?;
            if remainder == 0 {
                Ok(quotient)
            } else {
                quotient.checked_add(1).ok_or(MathError::Overflow)
            }
        }
    }
}

/// Converts assets to shares under the policy rounding for `op`.
///
/// An empty vault (no shares or no assets) mints 1:1.
pub fn assets_to_shares_rounded(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
    op: Op,
) -> Result<i128, MathError> {
    if total_assets == 0 || total_shares == 0 {
        return Ok(assets);
    }
    mul_div(assets, total_shares, total_assets, op.rounding())
}

/// Converts shares to assets under the policy rounding for `op`.
///
/// A vault with no outstanding shares redeems to zero.
pub fn shares_to_assets_rounded(
    shares: i128,
    total_shares: i128,
    total_assets: i128,
    op: Op,
) -> Result<i128, MathError> {
    if total_shares == 0 {
        return Ok(0);
    }
    mul_div(shares, total_assets, total_shares, op.rounding())
}

/// One conformance vector. `amount` is assets for deposit/withdraw and shares
/// for mint/redeem; `expected` is the converted amount in the opposite unit.
#[derive(Copy, Clone, Debug)]
pub struct RoundingFixture {
    pub id: &'static str,
    pub op: Op,
    pub amount: i128,
    pub total_shares: i128,
    pub total_assets: i128,
    pub expected: i128,
}

/// Canonical cross-language rounding vectors.
///
/// Mirrored verbatim by `fixtures/rounding_fixtures.json`.
pub const FIXTURES: &[RoundingFixture] = &[
    RoundingFixture {
        id: "empty-vault-first-deposit",
        op: Op::Deposit,
        amount: 1_000,
        total_shares: 0,
        total_assets: 0,
        expected: 1_000,
    },
    RoundingFixture {
        id: "deposit-exact-division",
        op: Op::Deposit,
        amount: 300,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 200,
    },
    RoundingFixture {
        id: "deposit-truncates-residual",
        op: Op::Deposit,
        amount: 100,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 66,
    },
    RoundingFixture {
        id: "deposit-dust-rounds-to-zero",
        op: Op::Deposit,
        amount: 1,
        total_shares: 1_000,
        total_assets: 1_000_000,
        expected: 0,
    },
    RoundingFixture {
        id: "withdraw-charges-extra-share",
        op: Op::Withdraw,
        amount: 100,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 67,
    },
    RoundingFixture {
        id: "withdraw-exact-division-no-bump",
        op: Op::Withdraw,
        amount: 300,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 200,
    },
    RoundingFixture {
        id: "redeem-truncates-residual",
        op: Op::Redeem,
        amount: 99,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 148,
    },
    RoundingFixture {
        id: "redeem-dust-rounds-to-zero",
        op: Op::Redeem,
        amount: 1,
        total_shares: 1_000_000,
        total_assets: 1_000,
        expected: 0,
    },
    RoundingFixture {
        id: "mint-charges-extra-asset",
        op: Op::Mint,
        amount: 99,
        total_shares: 1_000,
        total_assets: 1_500,
        expected: 149,
    },
    RoundingFixture {
        id: "mint-empty-vault-is-zero",
        op: Op::Mint,
        amount: 500,
        total_shares: 0,
        total_assets: 0,
        expected: 0,
    },
];

/// Evaluates a fixture with the production conversion helpers.
pub fn evaluate(fixture: &RoundingFixture) -> Result<i128, MathError> {
    match fixture.op {
        Op::Deposit | Op::Withdraw => assets_to_shares_rounded(
            fixture.amount,
            fixture.total_shares,
            fixture.total_assets,
            fixture.op,
        ),
        Op::Mint | Op::Redeem => shares_to_assets_rounded(
            fixture.amount,
            fixture.total_shares,
            fixture.total_assets,
            fixture.op,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_fixtures_match() {
        for fixture in FIXTURES {
            assert_eq!(
                evaluate(fixture),
                Ok(fixture.expected),
                "fixture `{}` diverged from the rounding policy",
                fixture.id
            );
        }
    }

    #[test]
    fn mul_div_rejects_zero_denominator() {
        assert_eq!(
            mul_div(10, 10, 0, Rounding::Down),
            Err(MathError::DivisionByZero)
        );
        assert_eq!(
            mul_div(10, 10, 0, Rounding::Up),
            Err(MathError::DivisionByZero)
        );
    }

    #[test]
    fn mul_div_rejects_overflow() {
        assert_eq!(
            mul_div(i128::MAX, 2, 3, Rounding::Down),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn rounding_up_only_bumps_on_remainder() {
        assert_eq!(mul_div(10, 3, 5, Rounding::Up), Ok(6));
        assert_eq!(mul_div(10, 3, 4, Rounding::Up), Ok(8));
    }

    #[test]
    fn withdraw_never_cheaper_than_deposit() {
        // The policy must never let a round trip mint value: the shares burned
        // on withdraw are always >= the shares minted for the same assets.
        let (total_shares, total_assets) = (1_000, 1_500);
        for assets in 1..500i128 {
            let minted =
                assets_to_shares_rounded(assets, total_shares, total_assets, Op::Deposit).unwrap();
            let burned =
                assets_to_shares_rounded(assets, total_shares, total_assets, Op::Withdraw).unwrap();
            assert!(
                burned >= minted,
                "round trip leaked value at {assets} assets"
            );
        }
    }

    #[test]
    fn dust_deposit_below_one_share_rounds_to_zero() {
        // Issue #1536: at 1_000 assets per share every deposit below 1_000
        // mints zero shares; the vault rejects these instead of keeping them.
        let (total_shares, total_assets) = (1_000, 1_000_000);
        for assets in 1..1_000i128 {
            assert_eq!(
                assets_to_shares_rounded(assets, total_shares, total_assets, Op::Deposit),
                Ok(0)
            );
        }
        assert_eq!(
            assets_to_shares_rounded(1_000, total_shares, total_assets, Op::Deposit),
            Ok(1)
        );
    }

    #[test]
    fn policy_directions_are_stable() {
        assert_eq!(Op::Deposit.rounding(), Rounding::Down);
        assert_eq!(Op::Redeem.rounding(), Rounding::Down);
        assert_eq!(Op::Mint.rounding(), Rounding::Up);
        assert_eq!(Op::Withdraw.rounding(), Rounding::Up);
    }

    #[test]
    fn test_rounding_up_calculation_branch_and_boundaries() {
        // Issue #1679: Exercise Rounding::Up calculation branch.
        // 1. Non-exact conversion ratio proving round-up produces a different result from round-down:
        // Case A: mul_div directly
        // 100 * 1000 / 1500 = 66 remainder 1000
        let down_res = mul_div(100, 1000, 1500, Rounding::Down).unwrap();
        let up_res = mul_div(100, 1000, 1500, Rounding::Up).unwrap();
        assert_eq!(down_res, 66);
        assert_eq!(up_res, 67);
        assert_ne!(
            up_res, down_res,
            "Round-up must produce a strictly greater result than round-down when a remainder exists"
        );

        // Case B: assets_to_shares_rounded (Op::Deposit vs Op::Withdraw)
        let deposit_shares = assets_to_shares_rounded(100, 1000, 1500, Op::Deposit).unwrap();
        let withdraw_shares = assets_to_shares_rounded(100, 1000, 1500, Op::Withdraw).unwrap();
        assert_eq!(deposit_shares, 66);
        assert_eq!(withdraw_shares, 67);
        assert_ne!(withdraw_shares, deposit_shares);

        // Case C: shares_to_assets_rounded (Op::Redeem vs Op::Mint)
        // 99 * 1500 / 1000 = 148,500 / 1000 = 148 remainder 500
        let redeem_assets = shares_to_assets_rounded(99, 1000, 1500, Op::Redeem).unwrap();
        let mint_assets = shares_to_assets_rounded(99, 1000, 1500, Op::Mint).unwrap();
        assert_eq!(redeem_assets, 148);
        assert_eq!(mint_assets, 149);
        assert_ne!(mint_assets, redeem_assets);

        // 2. Exact-divisibility behavior as a boundary case:
        // When product % denom == 0, Rounding::Up must NOT bump (up_res == down_res).
        let exact_down = mul_div(300, 1000, 1500, Rounding::Down).unwrap();
        let exact_up = mul_div(300, 1000, 1500, Rounding::Up).unwrap();
        assert_eq!(exact_down, 200);
        assert_eq!(exact_up, 200);

        let exact_withdraw = assets_to_shares_rounded(300, 1000, 1500, Op::Withdraw).unwrap();
        let exact_deposit = assets_to_shares_rounded(300, 1000, 1500, Op::Deposit).unwrap();
        assert_eq!(exact_withdraw, 200);
        assert_eq!(exact_deposit, 200);

        // Zero amount boundary case:
        assert_eq!(mul_div(0, 1000, 1500, Rounding::Up), Ok(0));
        assert_eq!(mul_div(0, 1000, 1500, Rounding::Down), Ok(0));

        // Single unit dust (remainder only, quotient 0):
        // 1 * 1000 / 1500 = quotient 0, remainder 1000 -> Down: 0, Up: 1
        assert_eq!(mul_div(1, 1000, 1500, Rounding::Down), Ok(0));
        assert_eq!(mul_div(1, 1000, 1500, Rounding::Up), Ok(1));

        // 3. Supported input domain / large values without overflow:
        let large_a = 1_000_000_000_000i128;
        let large_b = 2_000_000_000_000i128;
        let denom = 3i128;
        let large_down = mul_div(large_a, large_b, denom, Rounding::Down).unwrap();
        let large_up = mul_div(large_a, large_b, denom, Rounding::Up).unwrap();
        assert_eq!(large_up, large_down + 1);

        // Bounded overflow test
        assert_eq!(mul_div(i128::MAX, 2, 1, Rounding::Up), Err(MathError::Overflow));
    }
}
