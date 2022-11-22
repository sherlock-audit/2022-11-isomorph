pragma solidity =0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
//*************************************
//TEST CODE ONLY DO NOT USE ON MAINNET 
//*************************************
contract TESTERC20Token is ERC20 {
    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol){
        //extra mint command to verify functionality in tests
        _mint(msg.sender, 1_000_000 ether);
    }

}