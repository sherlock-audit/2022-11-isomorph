pragma solidity =0.8.9;

import "./DepositReceipt_USDC.sol";
import "./Depositor.sol";
import "./Interfaces/IVoter.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";


//Templater clones the deposit contract and attachs it to the deposit token as 
//another trusted minter.
contract Templater {

    DepositReceipt_USDC public immutable depositReceipt;
    mapping(address => address) public UserToDepositor;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    //store token info to know which pooled pair this Templater relates to.
    address public immutable token0;
    address public immutable token1;
    address public immutable AMMToken;
    address public immutable gauge;
    address public immutable router;

    address constant private ZERO_ADDRESS = address(0);
    

    event newDepositorMade(address User, address Depositor);
    event DepositReceiptSetUp(address DepositReceipt);

    /**
    *    @notice New Templaters should be set up by Isomorph or a trusted party
    *    @param _token0 first trading token of associated Velodrome pool
    *    @param _token1 second trading token of associated Velodrome pool, order does not matter here
    *    @param _stable True if we are using a sAMM pool, false if it is a vAMM pool 
    *    @param _AMMToken address of velodrome pool token 
    *    @param _voter address of Velodrome Voter contract, could be constant but as constructor arg to make local unit tests easier
    *    @param _router address of Velodrome Router contract,  could be constant but as constructor arg to make local unit tests easier
    *    @param _priceFeed address of Chainlink price feed used for non-USDC token of the token pair, used to value that token's liquidity.
    **/
    constructor(
                address _token0, 
                address _token1, 
                bool _stable, 
                address _AMMToken, 
                address _voter,
                address _router,
                address _priceFeed
                ){
        require( _token0 != ZERO_ADDRESS, "Zero address used");
        require( _token1 != ZERO_ADDRESS, "Zero address used");
        require( _AMMToken != ZERO_ADDRESS, "Zero address used");
        require( _router != ZERO_ADDRESS, "Zero address used");
        require( _voter != ZERO_ADDRESS, "Zero address used");
        require( _priceFeed != ZERO_ADDRESS, "Zero address used");

        string memory name;
        string memory symbol;
        AMMToken = _AMMToken;
        gauge = IVoter(_voter).gauges(_AMMToken);
        router = _router;
        token0 = _token0;
        token1 = _token1;
        if (_stable) {
            name = string(abi.encodePacked("Deposit-Receipt-StableV1 AMM - ", IERC20Metadata(_token0).symbol(), "/", IERC20Metadata(_token1).symbol()));
            symbol = string(abi.encodePacked("Receipt-sAMM-", IERC20Metadata(_token0).symbol(), "/", IERC20Metadata(_token1).symbol()));
        } else {
            name = string(abi.encodePacked("Deposit-Receipt-VolatileV1 AMM - ", IERC20Metadata(_token0).symbol(), "/", IERC20Metadata(_token1).symbol()));
            symbol = string(abi.encodePacked("Receipt-vAMM-", IERC20Metadata(_token0).symbol(), "/", IERC20Metadata(_token1).symbol()));
        }
        depositReceipt = new DepositReceipt_USDC(name, 
                                            symbol, 
                                            _router, 
                                            _token0, 
                                            _token1, 
                                            _stable,
                                            _priceFeed
                                            );
                                            
        emit DepositReceiptSetUp(address(depositReceipt));
    }

    /**
    *    @notice Function to create a new Depositor as each one is linked to an address for each user. 
    *    @return Returns the address of the new Depositor that this user can now use to create DepositReceipts for this pool token only
    **/
    function makeNewDepositor()  external returns(address) {
        //One Depositor per address only to prevent losing old UserToDepositor mapping
        require(UserToDepositor[msg.sender] == ZERO_ADDRESS, "User already has Depositor");
        Depositor depositor = new Depositor(address(depositReceipt), AMMToken, gauge);
        //safe external calls so breaking CEI pattern does not matter here
        //slither-disable-next-line reentrancy-vulnerabilities-1
        depositor.transferOwnership(msg.sender);
        // allow new Depositor to mint the related depositReceipt ERC721 tokens.
        //slither-disable-next-line reentrancy-vulnerabilities-1
        depositReceipt.addMinter(address(depositor));
        //Store Depositor address so we can find it later for the user interactions  
        UserToDepositor[msg.sender] = address(depositor); 
        emit newDepositorMade(msg.sender, address(depositor));   
        return address(depositor);
    }

    
}