//ABIs required when pointing to existing smart contracts

const SynthSystem = [
    // Some details about the token
  "function suspendSynth(bytes32, uint256) external",
  "function resumeSynths(bytes32[]) external",
  "function synthSuspension(bytes32) external view returns(bool, uint248)"
  ];

const ERC20 = [
    // Some details about the token
  "function name() view returns (string)",
  "function symbol() view returns (string)",

  // Get the account balance
  "function balanceOf(address) view returns (uint)",

  // Send some of your tokens to someone else
  "function transfer(address to, uint amount)",
  "function approve(address spender, uint amount)",

  // An event triggered whenever anyone transfers to someone else
  "event Transfer(address indexed from, address indexed to, uint amount)"
  ];

  const LyraLP = [
    "function CBTimestamp() external view returns (uint256)",
    "function poolHedger() external view returns (address)",
    "function getTokenPriceWithCheck() external view returns(uint256, bool, uint256)"
  ];

  const GreekCache = [
    "function updateBoardCachedGreeks(uint256) external "
  ]

  const OptionMarket = [
    "function getLiveBoards() external view returns(uint256[] memory)"
  ]

  const Router = [
    "function quoteRemoveLiquidity(address, address, bool, uint256) external view returns(uint256, uint256)",
    "function getAmountOut(uint256, address, address) external view returns(uint256, bool)",
    "function swapExactTokensForTokensSimple(uint256 amountIn, uint256 amountOutMin, address tokenFrom, address tokenTo, bool stable, address to, uint256 deadline) external returns(uint256)"
  ]

  const PriceFeed = [
    "function latestRoundData() external view returns(uint80, int256, uint256, uint256, uint80)"
  ]

  const Voter  = [
    "function claimable(address) external view returns(uint256)",
    "function external_bribes(address) external view returns(address)",
    "function gauges(address pool) external view returns(address)",
    "function internal_bribes(address) external view returns(address)",
    "event Voted(address, uint256, uint256)"
  ]

  const Voting_Escrow = [
    "function balanceOfNFT(uint256) external view returns(uint256)",
    "function ownerOf(uint256) external view returns(address)",
    "function locked(uint256) external view returns(uint256)",
    "event Withdraw(address, uint256, uint256, uint256)",
    "event Supply(uint256, uint256)",
    "event Transfer(address, address uint256)"
  ]

  const External_Bribe = [
    "function earned(address, uint256) external view returns(uint256)",
    "function numCheckpoints(uint256) external view returns(uint256)",
    "function getPriorBalanceIndex(uint, uint) external view returns (uint)",
    "function lastEarn(address, uint) external view returns (uint)"
  ]

  

  ABIs = {
          ERC20: ERC20, 
          SynthSystem: SynthSystem, 
          LyraLP :LyraLP, 
          GreekCache : GreekCache,
          OptionMarket : OptionMarket,
          Router : Router,
          PriceFeed : PriceFeed,
          Voter : Voter,
          Voting_Escrow : Voting_Escrow,
          External_Bribe : External_Bribe
          }
  module.exports = { ABIs }

  