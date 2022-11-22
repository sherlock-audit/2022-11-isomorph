pragma solidity =0.8.9;

//This is a helper smart contract that is used to force an ETH balance onto 
// a smart contract that doesn't have a way to receive ETH but we wish to impersonate. 
contract TESTdeathSeed{
    function terminate(address payable _to) external payable {
        selfdestruct(_to);
    }
}