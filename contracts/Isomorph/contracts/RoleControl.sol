pragma solidity =0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract RoleControl is AccessControl{

    // admin address can add  after `TIME_DELAY` has passed.
    // admin address can also remove minters or pause minting, no time delay needed.
    bytes32 constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public previous_action_hash = 0x0;
    uint256 private immutable TIME_DELAY;
    mapping(bytes32 => uint256) public action_queued;
    uint256 public actionNonce = 0;
    

    event QueueAddRole(address indexed account, bytes32 indexed role, address indexed suggestedBy, uint256 suggestedTimestamp);
    event AddRole(address indexed account, bytes32 indexed role, address indexed addedBy);
    event RemoveRole(address indexed account, bytes32 indexed role, address indexed addedBy);

    //this is horrid I am sorry, code too big kept occuring for vaults.
    function onlyAdminInternal() internal view {
        require(hasRole(ADMIN_ROLE, msg.sender), "Caller is not an admin");
    }
    modifier onlyAdmin{
        onlyAdminInternal();
        _;
    }

    constructor(uint256 _timeDelay){
        TIME_DELAY = _timeDelay;
    }
    // @dev adding a new role to an account is a two step process with a time delay
    // @dev first call this function then addRole
    // @param _account address you wish to be add the role to
    // @param _role the predefined role you wish the address to have, hashed by keccak256
    // @notice actionNonce increments on each call, therefore only one addRole can be queued at a time
    function proposeAddRole(address _account, bytes32 _role) external onlyAdmin{
        bytes32 action_hash = keccak256(abi.encode(_account, _role, actionNonce));
        previous_action_hash = action_hash;
        actionNonce += 1;
        action_queued[action_hash] = block.timestamp;
        emit QueueAddRole(_account, _role, msg.sender, block.timestamp);
    }

    // @param _account address that has been queued to become the role
    // @param _role the role the account should gain, note that all admins become pausers also.
    function addRole(address _account, bytes32 _role) external onlyAdmin{
        bytes32 action_hash = keccak256(abi.encode(_account, _role, actionNonce-1));
        require(previous_action_hash == action_hash, "Invalid Hash");
        require(block.timestamp > action_queued[action_hash] + TIME_DELAY,
            "Not enough time has passed");
        //use a hash to verify proposed account is the same as added account.
        _setupRole(_role, _account);
        emit AddRole(_account, _role,  msg.sender);
    }

    // @param _minter address that is already a minter and you wish to remove from this role.
    // @notice reverts if address `_minter` did not already have the minter role.
    function removeRole(address _account, bytes32 _role) external onlyAdmin{
        require(hasRole(_role, _account), "Address was not already specified role");
        _revokeRole(_role, _account);
        emit RemoveRole(_account, _role, msg.sender);
    }
}