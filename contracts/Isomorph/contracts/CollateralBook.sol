//SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.9;
pragma abicoder v2;
import "./RoleControl.sol";
import "./interfaces/ICollateralBook.sol";
import "./interfaces/IVault.sol";

uint256 constant COLLATERAL_BOOK_TIME_DELAY = 3 days;

contract CollateralBook is RoleControl(COLLATERAL_BOOK_TIME_DELAY){

    mapping(address => bool) public collateralValid;
    mapping(address => bool) public collateralPaused;
    mapping(address => Collateral) public collateralProps;
    mapping(bytes32 => address) public liquidityPoolOf;
    mapping(uint256 => address) public vaults;

    
    bytes32 public constant VAULT_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant THREE_MIN = 180;
    uint256 public constant DIVISION_BASE = 1 ether;
    uint256 public constant CHANGE_COLLATERAL_DELAY = 200; //2 days

    //temporary data stores for changing Collateral variables
    address queuedCollateralAddress;
    bytes32 queuedCurrencyKey;
    uint256 queuedMinimumRatio;
    uint256 queuedLiquidationRatio;
    uint256 queuedInterestPer3Min;
    address queuedLiquidityPool;
    uint256 queuedTimestamp;

    // @notice minOpeningMargin MUST always be set high enough that 
    // a single update in the Chainlink pricefeed underlying Synthetix 
    // is significantly unlikely to produce an undercollateralized loan else the system is frontrunnable.
    struct Collateral {
        bytes32 currencyKey; //used by synthetix to identify synths
        uint256 minOpeningMargin; //minimum loan margin required on opening or adjusting a loan
        uint256 liquidatableMargin; //margin point below which a loan can be liquidated
        uint256 interestPer3Min; //what percentage the interest grows by every 3 minutes
        uint256 lastUpdateTime; //last blocktimestamp this collateral's virtual price was updated
        uint256 virtualPrice; //price accounting for growing interest accrued on any loans taken in this collateral
        uint256 assetType; //number to indicate what system this collateral token belongs to, 
                            // assetType is used to determine which Vault we are looking at
    }


    modifier collateralExists(address _collateralAddress){
        require(collateralValid[_collateralAddress], "Unsupported collateral!");
        _;
    }

    modifier onlyVault{
        require(hasRole(VAULT_ROLE, msg.sender), "Only updatable by vault");
        _;
    }

     constructor() {
        //we dont want the `DEFAULT_ADMIN_ROLE` to exist as this doesn't require a 
        // time delay to add/remove any role and so is dangerous. 
        //So we do not set it and set our weaker admin role.
        _setupRole(ADMIN_ROLE, msg.sender);
    }

    /**
      * @notice Used for testing or when a bot wants to check virtualPrice of an asset
      * @param _collateralAddress address of collateral token being used.
       */
    function viewVirtualPriceforAsset(address _collateralAddress) external view returns(uint256){
        return (collateralProps[_collateralAddress].virtualPrice);
    }

    /**
      * @notice Used for testing or when a bot wants to check if a collateral token needs the virtualPrice 
            manually updated due to inactivity.
      * @param _collateralAddress address of collateral token being used.
       */
    function viewLastUpdateTimeforAsset(address _collateralAddress) external view returns(uint256){
        return (collateralProps[_collateralAddress].lastUpdateTime);
    }

     /**
      * @notice Only Admin can modify collateral tokens,
      * @notice two step process to enforce a timelock for changing collateral
      * @notice first you call queueCollateralChange() then changeCollateralType() after timelock period ends
      * @dev does not allow changing token address, if this changes add a new collateral.
      * @param _collateralAddress address of collateral token being used.
      * @param _currencyKey symbol() returned string, used for synthetix calls
      * @param _minimumRatio lowest margin ratio for opening debts with new collateral token
      * @param _liquidationRatio margin ratio at which a loan backed by said collateral can be liquidated.
      * @param _interestPer3Min interest charged per block to loan holders using this collateral.
      * @param _liquidityPool only set for Lyra LP tokens, this address is where price info of the LP token is stored. The Zero address is used for non-Lyra Collateral
     **/
    function queueCollateralChange(
        address _collateralAddress,
        bytes32 _currencyKey,
        uint256 _minimumRatio,
        uint256 _liquidationRatio,
        uint256 _interestPer3Min,
        uint256 _assetType,
        address _liquidityPool

    ) external collateralExists(_collateralAddress) onlyAdmin {
        require(_collateralAddress != address(0));
        require(_minimumRatio > _liquidationRatio);
        require(_liquidationRatio != 0);
        require(vaults[_assetType] != address(0), "Vault not deployed yet");
        IVault vault = IVault(vaults[_assetType]);
        //prevent setting liquidationRatio too low such that it would cause an overflow in callLiquidation, see appendix on liquidation maths for details.
        require( vault.LIQUIDATION_RETURN() *_liquidationRatio >= 10 ** 36, "Liquidation ratio too low");

        queuedCollateralAddress = _collateralAddress;
        queuedCurrencyKey = _currencyKey;
        queuedMinimumRatio = _minimumRatio;
        queuedLiquidationRatio = _liquidationRatio;
        queuedInterestPer3Min = _interestPer3Min;
        queuedLiquidityPool = _liquidityPool;
        queuedTimestamp = block.timestamp;
    }
    /**
    * @notice Only Admin can modify collateral tokens, 
    * @notice forces virtualPrice to be up-to-date when updating to prevent retroactive interest rate changes.
    * @dev if time since last virtual price update is too long, 
    * @dev you must cycle it via the vault.updateVirtualPriceSlowly function or this function will revert
     */
    function changeCollateralType() external onlyAdmin {
        uint256 submissionTimestamp = queuedTimestamp;
        require(submissionTimestamp != 0, "Uninitialized collateral change");
        require(submissionTimestamp + CHANGE_COLLATERAL_DELAY <= block.timestamp, "Not enough time passed");
        address collateralAddress = queuedCollateralAddress;
        bytes32 currencyKey = queuedCurrencyKey;
        uint256 minimumRatio = queuedMinimumRatio;
        uint256 liquidationRatio = queuedLiquidationRatio;
        uint256 interestPer3Min = queuedInterestPer3Min;
        address liquidityPool = queuedLiquidityPool;
        

        //Now we must ensure interestPer3Min changes aren't applied retroactively
        // by updating the assets virtualPrice to current block timestamp
        uint256 timeDelta = (block.timestamp - collateralProps[collateralAddress].lastUpdateTime) / THREE_MIN;
        if (timeDelta != 0){ 
           updateVirtualPriceSlowly(collateralAddress, timeDelta );
        }
        bytes32 oldCurrencyKey = collateralProps[collateralAddress].currencyKey;

        _changeCollateralParameters(
            collateralAddress,
            currencyKey,
            minimumRatio,
            liquidationRatio,
            interestPer3Min
        );
        //Then update LiqPool as this isn't stored in the struct and requires the currencyKey also.
        liquidityPoolOf[oldCurrencyKey]= address(0); 
        liquidityPoolOf[currencyKey]= liquidityPool;
        
    }

   /** 
      * @dev This function should only be used by trusted functions that have validated all inputs already
      * @param _collateralAddress address of collateral token being used.
      * @param _currencyKey symbol() returned string, used for synthetix calls
      * @param _minimumRatio lowest margin ratio for opening debts with new collateral token
      * @param _liquidationRatio margin ratio at which a loan backed by said collateral can be liquidated.
      * @param _interestPer3Min interest charged per block to loan holders using this collateral.
     **/ 
    function _changeCollateralParameters(
        address _collateralAddress,
        bytes32 _currencyKey,
        uint256 _minimumRatio,
        uint256 _liquidationRatio,
        uint256 _interestPer3Min
        ) internal {
        collateralProps[_collateralAddress].currencyKey = _currencyKey;
        collateralProps[_collateralAddress].minOpeningMargin = _minimumRatio;
        collateralProps[_collateralAddress].liquidatableMargin = _liquidationRatio;
        collateralProps[_collateralAddress].interestPer3Min = _interestPer3Min;
    }

  /// @notice  Allows governance to pause a collateral type if necessary
  /// @param _collateralAddress the token address of the collateral we wish to remove
  /// @param _currencyKey the related synthcode, here we use this to prevent accidentally pausing the wrong collateral token.
  /// @dev this should only be called on collateral no longer used by loans.
    function pauseCollateralType(
        address _collateralAddress,
        bytes32 _currencyKey
        ) external collateralExists(_collateralAddress) onlyAdmin {
        require(_collateralAddress != address(0)); //this should get caught by the collateralExists check but just to be careful
        //checks two inputs to help prevent input mistakes
        require( _currencyKey == collateralProps[_collateralAddress].currencyKey, "Mismatched data");
        collateralValid[_collateralAddress] = false;
        collateralPaused[_collateralAddress] = true;
        
    }

  /// @notice  Allows governance to unpause a collateral type if necessary
  /// @param _collateralAddress the token address of the collateral we wish to remove
  /// @param _currencyKey the related synthcode, here we use this to prevent accidentally unpausing the wrong collateral token.
  /// @dev this should only be called on collateral that should be reenabled for taking loans against
    function unpauseCollateralType(
        address _collateralAddress,
        bytes32 _currencyKey
        ) external onlyAdmin {
        require(_collateralAddress != address(0));
        require(collateralPaused[_collateralAddress], "Unsupported collateral or not Paused");
        //checks two inputs to help prevent input mistakes
        require( _currencyKey == collateralProps[_collateralAddress].currencyKey, "Mismatched data");
        collateralValid[_collateralAddress] = true;
        collateralPaused[_collateralAddress] = false;
        
    }
    /// @dev Governnance callable only, this should be set once atomically on construction 
    /// @notice once called it can no longer be called.
    /// @param _vault the address of the vault system
    function addVaultAddress(address _vault, uint256 _assetType) external onlyAdmin{
        require(_vault != address(0), "Zero address");
        require(vaults[_assetType] == address(0), "Asset type already has vault");
        _setupRole(VAULT_ROLE, _vault);
        vaults[_assetType]= _vault;
    }
    
    /// @notice this takes in the updated virtual price of a collateral and records it as well as the time it was updated.
    /// @dev this should only be called by vault functions which have updated the virtual price and need to log this.
    /// @dev it is only callable by vault functions as a result.
    /// @notice both virtualPrice and updateTime are strictly monotonically increasing so we verify this with require statements
    /// @param _collateralAddress the token address of the collateral we are updating
    /// @param _virtualPriceUpdate interest calculation update for it's virtual price
    /// @param _updateTime block timestamp to keep track of last updated time.
    
    function _updateVirtualPriceAndTime(
        address _collateralAddress,
        uint256 _virtualPriceUpdate,
        uint256 _updateTime
        ) internal  {

        require( collateralProps[_collateralAddress].virtualPrice < _virtualPriceUpdate, "Incorrect virtual price" );
        require( collateralProps[_collateralAddress].lastUpdateTime < _updateTime, "Incorrect timestamp" );
        collateralProps[_collateralAddress].virtualPrice = _virtualPriceUpdate;
        collateralProps[_collateralAddress].lastUpdateTime = _updateTime;
    }

    /// @dev external function to enable the Vault to update the collateral virtual price & update timestamp
    ///      while maintaining the same method as the slow update below for consistency.
    function vaultUpdateVirtualPriceAndTime(
        address _collateralAddress,
        uint256 _virtualPriceUpdate,
        uint256 _updateTime
    ) external onlyVault collateralExists(_collateralAddress){
        _updateVirtualPriceAndTime(_collateralAddress, _virtualPriceUpdate, _updateTime);
    }


    /// @dev this function is intentionally callable by anyone
    /// @notice it is designed to prevent DOS situations occuring if there is a long period of inactivity for a collateral token
    /// @param _collateralAddress the collateral token you are updating the virtual price of
    /// @param _cycles how many updates (currently equal to seconds) to process the virtual price for.
    function updateVirtualPriceSlowly(
        address _collateralAddress,
        uint256 _cycles
        ) public collateralExists(_collateralAddress){ 
            Collateral memory collateral = collateralProps[_collateralAddress];
            uint256 timeDelta = block.timestamp - collateral.lastUpdateTime;
            uint256 threeMinDelta = timeDelta / THREE_MIN;
    
            require(_cycles <= threeMinDelta, 'Cycle count too high');
                for (uint256 i = 0; i < _cycles; i++ ){
                    collateral.virtualPrice = (collateral.virtualPrice * collateral.interestPer3Min) / DIVISION_BASE; 
                }
            _updateVirtualPriceAndTime(_collateralAddress, collateral.virtualPrice, collateral.lastUpdateTime + (_cycles*THREE_MIN));
        }
    
    
    

    /**
      * @notice Only governance can add new collateral tokens
      * @dev adds new synth token to approved list of collateral
      * @dev includes sanity checks 
      * @param _collateralAddress address of collateral token being used.
      * @param _currencyKey symbol() returned string, used for synthetix calls
      * @param _minimumRatio lowest margin ratio for opening debts with new collateral token
      * @param _liquidationRatio margin ratio at which a loan backed by said collateral can be liquidated.
      * @param _interestPer3Min interest charged per block to loan holders using this collateral.
      * @param _assetType number to indicate what system this collateral token belongs to, 
                          used to determine value function in vault.
     **/
    function addCollateralType(
        address _collateralAddress,
        bytes32 _currencyKey,
        uint256 _minimumRatio,
        uint256 _liquidationRatio,
        uint256 _interestPer3Min,
        uint256 _assetType,
        address _liquidityPool
        ) external onlyAdmin {

        require(!collateralValid[_collateralAddress], "Collateral already exists");
        require(!collateralPaused[_collateralAddress], "Collateral already exists");
        require(_collateralAddress != address(0));
        require(_minimumRatio > _liquidationRatio);
        require(_liquidationRatio > 0);
        require(vaults[_assetType] != address(0), "Vault not deployed yet");
        IVault vault = IVault(vaults[_assetType]);

        //prevent setting liquidationRatio too low such that it would cause an overflow in callLiquidation, see appendix on liquidation maths for details.
        require( vault.LIQUIDATION_RETURN() *_liquidationRatio >= 10 ** 36, "Liquidation ratio too low"); //i.e. 1 when multiplying two 1 ether scale numbers.
        collateralValid[_collateralAddress] = true;
        collateralProps[_collateralAddress] = Collateral(
            _currencyKey,
            _minimumRatio,
            _liquidationRatio,
            _interestPer3Min,
            block.timestamp,
            1 ether,
            _assetType
            );
        //Then update LiqPool as this isn't stored in the struct and requires the currencyKey also.
        liquidityPoolOf[_currencyKey]= _liquidityPool; 
    }

}

