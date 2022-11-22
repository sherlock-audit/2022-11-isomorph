interface IVault_Velo {

  struct CollateralNFTs{
        uint256[8] ids;
        uint256[8] slots;
    }
    
  function DEFAULT_ADMIN_ROLE (  ) external view returns ( bytes32 );
  function LIQUIDATION_RETURN (  ) external view returns ( uint256 );
  function actionNonce (  ) external view returns ( uint256 );
  function action_queued ( bytes32 ) external view returns ( uint256 );
  function addRole ( address _account, bytes32 _role ) external;
  function callLiquidation ( address _loanHolder, address _collateralAddress, CollateralNFTs calldata _loanNFTs, uint256 _partialPercentage ) external;
  function closeLoan ( address _collateralAddress, CollateralNFTs calldata _loanNFTs, uint256 _USDToVault, uint256 _partialPercentage ) external;
  function collateralBook (  ) external view returns ( address );
  function dailyMax (  ) external view returns ( uint256 );
  function dailyTotal (  ) external view returns ( uint256 );
  function dayCounter (  ) external view returns ( uint256 );
  function getLoanNFTids ( address _user, address _collateralAddress, uint256 _index ) external view returns ( uint256 );
  function getRoleAdmin ( bytes32 role ) external view returns ( bytes32 );
  function grantRole ( bytes32 role, address account ) external;
  function hasRole ( bytes32 role, address account ) external view returns ( bool );
  function increaseCollateralAmount ( address _collateralAddress, uint256 _NFTId ) external;
  function isoUSD (  ) external view returns ( address );
  function isoUSDLoanAndInterest ( address, address ) external view returns ( uint256 );
  function isoUSDLoaned ( address, address ) external view returns ( uint256 );
  function loanOpenFee (  ) external view returns ( uint256 );
  function onERC721Received ( address operator, address from, uint256 tokenId, bytes calldata data ) external returns ( bytes4 );
  function openLoan ( address _collateralAddress, uint256 _NFTId, uint256 _USDborrowed, bool _addingCollateral ) external;
  function pause (  ) external;
  function paused (  ) external view returns ( bool );
  function previous_action_hash (  ) external view returns ( bytes32 );
  function proposeAddRole ( address _account, bytes32 _role ) external;
  function removeRole ( address _account, bytes32 _role ) external;
  function renounceRole ( bytes32 role, address account ) external;
  function revokeRole ( bytes32 role, address account ) external;
  function setDailyMax ( uint256 _dailyMax ) external;
  function setOpenLoanFee ( uint256 _newOpenLoanFee ) external;
  function supportsInterface ( bytes4 interfaceId ) external view returns ( bool );
  function totalCollateralValue ( address _collateralAddress, address _owner ) external view returns ( uint256 );
  function treasury (  ) external view returns ( address );
  function unpause (  ) external;
  function viewLiquidatableAmount ( uint256 _collateralAmount, uint256 _collateralPrice, uint256 _userDebt, uint256 _liquidatableMargin ) external pure returns ( uint256 );
}
