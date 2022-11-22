interface IisoUSDToken {
  function DEFAULT_ADMIN_ROLE (  ) external view returns ( bytes32 );
  function MINTER_ROLE (  ) external view returns ( bytes32 );
  function actionNonce (  ) external view returns ( uint256 );
  function action_queued ( bytes32 ) external view returns ( uint256 );
  function addRole ( address _account, bytes32 _role ) external;
  function allowance ( address owner, address spender ) external view returns ( uint256 );
  function approve ( address spender, uint256 amount ) external returns ( bool );
  function balanceOf ( address account ) external view returns ( uint256 );
  function burn ( address _account, uint256 _amount ) external;
  function decimals (  ) external view returns ( uint8 );
  function decreaseAllowance ( address spender, uint256 subtractedValue ) external returns ( bool );
  function getRoleAdmin ( bytes32 role ) external view returns ( bytes32 );
  function grantRole ( bytes32 role, address account ) external;
  function hasRole ( bytes32 role, address account ) external view returns ( bool );
  function increaseAllowance ( address spender, uint256 addedValue ) external returns ( bool );
  function mint ( uint256 _amount ) external;
  function name (  ) external view returns ( string memory );
  function previous_action_hash (  ) external view returns ( bytes32 );
  function proposeAddRole ( address _account, bytes32 _role ) external;
  function removeRole ( address _account, bytes32 _role ) external;
  function renounceRole ( bytes32 role, address account ) external;
  function revokeRole ( bytes32 role, address account ) external;
  function supportsInterface ( bytes4 interfaceId ) external view returns ( bool );
  function symbol (  ) external view returns ( string memory);
  function totalSupply (  ) external view returns ( uint256 );
  function transfer ( address to, uint256 amount ) external returns ( bool );
  function transferFrom ( address from, address to, uint256 amount ) external returns ( bool );
}
