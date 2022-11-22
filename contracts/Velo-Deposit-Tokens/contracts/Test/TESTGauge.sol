pragma solidity =0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TESTERC20Token.sol";

contract TESTGauge{

    IERC20 AMMToken;
    ERC20 public FakeRewards;
    mapping(address => uint256) public balanceOf;

    constructor(address _AMMToken){
        AMMToken = IERC20(_AMMToken);
        FakeRewards = new TESTERC20Token("Fake Rewards", "FR");
    }


    function deposit(uint256 _amount, uint tokenId) external {
        AMMToken.transferFrom(msg.sender, address(this), _amount);
        balanceOf[msg.sender] += _amount;
    }   

    function withdraw(uint256 _amount) external {
        AMMToken.transfer(msg.sender, _amount);
        balanceOf[msg.sender] -= _amount;
    }

    function getReward(address account, address[] memory tokens) external {
        FakeRewards.transfer(account, 100 ether);
    }
    function earned( address token, address account) external view returns(uint256){
        if(token == address(FakeRewards)){
            return(100 ether);
        }
        else{
            return 0;
        }
    }
}