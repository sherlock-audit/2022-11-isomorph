pragma solidity =0.8.9;

import "../isoUSDToken.sol";
//*************************************
//TEST CODE ONLY DO NOT USE ON MAINNET 
//*************************************
contract TESTisoUSDToken is isoUSDToken {
    constructor(){
        //extra mint command to verify functionality in tests
        _mint(msg.sender, 10 ether);
        _setupRole(ADMIN_ROLE, msg.sender);
    }

}
