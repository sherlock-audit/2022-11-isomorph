# Isomorph contest details

- 50,000 USDC main award pot
- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)
- Starts November 23, 2022 15:00 UTC
- Ends December 7, 2022 15:00 UTC

# Resources

- [Website](https://isomorph.loans/)
- [Twitter](https://twitter.com/IsomorphLoans)
- [Isomorph contracts @789338c](https://github.com/kree-dotcom/isomorph/tree/789338c8979ab75b8187781a2500908bb26dcdea)
- [Velo-Deposit-Tokens @1e92342](https://github.com/kree-dotcom/Velo-Deposit-Tokens/tree/1e9234236a8ff708d67343bc54f93af5bb584e06)
- [Isomorph docs and diagrams](https://github.com/kree-dotcom/isomorph/docs)
- [Velo-Deposit-Token docs and diagram](https://github.com/kree-dotcom/Velo-Deposit-Tokens/tree/1e9234236a8ff708d67343bc54f93af5bb584e06/docs)

# On-chain context

```
DEPLOYMENT: optimism
ERC20: Synthetix Synths and [Lyra Liquidity Tokens](https://docs.lyra.finance/developers/contracts/system-architecture#liquiditytoken)
ERC721: Only Velo-Deposit-Tokens used with `Vault_Velo.sol`
```

# Audit scope
The following contracts in the repo [Isomorph @789338c](https://github.com/kree-dotcom/isomorph/tree/789338c8979ab75b8187781a2500908bb26dcdea) are in scope:

- `CollateralBook.sol`
- `Locker.sol`
- `RoleControl.sol`
- `Vault_Base_ERC20.sol`
- `Vault_Lyra.sol`
- `Vault_Synths.sol`
- `Vault_Velo.sol`
- `isoUSDToken.sol`

Also included as the following contracts contained in the [Velo-Deposit-Tokens @1e92342](https://github.com/kree-dotcom/Velo-Deposit-Tokens/tree/1e9234236a8ff708d67343bc54f93af5bb584e06) submodule

- `DepositReceipt_Base.sol`
- `DepositReceipt_ETH.sol`
- `DepositReceipt_USDC.sol`
- `Depositor.sol`
- `Templater.sol`


# About Isomorph

Isomorph is an Optimism-native lending protocol with a focus on interest generating collaterals. Loans mint the stablecoin isoUSD which can then be exchanged by the user for other stablecoins such as USDC to use elsewhere. 
Currently Isomorph supports three types of collateral:
- https://synthetix.io Synths. These tokens are ERC20s which match the prices of their underlying asset using Chainlink price feeds, i.e. sBTC will have the same price as Bitcoin. 
- Lyra Liquidity Tokens. These ERC20 tokens are representations of a users deposit of sUSD (synthetix USD) to an options writing pool on https://lyra.finance . These tokens can gain or lose value over time depending on the success of the Lyra pool's delta hedging and options writing. 
- Velodrome Deposit Tokens. These are ERC721s designed for Isomorph to enable users to deposit funds in https://velodrome.finance  liquidity pools and be able to have a moveable representation of that liquidity while still being able to claim any accruing rewards. Currently only USDC/Token pairs are supported and the Token of the pair must have a Chainlink price feed.

To support the loan system Isomorph contains a liquidation system present in each Vault contract, this enables any user to liquidate a loan if the collateral to loan ratio becomes too low. In addition there is `Locker.sol` which handles the locking of Velodrome's VELO token and voting for Velodrome pools to receive VELO emissions. This is required so that there can be an incentivized pool for isoUSD to be exchanged via.  

# Test Setup

- Begin by cloning the repo
- The repo contains a submodule so run `git submodule init && git submodule update` to get these files for Velo-Deposit-Tokens. This submodule contains its own tests and documents so please follow its own README.md for testing it.
- Then run "yarn install" in the main directory to install all required packages
- Connect your API endpoints and privatekey using the .env file. See sample_env for details.

If you swap to a different network you will need to update the static addresses that the Vaults rely on for Lyra, Synthetix and Velodrome. 

- Update ISOUSD_TIME_DELAY in isoUSDToken.sol to a shorter time than it's expected 3 days value. For tests 3 seconds is suggested. This is necessary to test Vault_Lyra.sol and Vault_Synths.sol because both rely on external oracles which will break functionality if we skip 3 days ahead and do not update them, updating them is too convoluted so instead we just use a shorter timelock for testing.

- Then run "yarn hardhat test" to run all tests. All tests should pass, occasionally the API will time out due to some of the tests taking a while to process, if this happens run again. The first test run will likely be much slower due to needing to fetch contract information at the fork block height. We use this block height for integration testing as we know all token doners have the balances we need to borrow at this height. If the block height is changed be aware tests using Synths or Lyra systems may fail if the respective external system's circuit breaker is in effect.

Please note all tests are performed at block height 29617000 on a fork of the Optimism mainnet. 
Hardhat v2.12.2
Yarn 1.22.18


