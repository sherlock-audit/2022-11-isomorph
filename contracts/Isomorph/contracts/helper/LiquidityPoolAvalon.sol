//SPDX-License-Identifier: ISC

pragma solidity 0.8.9;

// Libraries
import "./synthetix/DecimalMath.sol";

// Inherited
import "./synthetix/Owned.sol";
import "./lib/SimpleInitializeable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Interfaces
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./LiquidityTokens.sol";

import "hardhat/console.sol";


/**
 * @title LiquidityPool
 * @author Lyra
 * @dev Holds funds from LPs, which are used for the following purposes:
 * 1. Collateralizing options sold by the OptionMarket.
 * 2. Buying options from users.
 * 3. Delta hedging the LPs.
 * 4. Storing funds for expired in the money options.
 */
contract LiquidityPoolAvalon is Owned, SimpleInitializeable, ReentrancyGuard {
  using DecimalMath for uint;

  struct Collateral {
    uint quote;
    uint base;
  }

  /// These values are all in quoteAsset amounts.
  struct Liquidity {
    // Amount of liquidity available for option collateral and premiums
    uint freeLiquidity;
    // Amount of liquidity available for withdrawals - different to freeLiquidity
    uint burnableLiquidity;
    // Amount of liquidity reserved for long options sold to traders
    uint usedCollatLiquidity;
    // Portion of liquidity reserved for delta hedging (quote outstanding)
    uint pendingDeltaLiquidity;
    // Current value of delta hedge
    uint usedDeltaLiquidity;
    // Net asset value, including everything and netOptionValue
    uint NAV;
  }

  struct QueuedDeposit {
    uint id;
    // Who will receive the LiquidityTokens minted for this deposit after the wait time
    address beneficiary;
    // The amount of quoteAsset deposited to be converted to LiquidityTokens after wait time
    uint amountLiquidity;
    // The amount of LiquidityTokens minted. Will equal to 0 if not processed
    uint mintedTokens;
    uint depositInitiatedTime;
  }

  struct QueuedWithdrawal {
    uint id;
    // Who will receive the quoteAsset returned after burning the LiquidityTokens
    address beneficiary;
    // The amount of LiquidityTokens being burnt after the wait time
    uint amountTokens;
    // The amount of quote transferred. Will equal to 0 if process not started
    uint quoteSent;
    uint withdrawInitiatedTime;
  }

  struct LiquidityPoolParameters {
    // The minimum amount of quoteAsset for a deposit, or the amount of LiquidityTokens for a withdrawal
    uint minDepositWithdraw;
    // Time between initiating a deposit and when it can be processed
    uint depositDelay;
    // Time between initiating a withdrawal and when it can be processed
    uint withdrawalDelay;
    // Fee charged on withdrawn funds
    uint withdrawalFee;
    // Percentage of NAV below which the liquidity CB fires
    uint liquidityCBThreshold;
    // Length of time after the liq. CB stops firing during which deposits/withdrawals are still blocked
    uint liquidityCBTimeout;
    // Difference between the spot and GWAV baseline IVs after which point the vol CB will fire
    uint ivVarianceCBThreshold;
    // Difference between the spot and GWAV skew ratios after which point the vol CB will fire
    uint skewVarianceCBThreshold;
    // Length of time after the (base) vol. CB stops firing during which deposits/withdrawals are still blocked
    uint ivVarianceCBTimeout;
    // Length of time after the (skew) vol. CB stops firing during which deposits/withdrawals are still blocked
    uint skewVarianceCBTimeout;
    // The address of the "guardian"
    //address guardianMultisig;
    // Length of time a deposit/withdrawal since initiation for before a guardian can force process their transaction
    //uint guardianDelay;
    // When a new board is listed, block deposits/withdrawals
    uint boardSettlementCBTimeout;
    // When exchanging, don't exchange if fee is above this value
    uint maxFeePaid;
  }
  
  //SynthetixAdapter internal synthetixAdapter;
  //OptionMarket internal optionMarket;
  LiquidityTokens internal liquidityTokens;
  //ShortCollateral internal shortCollateral;
  //OptionGreekCache internal greekCache;
  //PoolHedger public poolHedger;
  ERC20 internal quoteAsset;
  ERC20 internal baseAsset;

  mapping(uint => QueuedDeposit) public queuedDeposits;
  /// @dev The total amount of quoteAsset pending deposit (that hasn't entered the pool)
  uint public totalQueuedDeposits = 0;

  /// @dev The next queue item that needs to be processed
  uint public queuedDepositHead = 0;
  uint public nextQueuedDepositId = 0;

  mapping(uint => QueuedWithdrawal) public queuedWithdrawals;
  uint public totalQueuedWithdrawals = 0;

  /// @dev The next queue item that needs to be processed
  uint public queuedWithdrawalHead = 0;
  uint public nextQueuedWithdrawalId = 0;

  /// @dev Parameters relating to depositing and withdrawing from the Lyra LP
  LiquidityPoolParameters public lpParams;

  // timestamp for when deposits/withdrawals will be available to deposit/withdraw
  // This checks if liquidity is all used - adds 3 days to block.timestamp if it is
  // This also checks if vol variance is high - adds 12 hrs to block.timestamp if it is
  uint public CBTimestamp = 0;

  ////
  // Other Variables
  ////
  /// @dev Amount of collateral locked for outstanding calls and puts sold to users
  Collateral public lockedCollateral;
  /// @dev Total amount of quoteAsset reserved for all settled options that have yet to be paid out
  uint public totalOutstandingSettlements;

  /// @dev Total value not transferred to this contract for all shorts that didn't have enough collateral after expiry
  uint public insolventSettlementAmount;
  /// @dev Total value not transferred to this contract for all liquidations that didn't have enough collateral when liquidated
  uint public liquidationInsolventAmount;

  ///////////
  // Setup //
  ///////////

  constructor() Owned() {}

  /// @dev Initialise important addresses for the contract
  function init(
    LiquidityTokens _liquidityTokens
  ) external onlyOwner initializer {
    
    liquidityTokens = _liquidityTokens;
  }

  ///////////
  // Admin //
  ///////////
  
  function setLiquidityPoolParameters(LiquidityPoolParameters memory _lpParams) external onlyOwner {
    if (
      !(_lpParams.depositDelay < 365 days &&
        _lpParams.withdrawalDelay < 365 days &&
        _lpParams.withdrawalFee < 2e17 &&
        _lpParams.liquidityCBThreshold < 1e18 &&
        _lpParams.liquidityCBTimeout < 60 days &&
        _lpParams.ivVarianceCBTimeout < 60 days &&
        _lpParams.skewVarianceCBTimeout < 60 days &&
        //_lpParams.guardianDelay < 365 days &&
        _lpParams.boardSettlementCBTimeout < 10 days)
    ) {
      revert InvalidLiquidityPoolParameters(address(this), _lpParams);
    }

    lpParams = _lpParams;

    emit LiquidityPoolParametersUpdated(lpParams);
  }

  /*
  function _getTotalBurnableTokens()
    internal
    returns (
      uint tokensBurnable,
      uint tokenPriceWithFee,
      bool stale
    )
  {
    uint burnableLiquidity;
    uint tokenPrice;
    (tokenPrice, stale, burnableLiquidity) = _getTokenPriceAndStale();

    if (optionMarket.getNumLiveBoards() != 0) {
      tokenPriceWithFee = tokenPrice.multiplyDecimal(DecimalMath.UNIT - lpParams.withdrawalFee);
    } else {
      tokenPriceWithFee = tokenPrice;
    }

    return (burnableLiquidity.divideDecimal(tokenPriceWithFee), tokenPriceWithFee, stale);
  }

  function _getTokenPriceAndStale()
    internal
    returns (
      uint tokenPrice,
      bool,
      uint burnableLiquidity
    )
  {
    SynthetixAdapter.ExchangeParams memory exchangeParams = synthetixAdapter.getExchangeParams(address(optionMarket));

    OptionGreekCache.GlobalCache memory globalCache = greekCache.getGlobalCache();
    bool stale = greekCache.isGlobalCacheStale(exchangeParams.spotPrice);

    (uint pendingDelta, uint usedDelta) = _getPoolHedgerLiquidity(exchangeParams.short, exchangeParams.spotPrice);

    uint totalPoolValue = _getTotalPoolValueQuote(
      exchangeParams.spotPrice,
      usedDelta,
      globalCache.netGreeks.netOptionValue
    );
    uint totalTokenSupply = getTotalTokenSupply();
    tokenPrice = _getTokenPrice(totalPoolValue, totalTokenSupply);

    uint queuedTokenValue = tokenPrice.multiplyDecimal(totalQueuedWithdrawals);

    Liquidity memory liquidity = _getLiquidity(
      exchangeParams.spotPrice,
      totalPoolValue,
      queuedTokenValue,
      usedDelta,
      pendingDelta
    );

    _updateCBs(liquidity, globalCache.maxIvVariance, globalCache.maxSkewVariance, globalCache.netGreeks.netOptionValue);

    return (tokenPrice, stale, liquidity.burnableLiquidity);
  }

  
  */
  function MOCK_mintToUser(address _to, uint256 _amount) external {
    liquidityTokens.mint(_to, _amount);
  }
  //////////////////////
  // Circuit Breakers //
  //////////////////////

  /// @notice Updates the circuit breaker parameters, mock function to enable unit tests 
  /// without the burden of a full setup.
  function MOCK_updateCBBools(
    uint256[6] memory liquidity,
    uint256 spotPrice,
    uint256 maxSkewVariance,
    int256 netOptionValue,
    uint256 maxIvVariance
    )
     external{
    //in order free, burnable, used, pendingDeltaLiq, usedDeltaLiq, NAV
    Liquidity memory liquidity = Liquidity(liquidity[0],liquidity[1], liquidity[2],liquidity[3],liquidity[4], liquidity[5]);
    CBTimestamp = block.timestamp + 10000;
    //_updateCBs(liquidity, maxIvVariance, maxSkewVariance, netOptionValue);
  }

  function _updateCBs(
    Liquidity memory liquidity,
    uint maxIvVariance,
    uint maxSkewVariance,
    int optionValueDebt
  ) internal {
    // don't trigger CBs if pool has no open options
    if (liquidity.usedCollatLiquidity == 0 && optionValueDebt == 0) {
      return;
    }

    uint timeToAdd = 0;

    // if NAV == 0, openAmount will be zero too and _updateCB() won't be called.
    uint freeLiquidityPercent = liquidity.freeLiquidity.divideDecimal(liquidity.NAV);

    bool ivVarianceThresholdCrossed = maxIvVariance > lpParams.ivVarianceCBThreshold;
    bool skewVarianceThresholdCrossed = maxSkewVariance > lpParams.skewVarianceCBThreshold;
    bool liquidityThresholdCrossed = freeLiquidityPercent < lpParams.liquidityCBThreshold;

    if (ivVarianceThresholdCrossed) {
      timeToAdd = lpParams.ivVarianceCBTimeout;
    }
  
    if (skewVarianceThresholdCrossed && lpParams.skewVarianceCBTimeout > timeToAdd) {
      timeToAdd = lpParams.skewVarianceCBTimeout;
    }
    
    if (liquidityThresholdCrossed && lpParams.liquidityCBTimeout > timeToAdd) {
      timeToAdd = lpParams.liquidityCBTimeout;
    }

    if (timeToAdd > 0 && CBTimestamp < block.timestamp + timeToAdd) {
      CBTimestamp = block.timestamp + timeToAdd;
      emit CircuitBreakerUpdated(
        CBTimestamp,
        ivVarianceThresholdCrossed,
        skewVarianceThresholdCrossed,
        liquidityThresholdCrossed
      );
    }
  }


  //////////////////////////////
  // Getting Pool Token Value //
  //////////////////////////////
  uint256 totalPoolValue;

  function MOCK_setTotalPoolValueQuote(uint256 amount) external{
    totalPoolValue = amount;
  }
  function MOCK_getTotalPoolValueQuote() internal view returns(uint256){
    return totalPoolValue;
  }

  /// @dev Get current total liquidity tokens supply
  function getTotalTokenSupply() public view returns (uint) {
    return liquidityTokens.totalSupply() + totalQueuedWithdrawals;
  }

  /// @dev Get current pool token price
  function getTokenPrice() public view returns (uint) {
  
    return _getTokenPrice(MOCK_getTotalPoolValueQuote(), getTotalTokenSupply());
  }

  function _getTokenPrice(uint totalPoolValue, uint totalTokenSupply) internal pure returns (uint) {
    if (totalTokenSupply == 0) {
      return 1e18;
    }

    return totalPoolValue.divideDecimal(totalTokenSupply);
  }

  ////////////////////////////
  // Getting Pool Liquidity //
  ////////////////////////////
  /*
  /// @dev Gets current liquidity parameters using current market spot prices
  function getLiquidityParams() external view returns (Liquidity memory) {
    SynthetixAdapter.ExchangeParams memory exchangeParams = synthetixAdapter.getExchangeParams(address(optionMarket));
    return getLiquidity(exchangeParams.spotPrice, exchangeParams.short);
  }

  function getLiquidity(uint basePrice, ICollateralShort short) public view returns (Liquidity memory) {
    // if cache is stale, pendingDelta may be inaccurate
    (uint pendingDelta, uint usedDelta) = _getPoolHedgerLiquidity(short, basePrice);
    int optionValueDebt = greekCache.getGlobalOptionValue();
    uint totalPoolValue = _getTotalPoolValueQuote(basePrice, usedDelta, optionValueDebt);
    uint tokenPrice = _getTokenPrice(totalPoolValue, getTotalTokenSupply());

    return
      _getLiquidity(
        basePrice,
        totalPoolValue,
        tokenPrice.multiplyDecimal(totalQueuedWithdrawals),
        usedDelta,
        pendingDelta
      );
  }

  function getTotalPoolValueQuote() public view returns (uint) {
    SynthetixAdapter.ExchangeParams memory exchangeParams = synthetixAdapter.getExchangeParams(address(optionMarket));
    int optionValueDebt = greekCache.getGlobalOptionValue();
    (, uint usedDelta) = _getPoolHedgerLiquidity(exchangeParams.short, exchangeParams.spotPrice);

    return _getTotalPoolValueQuote(exchangeParams.spotPrice, usedDelta, optionValueDebt);
  }

  /**
   * @notice Returns the total pool value in quoteAsset.
   *
   * @param basePrice The price of the baseAsset.
   * @param usedDeltaLiquidity The amount of delta liquidity that has been used for hedging.
   * @param optionValueDebt the "debt" the AMM owes to traders in terms of option exposure
   */

   /*
  function _getTotalPoolValueQuote(
    uint basePrice,
    uint usedDeltaLiquidity,
    int optionValueDebt
  ) internal view returns (uint) {
    int totalAssetValue = SafeCast.toInt256(
      quoteAsset.balanceOf(address(this)) +
        baseAsset.balanceOf(address(this)).multiplyDecimal(basePrice) +
        usedDeltaLiquidity -
        totalOutstandingSettlements -
        totalQueuedDeposits
    );

    // Should not be possible due to being fully collateralised
    if (optionValueDebt > totalAssetValue) {
      revert OptionValueDebtExceedsTotalAssets(address(this), totalAssetValue, optionValueDebt);
    }

    return uint(totalAssetValue - optionValueDebt);
  }

  /**
   * @notice Returns the used and free amounts for collateral and delta liquidity.
   *
   * @param basePrice The price of the base asset.
   */
   /*
  function _getLiquidity(
    uint basePrice,
    uint totalPoolValue,
    uint reservedTokenValue,
    uint usedDelta,
    uint pendingDelta
  ) internal view returns (Liquidity memory) {
    Liquidity memory liquidity;
    liquidity.NAV = totalPoolValue;
    liquidity.usedDeltaLiquidity = usedDelta;
    uint baseBalance = baseAsset.balanceOf(address(this));

    liquidity.usedCollatLiquidity = lockedCollateral.quote;
    uint pendingBaseValue;
    if (baseBalance > lockedCollateral.base) {
      liquidity.usedCollatLiquidity += baseBalance.multiplyDecimal(basePrice);
    } else {
      liquidity.usedCollatLiquidity += lockedCollateral.base.multiplyDecimal(basePrice);
      pendingBaseValue = (lockedCollateral.base - baseBalance).multiplyDecimal(basePrice);
    }

    uint usedQuote = totalOutstandingSettlements + totalQueuedDeposits + lockedCollateral.quote + pendingBaseValue;

    uint totalQuote = quoteAsset.balanceOf(address(this));

    liquidity.freeLiquidity = totalQuote > (usedQuote + reservedTokenValue)
      ? totalQuote - (usedQuote + reservedTokenValue)
      : 0;

    // ensure pendingDelta <= liquidity.freeLiquidity
    liquidity.pendingDeltaLiquidity = liquidity.freeLiquidity > pendingDelta ? pendingDelta : liquidity.freeLiquidity;
    liquidity.freeLiquidity -= liquidity.pendingDeltaLiquidity;

    liquidity.burnableLiquidity = totalQuote > (usedQuote + pendingDelta) ? totalQuote - (usedQuote + pendingDelta) : 0;

    return liquidity;
  }
  */


  ////////////
  // Events //
  ////////////

  /// @dev Emitted whenever the pool paramters are updated
  event LiquidityPoolParametersUpdated(LiquidityPoolParameters lpParams);

  /// @dev Emitted whenever the poolHedger address is modified
  //event PoolHedgerUpdated(PoolHedger poolHedger);

  /// @dev Emitted when quote is locked.
  event QuoteLocked(uint quoteLocked, uint lockedCollateralQuote);

  /// @dev Emitted when quote is freed.
  event QuoteFreed(uint quoteFreed, uint lockedCollateralQuote);

  /// @dev Emitted when base is locked.
  event BaseLocked(uint baseLocked, uint lockedCollateralBase);

  /// @dev Emitted when base is freed.
  event BaseFreed(uint baseFreed, uint lockedCollateralBase);

  /// @dev Emitted when a board is settled.
  event BoardSettlement(uint insolventSettlementAmount, uint amountQuoteReserved, uint totalOutstandingSettlements);

  /// @dev Emitted when reserved quote is sent.
  event OutstandingSettlementSent(address indexed user, uint amount, uint totalOutstandingSettlements);

  /// @dev Emitted whenever quote is exchanged for base
  event BasePurchased(uint quoteSpent, uint baseReceived);

  /// @dev Emitted whenever base is exchanged for quote
  event BaseSold(uint amountBase, uint quoteReceived);

  /// @dev Emitted whenever premium is sent to a trader closing their position
  event PremiumTransferred(address indexed recipient, uint recipientPortion, uint optionMarketPortion);

  /// @dev Emitted whenever quote is sent to the PoolHedger
  event QuoteTransferredToPoolHedger(uint amountQuote);

  /// @dev Emitted whenever the insolvent settlement amount is updated (settlement and excess)
  event InsolventSettlementAmountUpdated(uint amountQuoteAdded, uint totalInsolventSettlementAmount);

  /// @dev Emitted whenever a user deposits and enters the queue.
  event DepositQueued(
    address indexed depositor,
    address indexed beneficiary,
    uint indexed depositQueueId,
    uint amountDeposited,
    uint totalQueuedDeposits,
    uint timestamp
  );

  /// @dev Emitted whenever a deposit gets processed. Note, can be processed without being queued.
  ///  QueueId of 0 indicates it was not queued.
  event DepositProcessed(
    address indexed caller,
    address indexed beneficiary,
    uint indexed depositQueueId,
    uint amountDeposited,
    uint tokenPrice,
    uint tokensReceived,
    uint timestamp
  );

  /// @dev Emitted whenever a deposit gets processed. Note, can be processed without being queued.
  ///  QueueId of 0 indicates it was not queued.
  event WithdrawProcessed(
    address indexed caller,
    address indexed beneficiary,
    uint indexed withdrawalQueueId,
    uint amountWithdrawn,
    uint tokenPrice,
    uint quoteReceived,
    uint totalQueuedWithdrawals,
    uint timestamp
  );
  event WithdrawPartiallyProcessed(
    address indexed caller,
    address indexed beneficiary,
    uint indexed withdrawalQueueId,
    uint amountWithdrawn,
    uint tokenPrice,
    uint quoteReceived,
    uint totalQueuedWithdrawals,
    uint timestamp
  );
  event WithdrawQueued(
    address indexed withdrawer,
    address indexed beneficiary,
    uint indexed withdrawalQueueId,
    uint amountWithdrawn,
    uint totalQueuedWithdrawals,
    uint timestamp
  );

  /// @dev Emitted whenever the CB timestamp is updated
  event CircuitBreakerUpdated(
    uint newTimestamp,
    bool ivVarianceThresholdCrossed,
    bool skewVarianceThresholdCrossed,
    bool liquidityThresholdCrossed
  );

  /// @dev Emitted whenever the CB timestamp is updated from a board settlement
  event BoardSettlementCircuitBreakerUpdated(uint newTimestamp);

  /// @dev Emitted whenever a queue item is checked for the ability to be processed
  event CheckingCanProcess(uint entryId, bool boardNotStale, bool validEntry, bool guardianBypass, bool delaysExpired);

  ////////////
  // Errors //
  ////////////
  // Admin
  error InvalidLiquidityPoolParameters(address thrower, LiquidityPoolParameters lpParams);
  error HedgerIsNotEmpty(address thrower, uint currentValue);

  // Deposits and withdrawals
  error InvalidBeneficiaryAddress(address thrower, address beneficiary);
  error MinimumDepositNotMet(address thrower, uint amountQuote, uint minDeposit);
  error MinimumWithdrawNotMet(address thrower, uint amountLiquidityTokens, uint minWithdraw);

  // Liquidity and accounting
  error LockingMoreQuoteThanIsFree(address thrower, uint quoteToLock, uint freeLiquidity, Collateral lockedCollateral);
  error SendPremiumNotEnoughCollateral(address thrower, uint premium, uint reservedFee, uint freeLiquidity);
  error NotEnoughFreeToReclaimInsolvency(address thrower, uint amountQuote, Liquidity liquidity);
  error OptionValueDebtExceedsTotalAssets(address thrower, int totalAssetValue, int optionValueDebt);
  error InsufficientFreeLiquidityForBaseExchange(
    address thrower,
    uint pendingBase,
    uint estimatedExchangeCost,
    uint freeLiquidity
  );

  // Access
  error OnlyPoolHedger(address thrower, address caller, address poolHedger);
  error OnlyOptionMarket(address thrower, address caller, address optionMarket);
  error OnlyShortCollateral(address thrower, address caller, address poolHedger);

  // Token transfers
  error QuoteTransferFailed(address thrower, address from, address to, uint amount);
  error BaseTransferFailed(address thrower, address from, address to, uint amount);
}
