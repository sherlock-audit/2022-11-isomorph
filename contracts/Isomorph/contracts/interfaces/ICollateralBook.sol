interface ICollateralBook {
  
  
    struct Collateral {
        bytes32 currencyKey; //used by synthetix to identify synths
        uint256 minOpeningMargin; //minimum loan margin required on opening or adjusting a loan
        uint256 liquidatableMargin; //margin point below which a loan can be liquidated
        uint256 interestPer3Min; //what percentage the interest grows by every 3 minutes
        uint256 lastUpdateTime; //last blocktimestamp this collateral's virtual price was updated
        uint256 virtualPrice; //price accounting for growing interest accrued on any loans taken in this collateral
        uint256 assetType;
    }

  
   
  function CHANGE_COLLATERAL_DELAY (  ) external view returns ( uint256 );
  function DEFAULT_ADMIN_ROLE (  ) external view returns ( bytes32 );
  function DIVISION_BASE (  ) external view returns ( uint256 );
  function THREE_MIN (  ) external view returns ( uint256 );
  function VAULT_ROLE (  ) external view returns ( bytes32 );
  function actionNonce (  ) external view returns ( uint256 );
  function action_queued ( bytes32 ) external view returns ( uint256 );
  function addCollateralType ( address _collateralAddress, bytes32 _currencyKey, uint256 _minimumRatio, uint256 _liquidationRatio, uint256 _interestPer3Min, uint256 _assetType, address _liquidityPool ) external;
  function addRole ( address _account, bytes32 _role ) external;
  function addVaultAddress ( address _vault, uint256 _assetType ) external;
  function changeCollateralType (  ) external;
  function collateralPaused ( address ) external view returns ( bool );
  function collateralProps(address) external view returns(Collateral memory collateral);
  function collateralValid ( address ) external view returns ( bool );
  function getRoleAdmin ( bytes32 role ) external view returns ( bytes32 );
  function grantRole ( bytes32 role, address account ) external;
  function hasRole ( bytes32 role, address account ) external view returns ( bool );
  function liquidityPoolOf ( bytes32 ) external view returns ( address );
  function pauseCollateralType ( address _collateralAddress, bytes32 _currencyKey ) external;
  function previous_action_hash (  ) external view returns ( bytes32 );
  function proposeAddRole ( address _account, bytes32 _role ) external;
  function queueCollateralChange ( address _collateralAddress, bytes32 _currencyKey, uint256 _minimumRatio, uint256 _liquidationRatio, uint256 _interestPer3Min, uint256 _assetType, address _liquidityPool ) external;
  function removeRole ( address _account, bytes32 _role ) external;
  function renounceRole ( bytes32 role, address account ) external;
  function revokeRole ( bytes32 role, address account ) external;
  function supportsInterface ( bytes4 interfaceId ) external view returns ( bool );
  function unpauseCollateralType ( address _collateralAddress, bytes32 _currencyKey ) external;
  function updateVirtualPriceSlowly ( address _collateralAddress, uint256 _cycles ) external;
  function vaultUpdateVirtualPriceAndTime ( address _collateralAddress, uint256 _virtualPriceUpdate, uint256 _updateTime ) external;
  function vaults ( uint256 ) external view returns ( address );
  function viewLastUpdateTimeforAsset ( address _collateralAddress ) external view returns ( uint256 );
  function viewVirtualPriceforAsset ( address _collateralAddress ) external view returns ( uint256 );
}
