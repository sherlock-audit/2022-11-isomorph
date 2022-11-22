interface ILiquidityPoolAvalon {

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
    address guardianMultisig;   
    // Length of time a deposit/withdrawal since initiation for before a guardian can force process their transaction
    uint guardianDelay;
    // When a new board is listed, block deposits/withdrawals
    uint boardSettlementCBTimeout;
    // When exchanging, don't exchange if fee is above this value
    uint maxFeePaid;
  }
  

  function CBTimestamp (  ) external view returns ( uint256 );
  function MOCK_setTotalPoolValueQuote ( uint256 amount ) external;
  function MOCK_updateCBs ( uint256[6] memory liquidity, uint256 spotPrice, uint256 maxSkewVariance, int256 netOptionValue, uint256 maxIvVariance ) external;
  function acceptOwnership (  ) external;
  function getTokenPrice (  ) external view returns ( uint256 );
  function getTotalTokenSupply (  ) external view returns ( uint256 );
  function init ( address _liquidityTokens ) external;
  function insolventSettlementAmount (  ) external view returns ( uint256 );
  function liquidationInsolventAmount (  ) external view returns ( uint256 );
  function lockedCollateral (  ) external view returns ( uint256 quote, uint256 base );
  function lpParams (  ) external view returns ( LiquidityPoolParameters memory params );
  function nextQueuedDepositId (  ) external view returns ( uint256 );
  function nextQueuedWithdrawalId (  ) external view returns ( uint256 );
  function nominateNewOwner ( address _owner ) external;
  function nominatedOwner (  ) external view returns ( address );
  function owner (  ) external view returns ( address );
  function queuedDepositHead (  ) external view returns ( uint256 );
  function queuedDeposits ( uint256 ) external view returns ( uint256 id, address beneficiary, uint256 amountLiquidity, uint256 mintedTokens, uint256 depositInitiatedTime );
  function queuedWithdrawalHead (  ) external view returns ( uint256 );
  function queuedWithdrawals ( uint256 ) external view returns ( uint256 id, address beneficiary, uint256 amountTokens, uint256 quoteSent, uint256 withdrawInitiatedTime );
  //function setLiquidityPoolParameters ( tuple _lpParams ) external;
  function totalOutstandingSettlements (  ) external view returns ( uint256 );
  function totalQueuedDeposits (  ) external view returns ( uint256 );
  function totalQueuedWithdrawals (  ) external view returns ( uint256 );
  function getTotalPoolValueQuote() external view returns (uint256);
  function getTokenPriceWithCheck() external view returns (uint256, bool, uint256);
}
